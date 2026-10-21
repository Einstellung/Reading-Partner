// A study's data (docs/info/91 数据, 标签): the label store, the study record,
// which version is current, a version read back out of the one result file,
// and how sync merges the two new files. Run: scripts/t.sh tests/info/topic-search/study

import { beforeEach, expect, test } from "bun:test";
import { createFakeAppData, CORRUPT_SUFFIX, type FakeAppData } from "../../support/guarded-appdata";
import {
  addTopicLabels,
  latestLabels,
  loadTopicLabels,
  newTopicLabelId,
  topicLabelsFileName,
  type TopicLabel,
} from "../../../src/info/topic-search/labels";
import {
  addRollback,
  currentVersion,
  loadStudy,
  nextLineId,
  putStudyLines,
  studyFileName,
  type StudyLine,
} from "../../../src/info/topic-search/study";
import {
  mergeRetry,
  versionPart,
  type StudyVersion,
  type TopicSearchResult,
  type TopicSearchResultItem,
} from "../../../src/info/topic-search/result-types";
import { resolvePalace } from "../../../src/palace";
import { mergeFile } from "../../../src/platform/sync/merge";

const SEARCH = "ts-0a1b2c3d";

let io: FakeAppData;
beforeEach(() => {
  io = createFakeAppData();
});

function label(id: string, item: string, over: Partial<TopicLabel> = {}): TopicLabel {
  return {
    id,
    searchId: SEARCH,
    item,
    title: item,
    label: "yes",
    reason: "this is the one",
    source: "line",
    evidence: "m-1",
    at: 1,
    brief: { version: 1, place: "main", rank: 2, score: 71 },
    criteria: 3,
    ...over,
  };
}

function line(id: string, over: Partial<StudyLine> = {}): StudyLine {
  return {
    id,
    kind: "avoid",
    text: "fitting equations to data that is already there",
    said: "not the ones that only fit existing data",
    evidence: "m-2",
    item: null,
    state: "confirmed",
    at: 10,
    usedIn: null,
    ...over,
  };
}

test("labels are appended, never rewritten, and the latest of an item is the one in force", async () => {
  expect(await loadTopicLabels(SEARCH, io)).toEqual([]);
  const seed = label("tl-00000001", "arxiv:2501.1", { label: "pinned", source: "seed", brief: { version: 1, place: "absent", rank: null, score: null } });
  await addTopicLabels(SEARCH, [seed, label("tl-00000002", "arxiv:2501.2", { at: 2 })], io);
  // The same id again is not written; a new label of the same item is, and outranks the old.
  const after = await addTopicLabels(
    SEARCH,
    [label("tl-00000002", "arxiv:2501.2", { label: "no" }), label("tl-00000003", "arxiv:2501.2", { label: "no", at: 5, source: "question", brief: null })],
    io,
  );
  expect(after.map((l) => l.id)).toEqual(["tl-00000001", "tl-00000002", "tl-00000003"]);
  const onDisk = io.json(topicLabelsFileName(SEARCH)) as { version: number; searchId: string; labels: TopicLabel[] };
  expect(onDisk.version).toBe(1);
  expect(onDisk.searchId).toBe(SEARCH);
  const latest = latestLabels(await loadTopicLabels(SEARCH, io));
  expect(latest.get("arxiv:2501.2")?.label).toBe("no");
  expect(latest.get("arxiv:2501.1")?.label).toBe("pinned");
  expect(newTopicLabelId(() => 0)).toBe("tl-00000000");
});

test("a label a newer build wrote is carried through, and a duplicate id sets the bytes aside first", async () => {
  const file = topicLabelsFileName(SEARCH);
  io.files.set(file, JSON.stringify({ version: 1, searchId: SEARCH, labels: [{ id: "tl-future", label: "maybe" }] }));
  await addTopicLabels(SEARCH, [label("tl-00000001", "arxiv:1")], io);
  expect((io.json(file) as { labels: { id: string }[] }).labels.map((l) => l.id)).toEqual(["tl-00000001", "tl-future"]);
  expect(await loadTopicLabels(SEARCH, io)).toHaveLength(1);

  io.files.set(file, JSON.stringify({ version: 1, searchId: SEARCH, labels: [label("tl-1", "a"), label("tl-1", "b")] }));
  await addTopicLabels(SEARCH, [label("tl-2", "c")], io);
  expect(io.files.has(`${file}${CORRUPT_SUFFIX}`)).toBe(true);
  expect((await loadTopicLabels(SEARCH, io)).map((l) => l.id)).toEqual(["tl-1", "tl-2"]);

  // A read that failed does not become the list that gets written.
  io.readFails = true;
  await expect(addTopicLabels(SEARCH, [label("tl-3", "d")], io)).rejects.toThrow();
});

test("study lines are put by id, returns are kept in a map on disk, and the next id follows the highest", async () => {
  expect(await loadStudy(SEARCH, io)).toEqual({ version: 1, searchId: SEARCH, lines: [], rollbacks: [] });
  await putStudyLines(SEARCH, [line("L1"), line("L2", { kind: "pin", item: "arxiv:2501.9", text: "LLM-IDEA" })], io);
  await putStudyLines(SEARCH, [line("L1", { state: "dropped" }), line("L3", { kind: "judgment" })], io);
  await addRollback(SEARCH, 1, 500, io);
  await addRollback(SEARCH, 1, 500, io);
  await addRollback(SEARCH, 2, 400, io);
  const study = await loadStudy(SEARCH, io);
  expect(study.lines.map((l) => `${l.id}:${l.state}`)).toEqual(["L1:dropped", "L2:confirmed", "L3:confirmed"]);
  expect(study.rollbacks).toEqual([
    { to: 2, at: 400 },
    { to: 1, at: 500 },
  ]);
  const onDisk = io.json(studyFileName(SEARCH)) as { rollbacks: Record<string, unknown> };
  expect(Object.keys(onDisk.rollbacks).sort()).toEqual(["rb-400", "rb-500"]);
  expect(nextLineId(study.lines.map((l) => l.id))).toBe("L4");
  expect(nextLineId([])).toBe("L1");

  // A line a newer build wrote stays, and its id is not taken over.
  const file = studyFileName(SEARCH);
  const raw = io.json(file) as { lines: unknown[] };
  io.files.set(file, JSON.stringify({ ...raw, lines: [...raw.lines, { id: "L9", kind: "split" }] }));
  await putStudyLines(SEARCH, [line("L9"), line("L4")], io);
  expect((io.json(file) as { lines: { id: string; kind: string }[] }).lines.map((l) => `${l.id}:${l.kind}`)).toEqual([
    "L1:avoid",
    "L2:pin",
    "L3:judgment",
    "L4:avoid",
    "L9:split",
  ]);
});

function version(n: number, at: number, over: Partial<StudyVersion> = {}): StudyVersion {
  return { n, at, runId: `r-${n}`, base: n === 1 ? null : n - 1, entries: [], removed: [], changes: [], lines: [], overview: null, ...over };
}

test("the current version is the newest event: a new version, or a return to an older one", () => {
  expect(currentVersion([], [])).toBeNull();
  const vs = [version(1, 100), version(2, 200), version(3, 300)];
  expect(currentVersion(vs, [])).toBe(3);
  expect(currentVersion(vs, [{ to: 1, at: 350 }])).toBe(1);
  // A version made after the return is current again.
  expect(currentVersion(vs, [{ to: 1, at: 250 }])).toBe(3);
  // The latest return wins; one to a version not (yet) in the file is passed over.
  expect(currentVersion(vs, [{ to: 1, at: 350 }, { to: 2, at: 400 }])).toBe(2);
  expect(currentVersion(vs, [{ to: 4, at: 400 }])).toBe(3);
});

function item(id: string, key: string, materials: string[], subtopic: string | null = null): TopicSearchResultItem {
  return {
    id,
    key,
    keys: [key],
    kind: "paper",
    subtopic,
    title: `${key} (${id})`,
    titleFrom: "original",
    summary: `${id} summary`,
    facts: { kind: "paper", arxivId: key.slice(6), authors: [], publishedAt: null },
    links: { original: null, posts: [] },
    materials,
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 70,
  };
}

const STATS = { candidates: { x: 0, arxiv: 3 }, passedFloor: 3, pooled: 3, reranked: true, anchorMiss: 0, avoidBlocked: {}, subtopicItems: { "": 3 }, modelCalls: 2 };

function file(over: Partial<TopicSearchResult>): TopicSearchResult {
  return {
    version: 1,
    id: `topic-search-${SEARCH}-2026-10-21`,
    searchId: SEARCH,
    name: "Mechanism discovery",
    kind: "first",
    date: "2026-10-21",
    createdAt: 100,
    window: { since: 0, until: 100 },
    empty: false,
    writeup: "model",
    overview: { text: "Version one.", cites: ["E1"] },
    groups: [{ subtopic: null, items: ["E1", "E2", "E3"] }],
    quiet: [],
    items: [item("E1", "arxiv:1", ["M1"]), item("E2", "arxiv:2", ["M2"], "s1"), item("E3", "arxiv:3", ["M3"])],
    materials: [{ id: "M1" }, { id: "M2" }, { id: "M3" }] as TopicSearchResult["materials"],
    questions: [{ id: "qa", text: "First?", source: "model", template: null }],
    stats: STATS,
    runDir: "topic-search-runs/r-1",
    ...over,
  };
}

test("a version is a view of the one file: its entries in book order, their materials, its overview and questions", () => {
  const v1 = version(1, 100, {
    entries: [
      { item: "E3", place: "pinned", tag: "pinned" },
      { item: "E1", place: "main", tag: null },
      { item: "E2", place: "note", tag: null },
    ],
    overview: { text: "Version one.", cites: ["E1"] },
  });
  const first = file({ study: { versions: [v1] } });
  // The update's part: E1 rewritten as E4, E5 added, E2 gone.
  const part = file({
    createdAt: 200,
    overview: { text: "Version two.", cites: ["E4", "E5"] },
    groups: [{ subtopic: null, items: ["E4", "E5"] }],
    items: [item("E4", "arxiv:1", ["M4"]), item("E5", "arxiv:5", ["M5"], "s1")],
    materials: [{ id: "M4" }, { id: "M5" }] as TopicSearchResult["materials"],
    questions: [{ id: "qb", text: "Second?", source: "model", template: { code: "subtopic-quiet", params: {} } }],
    stats: { ...STATS, modelCalls: 5 },
    writeup: "fallback",
  });
  const merged = mergeRetry(first, part, "r-2");
  const v2 = version(2, 200, {
    entries: [
      { item: "E3", place: "pinned", tag: null },
      { item: "E5", place: "main", tag: "new" },
      { item: "E4", place: "main", tag: "rewritten" },
    ],
    removed: [{ key: "arxiv:2", title: "arxiv:2 (E2)", line: "L1" }],
    changes: [
      { kind: "add", item: "arxiv:5", line: null },
      { kind: "rewrite", item: "arxiv:1", line: "L2" },
      { kind: "remove", item: "arxiv:2", line: "L1" },
    ],
    lines: ["L1", "L2"],
    overview: { text: "Version two.", cites: ["E4", "E5"] },
  });
  const study: TopicSearchResult = {
    ...merged,
    retries: merged.retries?.map((r) => (r.runId === "r-2" ? { ...r, part: "update" as const, version: 2 } : r)),
    study: { versions: [v1, v2] },
  };

  const one = versionPart(study, 1)!;
  expect(one.items.map((i) => i.id)).toEqual(["E3", "E1", "E2"]);
  expect(one.materials.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
  expect(one.overview?.text).toBe("Version one.");
  expect(one.questions.map((q) => q.id)).toEqual(["qa"]);
  expect(one.writeup).toBe("model");
  expect(one.stats.modelCalls).toBe(2);
  expect(one.groups).toEqual([
    { subtopic: "s1", items: ["E2"] },
    { subtopic: null, items: ["E3", "E1"] },
  ]);
  expect(one.version).toBe(1);
  expect(one.studyVersion?.n).toBe(1);
  expect(one.study).toBeUndefined();
  expect(one.retries).toBeUndefined();

  const two = versionPart(study, 2)!;
  expect(two.items.map((i) => i.id)).toEqual(["E3", "E5", "E4"]);
  expect(two.materials.map((m) => m.id)).toEqual(["M3", "M4", "M5"]);
  expect(two.overview?.text).toBe("Version two.");
  expect(two.questions.map((q) => q.id)).toEqual(["qb"]);
  expect(two.writeup).toBe("fallback");
  expect(two.stats.modelCalls).toBe(5);
  expect(two.createdAt).toBe(200);
  expect(two.studyVersion?.entries.map((e) => e.tag)).toEqual([null, "new", "rewritten"]);

  expect(versionPart(study, 3)).toBeNull();
  expect(versionPart(file({}), 1)).toBeNull();
});

test("both new files are in sync range as record files, and two devices' returns both survive a merge", () => {
  expect(resolvePalace(topicLabelsFileName(SEARCH))?.row.kind).toBe("info-topic-search-labels");
  expect(resolvePalace(studyFileName(SEARCH))?.row.kind).toBe("info-topic-study");
  // Neither is taken for a result file.
  expect(resolvePalace(`topic-search-${SEARCH}-2026-10-21.json`)?.row.kind).toBe("info-topic-search-result");

  const enc = new TextEncoder();
  const body = (lines: StudyLine[], rollbacks: Record<string, { to: number; at: number }>) =>
    enc.encode(JSON.stringify({ version: 1, searchId: SEARCH, lines, rollbacks }, null, 2));
  const base = body([line("L1")], {});
  const local = body([line("L1", { usedIn: 2 }), line("L2")], { "rb-500": { to: 1, at: 500 } });
  const remote = body([line("L1"), line("L3")], { "rb-600": { to: 2, at: 600 } });
  const out = mergeFile({ path: studyFileName(SEARCH), base, local, remote });
  const merged = JSON.parse(new TextDecoder().decode(out.merged)) as { lines: StudyLine[]; rollbacks: Record<string, unknown> };
  expect(merged.lines.map((l) => `${l.id}:${l.usedIn}`).sort()).toEqual(["L1:2", "L2:null", "L3:null"]);
  expect(Object.keys(merged.rollbacks).sort()).toEqual(["rb-500", "rb-600"]);

  const labels = (ls: TopicLabel[]) => enc.encode(JSON.stringify({ version: 1, searchId: SEARCH, labels: ls }, null, 2));
  const l = mergeFile({
    path: topicLabelsFileName(SEARCH),
    base: labels([label("tl-1", "a")]),
    local: labels([label("tl-1", "a"), label("tl-2", "b")]),
    remote: labels([label("tl-1", "a"), label("tl-3", "c")]),
  });
  const ids = (JSON.parse(new TextDecoder().decode(l.merged)) as { labels: TopicLabel[] }).labels.map((x) => x.id);
  expect(ids.sort()).toEqual(["tl-1", "tl-2", "tl-3"]);
});
