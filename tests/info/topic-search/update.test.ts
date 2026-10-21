// A study's update (docs/info/91 更新): the pure parts, the ask, and the build
// end to end over fakes. No network, no model: every library and every model
// answer is scripted here. The run's cooldown wait is in runs.test.ts, beside
// the run's other fakes.

import { describe, expect, test } from "bun:test";
import type { Run } from "../../../src/legion/run/types";
import type { Delegated, DelegateInput } from "../../../src/legion/runner/worker";
import type { InfoItem } from "../../../src/info/sources/item";
import { lookUpPinned, makeResultBuilder, type BuildResultDeps, type BuildTopicSearchResultArgs } from "../../../src/info/topic-search/build-result";
import { skippedQueries } from "../../../src/info/topic-search/build-update";
import type { TopicLabel } from "../../../src/info/topic-search/labels";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import { numberPool, parseRerank, type ArxivFound } from "../../../src/info/topic-search/rank-pool";
import { parseResultFile, versionPart, type StudyVersion, type TopicSearchResult, type TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import { encodeBrief, parseBrief, topicSearchRunKey, unread } from "../../../src/info/topic-search/run";
import { askUpdateRun, nextUpdateNumber } from "../../../src/info/topic-search/run-worker";
import type { SeedPaper } from "../../../src/info/topic-search/seed-lookup";
import { selectStudy } from "../../../src/info/topic-search/select";
import type { StudyFile, StudyLine } from "../../../src/info/topic-search/study";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import {
  addedVersion,
  changeCounts,
  diffVersion,
  firstVersion,
  pinnedCandidate,
  planUpdate,
  studyMarks,
  withHeld,
  type NextEntry,
} from "../../../src/info/topic-search/update";

const SEARCH_ID = "ts-5a5a5a5a";

const TOPIC: TopicSearch = {
  id: SEARCH_ID,
  name: "Symbolic regression",
  concernId: null,
  scope: "Finding equations from data, and systems that design their next experiment.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: ["equation", "regression", "symbolic"],
  queries: [
    { id: "q1", subtopic: null, x: "symbolic regression", arxiv: "symbolic regression", ranking: "Is this symbolic regression?", weight: 1 },
    { id: "q2", subtopic: null, x: "equation discovery", arxiv: "equation discovery", ranking: "Is this equation discovery?", weight: 1 },
  ],
  answers: [],
  status: "active",
  revision: 3,
  createdAt: 0,
  lastRunAt: null,
  once: true,
  sources: ["arxiv", "huggingface"],
  seeds: [{ key: "arxiv:2601.00001", title: "A seed on symbolic regression", said: "the seed paper", at: 1 }],
};

const label = (item: string, kind: TopicLabel["label"], at: number, source: TopicLabel["source"] = "line"): TopicLabel => ({
  id: `tl-${at.toString(16).padStart(8, "0")}`,
  searchId: SEARCH_ID,
  item,
  title: item,
  label: kind,
  reason: "said so",
  source,
  evidence: "m1",
  at,
  brief: null,
  criteria: 1,
});

const line = (id: string, kind: StudyLine["kind"], item: string | null, at: number, over: Partial<StudyLine> = {}): StudyLine => ({
  id,
  kind,
  text: `${kind} ${item ?? ""}`.trim(),
  said: `the reader on ${item ?? "the topic"}`,
  evidence: "m1",
  item,
  state: "confirmed",
  at,
  usedIn: null,
  ...over,
});

const fileItem = (id: string, key: string, score: number): TopicSearchResultItem => ({ id, key, keys: [key], score }) as unknown as TopicSearchResultItem;

// --- the pure parts --------------------------------------------------------------

test("an update searches the queries the last version left first, then those asked, each once and only the topic's", () => {
  const result = { study: { versions: [{ n: 1, skipped: ["q1"] }, { n: 2, skipped: ["q2"] }] } } as unknown as TopicSearchResult;
  expect(planUpdate(TOPIC, result, ["q1", "q2", "q9"])).toEqual(["q2", "q1"]);
  expect(planUpdate(TOPIC, null, ["q1"])).toEqual(["q1"]);
});

test("pinned and demoted go by the reader's last word, across versions; rewrites are this update's only", () => {
  const labels = [label("arxiv:s", "yes", 1, "seed"), label("arxiv:s", "pinned", 1, "seed"), label("arxiv:b", "borderline", 5), label("arxiv:c", "pinned", 3)];
  const earlier = [line("L1", "demote", "arxiv:b", 5, { usedIn: 2 }), line("L2", "rewrite", "arxiv:a", 4, { usedIn: 2 })];
  const now = [line("L3", "pin", "arxiv:b", 8), line("L4", "rewrite", "arxiv:c", 9), line("L5", "demote", "arxiv:x", 9, { state: "dropped" })];
  const marks = studyMarks(labels, now, earlier);
  // The seed stays pinned with no line; b was demoted, then pinned: the pin is the last word.
  expect([...marks.pinned]).toEqual([
    ["arxiv:s", null],
    ["arxiv:c", null],
    ["arxiv:b", "L3"],
  ]);
  expect([...marks.demoted]).toEqual([]);
  expect([...marks.rewrite.keys()]).toEqual(["arxiv:c"]);
  // A later label that is not a pin unpins (the reader's newer word on the item).
  expect(studyMarks([...labels, label("arxiv:s", "no", 20, "question")], [], []).pinned.has("arxiv:s")).toBe(false);
  // A demote line of an earlier version still holds in a later one.
  expect([...studyMarks(labels, [], earlier).demoted]).toEqual([["arxiv:b", "L1"]]);
});

test("version 1: the seeds pinned first in seed order, then the entries and the Notes by score", () => {
  const result = {
    items: [fileItem("E1", "arxiv:a", 30), fileItem("E2", "arxiv:s", 10), fileItem("E3", "arxiv:b", 80)],
    overview: null,
    createdAt: 7,
  } as unknown as TopicSearchResult;
  const v1 = firstVersion(result, "r-first", [{ key: "arxiv:s", title: "S", said: "s", at: 1 }]);
  expect(v1).toMatchObject({ n: 1, at: 7, runId: "r-first", base: null, removed: [], changes: [] });
  expect(v1.entries).toEqual([
    { item: "E2", place: "pinned", tag: null },
    { item: "E3", place: "main", tag: null },
    { item: "E1", place: "note", tag: null },
  ]);
});

test("the next version against its base: each change with the line that caused it", () => {
  const items = ["a", "b", "c", "d", "g"].map((k, i) => fileItem(`E${i + 1}`, `arxiv:${k}`, 70));
  const base: StudyVersion = {
    n: 1,
    at: 1,
    runId: "r-first",
    base: null,
    entries: [
      { item: "E1", place: "pinned", tag: null },
      { item: "E2", place: "main", tag: null },
      { item: "E3", place: "main", tag: null },
      { item: "E5", place: "main", tag: null },
      { item: "E4", place: "note", tag: null },
    ],
    removed: [],
    changes: [],
    lines: [],
    overview: null,
  };
  const marks = studyMarks([label("arxiv:a", "pinned", 1, "seed"), label("arxiv:b", "borderline", 5)], [
    line("L1", "demote", "arxiv:b", 5),
    line("L3", "rewrite", "arxiv:c", 6),
    line("L4", "pin", "arxiv:f", 7),
    line("L6", "pin", "arxiv:g", 7),
  ]);
  const at = (key: string, place: NextEntry["place"], because: string | null = null): NextEntry => ({ key: `arxiv:${key}`, keys: [`arxiv:${key}`], place, score: 70, because });
  const next = [at("a", "pinned"), at("f", "pinned"), at("g", "pinned"), at("c", "main"), at("e", "main", "L2"), at("b", "note", "L9")];
  const diff = diffVersion(base, items, next, marks, new Map([["arxiv:d", "L5"]]));
  expect(diff.entries.map((e) => [e.key, e.place, e.keep, e.from, e.tag])).toEqual([
    ["arxiv:a", "pinned", "E1", null, null],
    ["arxiv:f", "pinned", null, null, "new"],
    ["arxiv:g", "pinned", "E5", null, "pinned"],
    ["arxiv:c", "main", null, "E3", "rewritten"],
    ["arxiv:e", "main", null, null, "new"],
    ["arxiv:b", "note", "E2", null, "demoted"],
  ]);
  expect(diff.entries.find((e) => e.key === "arxiv:c")?.rewrite?.id).toBe("L3");
  // The pin and demote lines name themselves over the rerank's because; a removal takes the rerank's.
  expect(diff.changes).toEqual([
    { kind: "add", item: "arxiv:f", line: "L4" },
    { kind: "pin", item: "arxiv:g", line: "L6" },
    { kind: "rewrite", item: "arxiv:c", line: "L3" },
    { kind: "add", item: "arxiv:e", line: "L2" },
    { kind: "demote", item: "arxiv:b", line: "L1" },
    { kind: "remove", item: "arxiv:d", line: "L5" },
  ]);
  expect(diff.removed).toEqual([{ key: "arxiv:d", title: undefined as unknown as string, line: "L5" }]);
  expect(changeCounts(diff.changes)).toBe("add 2 · remove 1 · demote 1 · rewrite 1 · pin 1");
  expect(changeCounts([])).toBe("no change");
});

test("what a study's slow part or retry adds is the next version: the base kept, the new joined by score", () => {
  const base = firstVersion({ items: [fileItem("E1", "arxiv:a", 80)], overview: null, createdAt: 1 } as unknown as TopicSearchResult, "r-first");
  const v2 = addedVersion(base, 1, [fileItem("E2", "x:1", 30), fileItem("E3", "arxiv:s", 20)], "r-first", 9, [{ key: "arxiv:s", title: "S", said: "s", at: 1 }]);
  expect(v2).toMatchObject({ n: 2, at: 9, runId: "r-first", base: 1, removed: [], lines: [] });
  expect(v2!.entries).toEqual([
    { item: "E3", place: "pinned", tag: "new" },
    { item: "E1", place: "main", tag: null },
    { item: "E2", place: "note", tag: "new" },
  ]);
  expect(v2!.changes).toEqual([
    { kind: "add", item: "x:1", line: null },
    { kind: "add", item: "arxiv:s", line: null },
  ]);
  expect(addedVersion(base, 1, [], "r-first", 9)).toBeNull();
});

const SEED: SeedPaper = { arxivId: "2601.00001", doi: null, title: "Program search for physical laws", authors: ["S. Eed"], date: "2026-01-05" };

test("a pinned paper no read found joins the pool by its key; the floor and the fusion leave no held one out", async () => {
  const cand = pinnedCandidate(SEED, 0)!;
  expect(cand).toMatchObject({ key: "arxiv:2601.00001", kind: "paper", queries: [], paper: { id: "2601.00001", url: "https://arxiv.org/abs/2601.00001" } });
  expect(pinnedCandidate({ ...SEED, arxivId: null, doi: "10.1/x" }, 0)).toBeNull();
  const other = { ...cand, key: "arxiv:2601.00009" };
  const pool = withHeld([{ cand: other, rrf: 0.5 }], [other, cand, cand], new Set([cand.key]));
  expect(pool.map((p) => [p.cand.key, p.rrf])).toEqual([
    ["arxiv:2601.00009", 0.5],
    ["arxiv:2601.00001", 0],
  ]);
  const asked: string[] = [];
  const seedPaper = async (id: string) => (asked.push(id), id === SEED.arxivId ? SEED : null);
  const signal = new AbortController().signal;
  const looked = await lookUpPinned(["arxiv:2601.00001", "arxiv:2601.00002", "doi:10.1/x", "arxiv:2601.00009"], new Set(["arxiv:2601.00009"]), { seedPaper }, 0, signal);
  expect(looked.map((c) => c.key)).toEqual(["arxiv:2601.00001"]);
  // DOI-only keys and keys a read already found are not looked up; a lookup that throws leaves the paper out.
  expect(asked).toEqual(["2601.00001", "2601.00002"]);
  expect(await lookUpPinned(["arxiv:2601.00001"], new Set(), { seedPaper: async () => Promise.reject(new Error("cooling down")) }, 0, signal)).toEqual([]);
});

test("the rerank's because names only a line this update was given; other runs carry none", () => {
  const numbered = numberPool([{ cand: pinnedCandidate(SEED, 0)!, rrf: 0 }, { cand: { ...pinnedCandidate(SEED, 0)!, key: "arxiv:2601.00002" }, rrf: 0 }]);
  const reply = JSON.stringify({ items: [{ c: "c1", score: 80, main: "self", subtopic: null, because: "L2" }, { c: "c2", score: 20, main: "self", subtopic: null, because: "L9" }] });
  const answers = parseRerank(reply, numbered, TOPIC, new Set(["L1", "L2"]));
  expect(answers.get("c1")?.because).toBe("L2");
  expect(answers.get("c2")?.because).toBeNull();
  expect("because" in parseRerank(reply, numbered, TOPIC).get("c1")!).toBe(false);
});

test("a study lists every pinned item first, over the count and under the floor, then selects the rest", () => {
  type T = { id: string; s: number; pin: boolean };
  const view = { score: (t: T) => t.s, postScore: () => null, subtopic: () => null, pinned: (t: T) => t.pin };
  const ranked: T[] = [
    { id: "a", s: 90, pin: false },
    { id: "b", s: 60, pin: false },
    { id: "c", s: 2, pin: true },
  ];
  expect(selectStudy(ranked, 2, [], view).map((t) => t.id)).toEqual(["c", "a"]);
  expect(selectStudy(ranked, 1, [], view).map((t) => t.id)).toEqual(["c"]);
});

test("the update's key counts asks, not versions", () => {
  const brief = { searchId: SEARCH_ID, kind: "update" as const, night: null, n: 3, lines: ["L1"], queries: ["q2"] };
  expect(topicSearchRunKey(brief)).toBe(`topic-search:${SEARCH_ID}:update:3`);
  expect(parseBrief(encodeBrief(brief))).toEqual(brief);
  expect(parseBrief(JSON.stringify({ searchId: SEARCH_ID, kind: "update", n: 0 }))).toBeNull();
  expect(nextUpdateNumber([`topic-search:${SEARCH_ID}:update:2`, `topic-search:ts-other:update:7`, undefined, `topic-search:${SEARCH_ID}:first`], SEARCH_ID)).toBe(3);
});

test("the queries a cooldown held back, or the read never reached, are left for the next update", () => {
  const found = (query: string, outcome: "direct" | "cooling_down" | "rate_limited"): ArxivFound => ({ query, items: [], error: null, ladder: { outcome } as ArxivFound["ladder"] });
  expect(skippedQueries(["q1", "q2", "q3"], [found("q1", "direct"), found("q2", "cooling_down")], [found("q1", "rate_limited")])).toEqual(["q2", "q1", "q3"]);
  expect(skippedQueries(["q1"], [found("q1", "direct")], [])).toEqual([]);
});

// --- the ask -----------------------------------------------------------------------

describe("asking for an update", () => {
  const runOf = (kind: "first" | "retry" | "update" | "daily", state: string, n?: number, searchId = SEARCH_ID): Run => {
    const brief = { searchId, kind, night: kind === "daily" ? "2026-10-20" : null, ...(n ? { n } : {}) };
    return { id: `run-${kind}-${n ?? 0}`, state, brief: encodeBrief(brief), idempotencyKey: topicSearchRunKey(brief) } as unknown as Run;
  };
  const ports = (runs: Run[]) => {
    const asked: DelegateInput[] = [];
    return {
      asked,
      ports: {
        runs: async () => runs,
        delegate: async (input: DelegateInput): Promise<Delegated> => {
          asked.push(input);
          return { ok: true, run: { id: "run-new" } as unknown as Run, existing: false } as Delegated;
        },
      },
    };
  };

  test("busy while the first look, a retry or an update of the study is pending or running", async () => {
    for (const [kind, n] of [["first", undefined], ["retry", 1], ["update", 2]] as const) {
      for (const state of ["pending", "running"]) {
        const p = ports([runOf(kind, state, n)]);
        expect(await askUpdateRun(SEARCH_ID, {}, p.ports)).toMatchObject({ status: "busy", what: kind });
        expect(p.asked).toEqual([]);
      }
    }
  });

  test("otherwise asked under one past the asks on file, with its lines and queries", async () => {
    const p = ports([runOf("first", "done"), runOf("update", "done", 1), runOf("update", "failed", 2), runOf("daily", "running"), runOf("update", "running", 5, "ts-other")]);
    const out = await askUpdateRun(SEARCH_ID, { lines: ["L4"], queries: ["q2"] }, p.ports);
    expect(out).toMatchObject({ status: "asked", n: 3 });
    expect(p.asked[0].idempotencyKey).toBe(`topic-search:${SEARCH_ID}:update:3`);
    expect(parseBrief(p.asked[0].brief as string)).toEqual({ searchId: SEARCH_ID, kind: "update", night: null, n: 3, lines: ["L4"], queries: ["q2"] });
  });
});

// --- the build, end to end ------------------------------------------------------------

const paper = (n: number, title: string): InfoItem => ({
  id: `arxiv-2601.0000${n}`,
  source: "arxiv",
  sourceName: "arXiv",
  sourceKey: `2601.0000${n}`,
  title,
  url: `https://arxiv.org/abs/2601.0000${n}`,
  publishedAt: "2026-01-10T00:00:00Z",
  textContent: `${title}: symbolic regression, ${title.toLowerCase()}.`,
  summaryOnly: true,
  authors: ["Ada Lovelace"],
});

const P1 = paper(2, "Agents that plan their next experiment");
const P2 = paper(3, "Equation discovery from sparse data");
const P3 = paper(4, "A benchmark for formula fitting");
const P4 = paper(5, "Turbulence closures learned by search");
const TITLES = new Map([SEED, P1, P2, P3, P4].map((p) => ["arxivId" in p ? p.arxivId! : p.sourceKey!, p.title]));

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><nav>arXiv menu</nav><article><h2>Abstract</h2><p>${title}.</p>` +
  `<h2>1 Introduction</h2><p>${"Equations are found from data. ".repeat(200)}</p><h2>2 Method</h2><p>${"A model proposes a form and fits it. ".repeat(200)}</p></article></body></html>`;

/** The rerank scored per paper: the first look's, or the update's (it is shown the reader's lines) with the line behind each. */
const FIRST_SCORES: Record<string, number> = { "2601.00001": 30, "2601.00002": 90, "2601.00004": 85, "2601.00005": 80 };
const UPDATE_SCORES: Record<string, [number, string | null]> = {
  "2601.00001": [5, null],
  "2601.00002": [85, null],
  "2601.00003": [80, "L2"],
  "2601.00004": [70, null],
  "2601.00005": [0, "L2"],
};

function studyModel(log: TopicModelCall[], fail: { rerank?: boolean; write?: boolean } = {}) {
  return async (call: TopicModelCall): Promise<string> => {
    log.push(call);
    const update = call.user.includes("Lines the reader confirmed:");
    if (call.site === "rerank") {
      if (update && fail.rerank) throw new Error("the rerank's answer was cut off");
      const items = [...call.user.matchAll(/(c\d+) · paper · .*? · arXiv (\S+)/g)].map((m) => {
        const [score, because] = update ? (UPDATE_SCORES[m[2]] ?? [50, null]) : [FIRST_SCORES[m[2]] ?? 50, null];
        return { c: m[1], score, main: "self", subtopic: null, ...(update ? { because } : {}) };
      });
      return JSON.stringify({ items });
    }
    if (call.site === "write" && update && fail.write) throw new Error("the write-up came back empty");
    const own = call.user.split("Already in this result (no entries):")[0];
    const blocks = [...own.matchAll(/<material id="(E\d+)">\n[\s\S]*?<\/material>/g)];
    const items = blocks.map((b) => ({
      e: b[1],
      conclusion: "Work on finding equations from data.",
      method: [[{ text: "A model proposes a form and fits it.", cite: [/^(M\d+\.§\d+) /m.exec(b[0])?.[1] ?? "M0.§1"] }]],
      results: [],
    }));
    return JSON.stringify({ overview: { text: `Equation discovery leads; see ${blocks[0]?.[1] ?? "E1"}.`, cites: [blocks[0]?.[1] ?? "E1"] }, items });
  };
}

function world(fail: { rerank?: boolean; write?: boolean } = {}) {
  const files = new Map<string, string>();
  const log: TopicModelCall[] = [];
  const used: StudyLine[][] = [];
  const looked: string[] = [];
  const lines = [
    line("L1", "demote", "arxiv:2601.00004", 10),
    line("L2", "judgment", null, 11, { text: "Prefer equation discovery from sparse data" }),
    line("L3", "rewrite", "arxiv:2601.00002", 12, { text: "Say who runs each step" }),
  ];
  const labels = [label("arxiv:2601.00001", "yes", 1, "seed"), label("arxiv:2601.00001", "pinned", 1, "seed"), label("arxiv:2601.00004", "borderline", 10)];
  const now = Date.parse("2026-10-21T08:00:00Z");
  const deps: BuildResultDeps = {
    model: studyModel(log, fail),
    sleep: async () => {},
    fetchText: async (url) => {
      const id = /arxiv\.org\/html\/(\d{4}\.\d{5})/.exec(url)?.[1];
      return id && TITLES.has(id) ? { status: 200, text: html(TITLES.get(id)!) } : { status: 404, text: "" };
    },
    openLink: async () => ({ ok: false, code: "not_found", reason: "not in this test" }),
    repoLookups: () => ({ lookup: async () => ({ kind: "missing" }) as never, quotaLeft: () => 50 }),
    files: {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void files.set(p, c),
      list: async (prefix) => [...files.keys()].filter((k) => !k.includes("/") && k.startsWith(prefix)),
    },
    profile: async () => [],
    known: async () => [],
    language: async () => "",
    labels: async () => labels,
    study: async (): Promise<StudyFile> => ({ version: 1, searchId: SEARCH_ID, lines, rollbacks: [] }),
    useLines: async (_id, l) => void used.push([...l]),
    seedPaper: async (id) => (looked.push(id), id === SEED.arxivId ? SEED : null),
    now: () => now,
    today: () => "2026-10-21",
  };
  const build = makeResultBuilder(deps);
  const signal = new AbortController().signal;
  const x = unread("unavailable", "not one of the topic's sources");
  const firstArxiv: ArxivFound[] = [{ query: "q1", items: [P1, P3, P4], error: null }];
  const args = (over: Partial<BuildTopicSearchResultArgs>): BuildTopicSearchResultArgs => ({
    topic: TOPIC,
    kind: "first",
    x,
    arxiv: [],
    huggingface: [],
    since: now - 365 * 86_400_000,
    runDir: "runs/r-first",
    xPages: { take: async () => true },
    signal,
    ...over,
  });
  return {
    files,
    log,
    used,
    looked,
    first: () => build(args({ arxiv: firstArxiv, runId: "r-first" })),
    update: () =>
      build(
        args({
          arxiv: [{ query: "q2", items: [P2], error: null }],
          runDir: "runs/r-up",
          runId: "r-up",
          update: { runId: "r-up", lines: null, queries: ["q2"] },
          carry: async (id) => (id === "r-first" ? { x: null, arxiv: firstArxiv, huggingface: [] } : null),
        }),
      ),
  };
}

const keyOf = (r: TopicSearchResult, id: string) => r.items.find((i) => i.id === id)!.key;

describe("an update built end to end", () => {
  test("version 1 has the seed no read found, pinned, looked up by its key", async () => {
    const w = world();
    const out = await w.first();
    const r = parseResultFile(w.files.get(out.resultFile!)!)!;
    expect(w.looked).toEqual(["2601.00001"]);
    const v1 = r.study!.versions[0];
    expect(v1).toMatchObject({ n: 1, runId: "r-first", base: null });
    expect(v1.entries[0]).toMatchObject({ place: "pinned" });
    expect(keyOf(r, v1.entries[0].item)).toBe("arxiv:2601.00001");
    expect(v1.entries.slice(1).every((e) => e.place !== "pinned")).toBe(true);
    expect(r.items.find((i) => i.key === "arxiv:2601.00001")?.title).toBe(SEED.title);
  });

  test("version 2: pinned kept, demoted, rewritten as asked, the new read in full, removed; each change with its line", async () => {
    const w = world();
    await w.first();
    const out = await w.update();
    expect(out).toMatchObject({ version: 2, changes: "add 1 · remove 1 · demote 1 · rewrite 1" });
    const r = parseResultFile(w.files.get(out.resultFile!)!)!;
    const [v1, v2] = r.study!.versions;
    expect(v2).toMatchObject({ n: 2, runId: "r-up", base: 1, lines: ["L1", "L2", "L3"] });
    expect(new Set(v2.changes.map((c) => `${c.kind} ${c.item} ${c.line}`))).toEqual(
      new Set(["rewrite arxiv:2601.00002 L3", "add arxiv:2601.00003 L2", "demote arxiv:2601.00004 L1", "remove arxiv:2601.00005 L2"]),
    );
    expect(v2.removed).toEqual([{ key: "arxiv:2601.00005", title: P4.title, line: "L2" }]);
    const place = (v: StudyVersion, key: string) => v.entries.find((e) => keyOf(r, e.item) === key);
    // The seed the rerank scored 5 stays pinned, its text as version 1 had it.
    expect(place(v2, "arxiv:2601.00001")).toEqual(place(v1, "arxiv:2601.00001"));
    expect(place(v2, "arxiv:2601.00004")).toEqual({ item: place(v1, "arxiv:2601.00004")!.item, place: "note", tag: "demoted" });
    // Rewritten: a new id under the same key; version 1 keeps its own text.
    const rewritten = place(v2, "arxiv:2601.00002")!;
    expect(rewritten.tag).toBe("rewritten");
    expect(rewritten.item).not.toBe(place(v1, "arxiv:2601.00002")!.item);
    const writes = w.log.filter((c) => c.site === "write" && c.user.includes("Lines the reader confirmed:"));
    expect(writes[0].user).toContain("Rewrite as the reader asked: Say who runs each step");
    // Only the new and the rewritten are written; the kept are alongside.
    const written = writes[0].user.split("Already in this result (no entries):")[0];
    expect([...written.matchAll(/<material id="(E\d+)">/g)].map((m) => m[1]).sort()).toEqual([rewritten.item, place(v2, "arxiv:2601.00003")!.item].sort());
    // The new paper was read in full before the write-up.
    const fresh = r.items.find((i) => i.key === "arxiv:2601.00003")!;
    expect(fresh.facts).toMatchObject({ depth: "full" });
    expect(place(v2, "arxiv:2601.00003")!.tag).toBe("new");
    // The update's record and the version's view.
    expect(r.retries?.[r.retries.length - 1]).toMatchObject({ runId: "r-up", part: "update", version: 2 });
    expect(versionPart(r, 2)!.items.map((i) => i.key)).toContain("arxiv:2601.00003");
    expect(versionPart(r, 1)!.items.map((i) => i.key)).toContain("arxiv:2601.00005");
    // The lines are marked with the version they made.
    expect(w.used[0].map((l) => [l.id, l.usedIn])).toEqual([
      ["L1", 2],
      ["L2", 2],
      ["L3", 2],
    ]);
  });

  test("a rerank that fails makes no version: the base stays current and nothing is listed", async () => {
    const w = world({ rerank: true });
    const first = await w.first();
    const before = parseResultFile(w.files.get(first.resultFile!)!)!;
    const out = await w.update();
    expect(out).toMatchObject({ version: null, itemCount: 0, empty: true });
    expect(out.unjudged).toBeGreaterThan(0);
    const r = parseResultFile(w.files.get(out.resultFile!)!)!;
    expect(r.study!.versions.map((v) => v.n)).toEqual([1]);
    expect(r.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    const record = r.retries![r.retries!.length - 1];
    expect(record).toMatchObject({ runId: "r-up", part: "update", items: [] });
    expect(record.version).toBeUndefined();
    expect(w.used).toEqual([]);
  });

  test("a write-up that fails fails the build: the file is as it was and the lines stay unused", async () => {
    const w = world({ write: true });
    const first = await w.first();
    const before = w.files.get(first.resultFile!);
    await expect(w.update()).rejects.toThrow("version 2");
    expect(w.files.get(first.resultFile!)).toBe(before);
    expect(w.used).toEqual([]);
  });
});
