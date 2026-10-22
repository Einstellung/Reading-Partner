import { expect, test } from "bun:test";
import type { InfoItem } from "../../../src/info/sources/item";
import {
  candidatePool,
  formatComparison,
  formatReport,
  importedLabels,
  keyOfRef,
  parseSeedLines,
  rankedItems,
  replayLabels,
  routeAttribution,
  routeLines,
  titleForm,
  type RunReads,
} from "../../../src/info/topic-search/label-replay";
import type { GraphRead } from "../../../src/info/topic-search/graph-read";
import { validateTopicLabel, type TopicLabel, type TopicLabelKind } from "../../../src/info/topic-search/labels";
import type { ArxivFound } from "../../../src/info/topic-search/rank-pool";
import type { StudyVersion, TopicSearchResult, TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";

const TOPIC: TopicSearch = {
  id: "ts-1",
  name: "Symbolic regression",
  concernId: null,
  scope: "Symbolic regression for physics.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [{ id: "q1", subtopic: null, x: "symbolic regression", arxiv: "symbolic regression", ranking: "", weight: 1 }],
  answers: [],
  status: "active",
  revision: 3,
  createdAt: 0,
  lastRunAt: null,
};

function item(id: string, key: string, score: number, keys: string[] = [key]): TopicSearchResultItem {
  return { id, key, keys, title: `Title of ${key}`, score, materials: [] } as unknown as TopicSearchResultItem;
}

function result(items: TopicSearchResultItem[], study?: StudyVersion[]): TopicSearchResult {
  return {
    version: 1,
    id: "topic-search-ts-1-2026-10-21",
    searchId: "ts-1",
    items,
    materials: [],
    questions: [],
    groups: [],
    runDir: "topic-search-runs/r1",
    ...(study ? { study: { versions: study } } : {}),
  } as unknown as TopicSearchResult;
}

let n = 0;
function label(item: string, kind: TopicLabelKind, at = ++n): TopicLabel {
  return { id: `tl-${String(at).padStart(8, "0")}`, searchId: "ts-1", item, title: "", label: kind, reason: "", source: "line", evidence: "m1", at, brief: null, criteria: 1 };
}

function paper(id: string, title: string): InfoItem {
  return { id: `arxiv-${id}`, source: "arxiv", sourceName: "arXiv", sourceKey: id, title, url: `https://arxiv.org/abs/${id}`, publishedAt: "2026-10-02T10:00:00Z", textContent: `${title}. An abstract.` };
}

// Scores 90, 70, 50, 30: E1 rank 1, E3 rank 2, E2 rank 3, E4 rank 4. E4 is a post that led to a paper.
const RESULT = result([
  item("E1", "arxiv:2610.00001", 90),
  item("E2", "arxiv:2610.00002", 50),
  item("E3", "github:a/b", 70),
  item("E4", "x:123", 30, ["x:123", "arxiv:2610.00009"]),
]);

const LABELS = [
  label("arxiv:2610.00002", "no", 1),
  label("arxiv:2610.00002", "yes", 2), // outranks the no
  label("github:a/b", "pinned"),
  label("arxiv:2610.00009", "yes"),
  label("arxiv:2610.00005", "yes"),
  label("arxiv:2610.00006", "yes"),
  label("arxiv:2610.00007", "yes"),
  label("arxiv:2610.00001", "no"),
  label("x:999", "borderline"),
];

const found: ArxivFound[] = [
  { query: "q1", items: [paper("2610.00005", "Symbolic regression for physical laws"), paper("2610.00006", "Cooking with cast iron pans")], error: null },
];
const READS: RunReads[] = [{ x: null, arxiv: found, huggingface: [] }];

test("recall, ranks, MRR and top-n count yes and pinned; no and borderline are told apart", () => {
  const r = replayLabels(LABELS, rankedItems(RESULT), null);
  expect(r.items).toBe(4);
  expect(r.positives.total).toBe(6);
  expect(r.positives.found).toBe(3);
  expect(r.positives.recall).toBeCloseTo(0.5);
  expect(r.positives.mrr).toBeCloseTo((1 / 3 + 1 / 2 + 1 / 4) / 6);
  expect(r.positives.top).toEqual({ 10: 3, 20: 3 });
  const rankOf = (key: string) => r.rows.find((x) => x.item === key)?.rank;
  expect(rankOf("arxiv:2610.00002")).toBe(3);
  expect(rankOf("github:a/b")).toBe(2);
  // Matched through the post's keys, the way the pipeline merged it.
  expect(rankOf("arxiv:2610.00009")).toBe(4);
  expect(r.negatives).toEqual({ total: 1, found: 1, ranks: [1] });
  expect(r.borderline).toEqual({ total: 1, found: 0 });
  expect(r.missing.unknown).toBe(3);
  expect(r.pool).toBe("none");
});

test("with the runs' reads, missing labels split into not retrieved and retrieved but not selected; with the topic, the floor too", () => {
  const plain = replayLabels(LABELS, rankedItems(RESULT), candidatePool(READS, null));
  expect(plain.missing["not-retrieved"]).toBe(1);
  expect(plain.missing["retrieved-not-selected"]).toBe(2);

  const floor = replayLabels(LABELS, rankedItems(RESULT), candidatePool(READS, TOPIC), true);
  const why = (key: string) => floor.rows.find((x) => x.item === key)?.missing;
  expect(why("arxiv:2610.00005")).toBe("not-selected");
  expect(why("arxiv:2610.00006")).toBe("under-floor");
  expect(why("arxiv:2610.00007")).toBe("not-retrieved");
  expect(floor.pool).toBe("floor");
});

test("a study's file is read as its latest version unless one is named, with each item's place", () => {
  const v = (n: number, entries: StudyVersion["entries"]): StudyVersion => ({ n, at: n, runId: `r${n}`, base: n > 1 ? n - 1 : null, entries, removed: [], changes: [], lines: [], overview: null });
  const study = result(
    [item("E1", "arxiv:2610.00001", 40), item("E2", "arxiv:2610.00002", 80), item("E3", "arxiv:2610.00003", 60)],
    [
      v(1, [{ item: "E1", place: "pinned", tag: "pinned" }, { item: "E2", place: "main", tag: null }]),
      v(2, [{ item: "E1", place: "pinned", tag: null }, { item: "E2", place: "main", tag: null }, { item: "E3", place: "note", tag: "new" }]),
    ],
  );
  const latest = rankedItems(study);
  expect(latest.version).toBe(2);
  expect(latest.items.map((i) => [i.id, i.rank, i.place])).toEqual([["E2", 1, "main"], ["E3", 2, "note"], ["E1", 3, "pinned"]]);
  expect(rankedItems(study, 1).items.map((i) => i.id)).toEqual(["E2", "E1"]);
  expect(() => rankedItems(study, 5)).toThrow();
});

test("the report prints a table and one line per metric; two results print side by side", () => {
  const a = replayLabels(LABELS, rankedItems(RESULT), candidatePool(READS, TOPIC), true);
  const text = formatReport(a);
  expect(text).toContain("recall: 3/6 yes/pinned labels are in the result (50%)");
  expect(text).toContain("no: 1/1 no-labelled items are in the result, at rank 1");
  expect(text).toContain("borderline: 0/1 in the result (listed, not counted)");
  expect(text).toContain("missing: 3 (not retrieved 1; retrieved, under the relevance floor 1; retrieved, past the floor, not selected 1)");
  expect(formatReport(replayLabels(LABELS, rankedItems(RESULT), null))).toContain("no run reads at hand");

  const b = replayLabels(LABELS, rankedItems(result([item("E1", "arxiv:2610.00005", 10)])), null);
  const both = formatComparison(a, b, ["a.json", "b.json"]);
  expect(both).toContain("A recall: 3/6");
  expect(both).toContain("B recall: 1/6");
});

test("a seed list: label first, an optional reason after ' | ', comments and blank lines skipped", () => {
  const { lines, bad } = parseSeedLines(
    ["# my list", "", "yes 2610.00001 | exactly this", "No https://arxiv.org/abs/2610.00002v3", "borderline Symbolic Regression for Physical Laws", "maybe 2610.00003", "yes"].join("\n"),
  );
  expect(lines).toEqual([
    { line: 3, label: "yes", ref: "2610.00001", reason: "exactly this" },
    { line: 4, label: "no", ref: "https://arxiv.org/abs/2610.00002v3", reason: "" },
    { line: 5, label: "borderline", ref: "Symbolic Regression for Physical Laws", reason: "" },
  ]);
  expect(bad.map((b) => b.line)).toEqual([6, 7]);
});

test("refs key the way the pipeline keys items; a title is not a key", () => {
  expect(keyOfRef("2610.00001v2")).toBe("arxiv:2610.00001");
  expect(keyOfRef("arXiv:2610.00001")).toBe("arxiv:2610.00001");
  expect(keyOfRef("https://arxiv.org/pdf/2610.00001v1")).toBe("arxiv:2610.00001");
  expect(keyOfRef("https://huggingface.co/papers/2610.00001")).toBe("arxiv:2610.00001");
  expect(keyOfRef("10.48550/arXiv.2610.00003")).toBe("arxiv:2610.00003");
  expect(keyOfRef("10.1038/s41586-024-07421-0")).toBe("doi:10.1038/s41586-024-07421-0");
  expect(keyOfRef("https://github.com/Owner/Repo/tree/main")).toBe("github:owner/repo");
  expect(keyOfRef("github:Owner/Repo")).toBe("github:owner/repo");
  expect(keyOfRef("Symbolic regression for physical laws")).toBeNull();
});

test("imported labels resolve titles against what is known, carry source import, and leave unknown titles out", () => {
  const { lines } = parseSeedLines(["yes 2610.00001 | this", "borderline symbolic regression for physical laws!", "no Some unknown title"].join("\n"));
  const known = new Map([[titleForm("Symbolic regression for physical laws"), { key: "arxiv:2610.00005", title: "Symbolic regression for physical laws" }]]);
  const knownByKey = new Map([["arxiv:2610.00001", "The first paper"]]);
  const { labels, unresolved } = importedLabels(lines, known, knownByKey, { searchId: "ts-1", file: "seeds.txt", criteria: 3, now: 1000, random: () => 0 });
  expect(labels.map((l) => [l.item, l.label, l.title, l.reason, l.evidence, l.at])).toEqual([
    ["arxiv:2610.00001", "yes", "The first paper", "this", "import:seeds.txt:1", 1000],
    ["arxiv:2610.00005", "borderline", "Symbolic regression for physical laws", "", "import:seeds.txt:2", 1001],
  ]);
  expect(labels.every((l) => l.source === "import" && l.criteria === 3 && l.brief === null && validateTopicLabel(l) !== null)).toBe(true);
  expect(unresolved.map((u) => u.line)).toEqual([3]);
});

// --- route attribution ---------------------------------------------------------

function graphRead(streams: { kind: "rec" | "cites" | "refs"; ids: string[] }[]): GraphRead {
  return {
    version: 1,
    positives: [],
    negatives: [],
    streams: streams.map((s, i) => ({
      id: s.kind === "rec" ? "rec" : `${s.kind}:arxiv:2601.0000${i}`,
      kind: s.kind,
      from: [],
      library: "s2",
      outcome: "ok",
      total: s.ids.length,
      papers: s.ids.map((id) => ({ arxivId: id, title: `Graph ${id}`, abstract: "", authors: [], publishedAt: "", citationCount: null })),
      at: "",
    })),
    doiOnly: { count: 0, titles: [] },
  };
}

test("each labelled item is attributed to the earliest route that read it, and yes found by one route alone are counted", () => {
  const runs: RunReads[] = [
    {
      x: null,
      arxiv: [{ query: "q1", items: [paper("2610.00011", "A"), paper("2610.00012", "B")], error: null }],
      huggingface: [],
      graph: graphRead([
        { kind: "rec", ids: ["2610.00012", "2610.00013"] },
        { kind: "cites", ids: ["2610.00014", "2610.00013"] },
      ]),
      round2: {
        arxiv: [{ query: "w1", items: [paper("2610.00015", "E"), paper("2610.00014", "D")], error: null }],
        huggingface: [],
        graph: graphRead([{ kind: "refs", ids: ["2610.00016"] }]),
      },
    },
  ];
  const labels = [
    label("arxiv:2610.00011", "yes"), // query-1 alone
    label("arxiv:2610.00012", "yes"), // query-1 and graph-1 rec
    label("arxiv:2610.00013", "pinned"), // graph-1 rec and cites
    label("arxiv:2610.00014", "no"), // graph-1 cites, query-2
    label("arxiv:2610.00015", "yes"), // query-2 alone
    label("arxiv:2610.00016", "yes"), // graph-2 refs alone
    label("arxiv:2610.00017", "yes"), // nowhere
  ];
  const r = routeAttribution(labels, runs);
  const row = (k: string) => r.rows.find((x) => x.item === `arxiv:${k}`)!;
  expect(row("2610.00012").first).toBe("query-1");
  expect(row("2610.00012").found).toEqual({ "query-1:arxiv": 2, "graph-1:rec": 1 });
  expect(row("2610.00013").found).toEqual({ "graph-1:rec": 2, "graph-1:cites": 2 });
  expect(row("2610.00014").first).toBe("graph-1");
  expect(row("2610.00017").first).toBeNull();
  expect(r.first["query-1"]).toEqual({ yes: 2, no: 0, borderline: 0 });
  expect(r.first["graph-1"]).toEqual({ yes: 1, no: 1, borderline: 0 });
  expect(r.first["query-2"].yes).toBe(1);
  expect(r.first["graph-2"].yes).toBe(1);
  expect(r.first.none.yes).toBe(1);
  expect(r.aloneByRoute).toEqual({ "query-1": 1, "graph-1": 1, "query-2": 1, "graph-2": 1 });
  // 00013 is read by two graph-1 streams: alone by route, not by stream.
  expect(r.aloneByStream).toEqual({ "query-1:arxiv": 1, "query-2:arxiv": 1, "graph-2:refs": 1 });
  expect(r.streams["graph-1:rec"]).toEqual({ yes: 2, no: 0, borderline: 0 });
  expect(r.streams["graph-1:cites"]).toEqual({ yes: 1, no: 1, borderline: 0 });

  // Graph papers reach the pool past the floor; the second round's are read, the floor unmeasured.
  const pool = candidatePool(runs, TOPIC);
  expect(pool.get("arxiv:2610.00016")?.passedFloor).toBe(true);
  expect(pool.get("arxiv:2610.00015")?.passedFloor).toBeNull();

  const report = { ...replayLabels(labels, rankedItems(RESULT), pool, true), routes: r };
  const text = formatReport(report);
  expect(text).toContain("graph-1  yes 1, no 1; yes found by this route alone: 1");
  expect(text).toContain("none     yes 1, no 0");
  expect(text).toContain("graph-2:refs         yes 1, no 0; yes by this stream alone: 1");
  expect(routeLines(r)[0]).toBe("first route into the pool (yes/pinned, no):");
});
