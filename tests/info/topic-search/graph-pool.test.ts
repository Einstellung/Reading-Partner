// A study's graph expansion entering the pool (docs/info/92 「进候选池」): its
// streams merged with what the queries found by arXiv id, weighted and taken
// by kind, places kept for what only the graph found, no relevance floor and
// no lexical stand-in for those, the "Found through" line and its rule in the
// rerank, `via` on the items, and an update taking the graph streams of all the
// study's runs. Read from fixed graph-read.json files built with graph-read.ts;
// no network, no model.

import { describe, expect, test } from "bun:test";
import type { InfoItem } from "../../../src/info/sources/item";
import { normalizeRrf } from "../../../src/info/rank/fusion";
import { RELEVANCE_FLOOR } from "../../../src/info/rank/relevance";
import { finalScore } from "../../../src/info/rank/score";
import { makeResultBuilder, resultGraph, type BuildResultDeps, type BuildTopicSearchResultArgs } from "../../../src/info/topic-search/build-result";
import {
  emptyGraphRead,
  GRAPH_READ_FILE,
  withDoiOnly,
  withStream,
  type GraphPaper,
  type GraphRead,
  type GraphStream,
} from "../../../src/info/topic-search/graph-read";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import {
  fusePool,
  gatherCandidates,
  GRAPH_TAKE,
  graphPool,
  mergeVia,
  numberPool,
  POOL_RESERVE,
  rerankPrompt,
  scorePool,
  VIA_RULE,
  viaLine,
  type ArxivFound,
  type Candidate,
} from "../../../src/info/topic-search/rank-pool";
import { parseResultFile, type TopicSearchResult } from "../../../src/info/topic-search/result-types";
import { unread } from "../../../src/info/topic-search/run";
import type { StudyFile } from "../../../src/info/topic-search/study";
import type { TopicSearch } from "../../../src/info/topic-search/types";

const SEARCH_ID = "ts-7c7c7c7c";
const SEED_KEY = "arxiv:2601.00002";
const SEED_TITLE = "Agents that plan their next experiment";

const TOPIC: TopicSearch = {
  id: SEARCH_ID,
  name: "Symbolic regression",
  concernId: null,
  scope: "Finding equations from data.",
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
  revision: 2,
  createdAt: 0,
  lastRunAt: null,
  once: true,
  sources: ["arxiv", "huggingface"],
  seeds: [{ key: SEED_KEY, title: SEED_TITLE, said: "the seed paper", at: 1 }],
};

const item = (n: string, title: string, text = `${title}: symbolic regression.`): InfoItem => ({
  id: `arxiv-2601.${n}`,
  source: "arxiv",
  sourceName: "arXiv",
  sourceKey: `2601.${n}`,
  title,
  url: `https://arxiv.org/abs/2601.${n}`,
  publishedAt: "2026-01-10T00:00:00Z",
  textContent: text,
  summaryOnly: true,
  authors: ["Ada Lovelace"],
});
const SEED = item("00002", SEED_TITLE);
const BENCH = item("00004", "A benchmark for formula fitting");
const OFF = item("00006", "Turbulence closures", "Closures for turbulent flows, learned by search.");

const gp = (n: string, title: string, abstract = `${title}, read off the reader's papers.`): GraphPaper => ({
  arxivId: `2601.${n}`,
  title,
  abstract,
  authors: [`Author ${n}`],
  publishedAt: "2026-01-12",
  citationCount: 3,
});
const MOTION = gp("00101", "Learning laws of motion from video");
const SPARSE = gp("00102", "Equation discovery from sparse data");
const LATE = gp("00103", "Priors for physical law search");

const stream = (id: string, kind: GraphStream["kind"], papers: GraphPaper[], over: Partial<GraphStream> = {}): GraphStream => ({
  id,
  kind,
  from: kind === "rec" ? [SEED_KEY] : [id.slice(id.indexOf(":") + 1)],
  library: "s2",
  outcome: papers.length ? "ok" : "empty",
  total: papers.length * 3,
  papers,
  at: "2026-10-21T08:00:00Z",
  ...over,
});

/** The first look's expansion: recommendations and the seed's citations and references. */
function firstGraph(): GraphRead {
  let read = emptyGraphRead([{ key: SEED_KEY, title: SEED_TITLE, why: "seed", s2: "s2-seed", openAlex: null, citationCount: 12, walked: true }], []);
  read = withStream(read, stream("rec", "rec", [MOTION, gp("00002", SEED_TITLE)]));
  read = withStream(read, stream(`cites:${SEED_KEY}`, "cites", [SPARSE, MOTION]));
  read = withStream(read, stream(`refs:${SEED_KEY}`, "refs", [gp("00006", "Turbulence closures", "Closures for turbulent flows, learned by search.")]));
  return withDoiOnly(read, ["A Nature paper with no arXiv id"]);
}

const noX = unread("unavailable", "not one of the topic's sources");

describe("gathering", () => {
  const found: ArxivFound[] = [{ query: "q1", items: [SEED, OFF], error: null }];
  const g = gatherCandidates(TOPIC, noX, found, 0, [], firstGraph().streams);
  const by = (key: string) => g.all.find((c) => c.key === key)!;

  test("a paper only the graph found is the graph's, with every stream that found it and how", () => {
    const motion = by("arxiv:2601.00101");
    expect(motion).toMatchObject({ source: "graph", kind: "paper", queries: [], foundIn: ["rec|graph", `cites:${SEED_KEY}|graph`] });
    expect(motion.via).toEqual([
      { kind: "rec", from: [SEED_KEY] },
      { kind: "cites", from: [SEED_KEY] },
    ]);
    expect(motion.paper).toMatchObject({ id: "2601.00101", title: MOTION.title, url: "https://arxiv.org/abs/2601.00101" });
  });

  test("it passes the relevance floor, and its relevance is measured against every query", () => {
    const motion = by("arxiv:2601.00101");
    expect(motion.relevance).toBeLessThan(RELEVANCE_FLOOR);
    expect(g.kept).toContain(motion);
    // No query found it; its words match q2's.
    expect(by("arxiv:2601.00102").relevance).toBeGreaterThanOrEqual(RELEVANCE_FLOOR);
  });

  test("a paper a query found too keeps the query's entry and gains the stream", () => {
    const seed = by(SEED_KEY);
    expect(seed).toMatchObject({ source: "arxiv", queries: ["q1"], foundIn: ["q1|arxiv", "rec|graph"], via: [{ kind: "rec", from: [SEED_KEY] }] });
    expect(g.all.filter((c) => c.key === SEED_KEY)).toHaveLength(1);
  });

  test("one under the floor that a graph stream found stays in, counted by the graph's stream and not the query's", () => {
    const off = by("arxiv:2601.00006");
    expect(off.relevance).toBeLessThan(RELEVANCE_FLOOR);
    expect(g.kept).toContain(off);
    expect(g.streams.get("q1|arxiv")!.kept).toEqual([SEED_KEY]);
    expect(g.streams.get(`refs:${SEED_KEY}|graph`)!.kept).toEqual(["arxiv:2601.00006"]);
  });
});

describe("the fusion", () => {
  const graphOnly = (key: string, foundIn: string[], order: number): Candidate => ({
    key,
    kind: "paper",
    source: "graph",
    queries: [],
    foundIn,
    text: "",
    author: key,
    at: 0,
    post: null,
    paper: null,
    links: [],
    relevance: 0,
    engagement: null,
    order,
  });
  const p = (id: string) => gp(id, `Paper ${id}`);

  test("each kind weighs its own; a paper two streams found adds up (co-citation)", () => {
    const streams = [stream("rec", "rec", [p("00201"), p("00202")]), stream(`cites:${SEED_KEY}`, "cites", [p("00202")])];
    const kept = [graphOnly("arxiv:2601.00201", ["rec|graph"], 0), graphOnly("arxiv:2601.00202", ["rec|graph", `cites:${SEED_KEY}|graph`], 1)];
    const pool = fusePool(TOPIC, kept, 60, streams);
    expect(pool.map((f) => [f.cand.key, f.rrf])).toEqual([
      ["arxiv:2601.00202", normalizeRrf(0.8 / 62 + 0.6 / 61)],
      ["arxiv:2601.00201", normalizeRrf(0.8 / 61)],
    ]);
    // Recommendations OpenAlex stood in for weigh less; references least.
    const openAlex = fusePool(TOPIC, kept.slice(0, 1), 60, [stream("rec", "rec", [p("00201")], { library: "openalex" })]);
    expect(openAlex[0].rrf).toBe(normalizeRrf(0.5 / 61));
    const refs = fusePool(TOPIC, [graphOnly("arxiv:2601.00201", [`refs:${SEED_KEY}|graph`], 0)], 60, [stream(`refs:${SEED_KEY}`, "refs", [p("00201")])]);
    expect(refs[0].rrf).toBe(normalizeRrf(0.5 / 61));
  });

  test("a citation stream gives its top eight, recommendations their top twenty", () => {
    const ids = Array.from({ length: 25 }, (_, i) => String(301 + i).padStart(5, "0"));
    const cites = stream(`cites:${SEED_KEY}`, "cites", ids.map(p));
    const kept = ids.map((id, i) => graphOnly(`arxiv:2601.${id}`, [`cites:${SEED_KEY}|graph`], i));
    expect(fusePool(TOPIC, kept, 60, [cites])).toHaveLength(GRAPH_TAKE.cites);
    const rec = stream("rec", "rec", ids.map(p));
    expect(fusePool(TOPIC, ids.map((id, i) => graphOnly(`arxiv:2601.${id}`, ["rec|graph"], i)), 60, [rec])).toHaveLength(GRAPH_TAKE.rec);
  });

  test("twelve places are kept for what only the graph found, which the queries' streams outrank", () => {
    const topic = {
      ...TOPIC,
      queries: ["q1", "q2", "q3"].map((id) => ({ id, subtopic: null, x: "symbolic regression", arxiv: "symbolic regression", ranking: "", weight: 1 })),
    };
    const kept: Candidate[] = [];
    for (const q of ["q1", "q2", "q3"]) {
      for (let i = 0; i < 12; i++) {
        kept.push({ ...graphOnly(`arxiv:2601.9${q.slice(1)}${String(i).padStart(3, "0")}`, [`${q}|arxiv`], kept.length), source: "arxiv", queries: [q], relevance: 0.9 });
      }
    }
    const ids = Array.from({ length: 16 }, (_, i) => String(401 + i).padStart(5, "0"));
    for (const id of ids) kept.push(graphOnly(`arxiv:2601.${id}`, ["rec|graph"], kept.length));
    const rec = stream("rec", "rec", ids.map(p));
    const pool = fusePool(topic, kept, 20, [rec]);
    expect(pool).toHaveLength(20);
    const graphed = pool.filter((f) => f.cand.source === "graph");
    expect(graphed).toHaveLength(POOL_RESERVE.graph);
    // Each of them is in on a kept place: every query's paper left out outranks it.
    expect(Math.max(...graphed.map((f) => f.rrf))).toBeLessThan(Math.min(...pool.filter((f) => f.cand.source !== "graph").map((f) => f.rrf)));
    expect(pool.map((f) => f.rrf)).toEqual([...pool.map((f) => f.rrf)].sort((a, b) => b - a));
  });
});

describe("the rerank and the score", () => {
  const found: ArxivFound[] = [{ query: "q1", items: [SEED, BENCH], error: null }];
  const g = gatherCandidates(TOPIC, noX, found, 0, [], firstGraph().streams);
  const pool = graphPool([firstGraph()])!;
  const numbered = numberPool(fusePool(TOPIC, g.kept, 60, pool.streams));
  const c = (key: string) => numbered.find((n) => n.cand.key === key)!;

  test("a candidate the graph found says how, naming the reader's paper; the rule says that is no verdict", () => {
    const { system, user } = rerankPrompt(TOPIC, numbered, [], "", [], null, pool.titles);
    expect(system).toContain(VIA_RULE);
    const motion = user.split(`<material id="${c("arxiv:2601.00101").c}">`)[1].split("</material>")[0];
    expect(motion).toContain(`Found through: recommended from the reader's papers; cites "${SEED_TITLE}"`);
    // Only the graph found it: no queries named.
    expect(motion).not.toContain("· queries");
    const off = user.split(`<material id="${c("arxiv:2601.00006").c}">`)[1].split("</material>")[0];
    expect(off).toContain(`Found through: cited by "${SEED_TITLE}"`);
    const bench = user.split(`<material id="${c("arxiv:2601.00004").c}">`)[1].split("</material>")[0];
    expect(bench).toContain("· queries q1");
    expect(bench).not.toContain("Found through");
  });

  test("with nothing from the graph in the pool there is no rule and no line", () => {
    const plain = numberPool(fusePool(TOPIC, gatherCandidates(TOPIC, noX, found, 0).kept, 60));
    const { system, user } = rerankPrompt(TOPIC, plain, [], "");
    expect(system).not.toContain(VIA_RULE);
    expect(user).not.toContain("Found through");
  });

  test("the line names three of the reader's papers at most, and one it has no title for by its id", () => {
    const keys = ["arxiv:2601.00011", "arxiv:2601.00012", "arxiv:2601.00013", "arxiv:2601.00014", "arxiv:2601.00015"];
    const titles = new Map([["arxiv:2601.00011", "One"]]);
    expect(viaLine([{ kind: "refs", from: keys }], titles)).toBe('Found through: cited by "One", "arXiv 2601.00012", "arXiv 2601.00013" and 2 more');
    expect(viaLine(undefined, titles)).toBeNull();
  });

  test("an answer the model left out: only-the-graph's stands on its fusion alone, the queries' on their words", () => {
    const scored = scorePool(TOPIC, numbered, new Map());
    const motion = scored.find((s) => s.cand.key === "arxiv:2601.00101")!;
    expect(motion.score).toBe(finalScore({ kind: "paper", rerank: null, relevance: 0, rrf: motion.rrf, engagement: null }));
    expect(motion.score).toBeCloseTo(0.2 * motion.rrf, 10);
    const bench = scored.find((s) => s.cand.key === "arxiv:2601.00004")!;
    expect(bench.score).toBe(finalScore({ kind: "paper", rerank: null, relevance: bench.cand.relevance, rrf: bench.rrf, engagement: null }));
    expect(bench.score).toBeGreaterThan(0.2 * bench.rrf);
  });
});

test("the runs' reads merge by stream: a later answer replaces an earlier one, a later miss leaves it", () => {
  const earlier = firstGraph();
  let later = emptyGraphRead([{ key: "arxiv:2601.00009", title: "A paper labelled yes", why: "yes", s2: null, openAlex: null, citationCount: null, walked: true }], []);
  later = withStream(later, stream("rec", "rec", [], { outcome: "rate_limited", total: 0 }));
  later = withStream(later, stream(`cites:${SEED_KEY}`, "cites", [LATE]));
  const merged = graphPool([earlier, null, later])!;
  expect(merged.streams.map((s) => s.id)).toEqual(["rec", `cites:${SEED_KEY}`, `refs:${SEED_KEY}`]);
  expect(merged.streams[0].papers.map((p) => p.arxivId)).toEqual(["2601.00101", "2601.00002"]);
  expect(merged.streams[1].papers.map((p) => p.arxivId)).toEqual(["2601.00103"]);
  expect([...merged.titles.keys()]).toEqual([SEED_KEY, "arxiv:2601.00009"]);
  expect(graphPool([null, null])).toBeNull();
  expect(mergeVia([[{ kind: "cites", from: ["a"] }], undefined, [{ kind: "cites", from: ["b", "a"] }, { kind: "rec", from: ["a"] }]])).toEqual([
    { kind: "cites", from: ["a", "b"] },
    { kind: "rec", from: ["a"] },
  ]);
});

// --- the builds, end to end ------------------------------------------------------------

const TITLES = new Map<string, string>([
  ...[SEED, BENCH].map((p) => [p.sourceKey!, p.title] as const),
  ...[MOTION, SPARSE, LATE].map((p) => [p.arxivId, p.title] as const),
]);
const SCORES: Record<string, number> = { "2601.00002": 70, "2601.00004": 60, "2601.00101": 90, "2601.00102": 85, "2601.00103": 88, "2601.00006": 10 };

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><article><h2>Abstract</h2><p>${title}.</p>` +
  `<h2>1 Introduction</h2><p>${"Equations are found from data. ".repeat(40)}</p><h2>2 Method</h2><p>${"A model proposes a form and fits it. ".repeat(40)}</p></article></body></html>`;

function world() {
  const files = new Map<string, string>();
  const log: TopicModelCall[] = [];
  const now = Date.parse("2026-10-21T08:00:00Z");
  const deps: BuildResultDeps = {
    model: async (call) => {
      log.push(call);
      if (call.site === "rerank") {
        const items = [...call.user.matchAll(/(c\d+) · paper · .*? · arXiv (\S+)/g)].map((m) => ({ c: m[1], score: SCORES[m[2]] ?? 50, main: "self", subtopic: null }));
        return JSON.stringify({ items });
      }
      const own = call.user.split("Already in this result (no entries):")[0];
      const blocks = [...own.matchAll(/<material id="(E\d+)">\n[\s\S]*?<\/material>/g)];
      const items = blocks.map((b) => ({
        e: b[1],
        conclusion: "Work on finding equations from data.",
        method: [[{ text: "A model proposes a form and fits it.", cite: [/^(M\d+\.§\d+) /m.exec(b[0])?.[1] ?? "M0.§1"] }]],
        results: [],
      }));
      return JSON.stringify({ overview: { text: `Equation discovery leads; see ${blocks[0]?.[1] ?? "E1"}.`, cites: [blocks[0]?.[1] ?? "E1"] }, items });
    },
    sleep: async () => {},
    fetchText: async (url) => {
      const id = /arxiv\.org\/html\/(\d{4}\.\d{5})/.exec(url)?.[1];
      return id && TITLES.has(id) ? { status: 200, text: html(TITLES.get(id)!) } : { status: 404, text: "" };
    },
    openLink: async () => ({ ok: false, code: "not_found", reason: "not in this test" }),
    repoLookups: () => ({ lookup: async () => ({ kind: "missing" }) as never, quotaLeft: () => 50 }),
    files: {
      read: async (path) => files.get(path) ?? null,
      write: async (path, c) => void files.set(path, c),
      list: async (prefix) => [...files.keys()].filter((k) => !k.includes("/") && k.startsWith(prefix)),
    },
    profile: async () => [],
    known: async () => [],
    language: async () => "",
    labels: async () => [],
    study: async (): Promise<StudyFile> => ({ version: 1, searchId: SEARCH_ID, lines: [], rollbacks: [] }),
    seedPaper: async () => null,
    now: () => now,
    today: () => "2026-10-21",
  };
  const build = makeResultBuilder(deps);
  const firstArxiv: ArxivFound[] = [{ query: "q1", items: [SEED, BENCH], error: null }];
  const args = (over: Partial<BuildTopicSearchResultArgs>): BuildTopicSearchResultArgs => ({
    topic: TOPIC,
    kind: "first",
    x: noX,
    arxiv: [],
    huggingface: [],
    since: now - 365 * 86_400_000,
    runDir: "runs/r-first",
    xPages: { take: async () => true },
    signal: new AbortController().signal,
    ...over,
  });
  return {
    files,
    log,
    first: () => build(args({ arxiv: firstArxiv, runId: "r-first" })),
    update: () =>
      build(
        args({
          arxiv: [],
          runDir: "runs/r-up",
          runId: "r-up",
          update: { runId: "r-up", lines: null, queries: ["q2"] },
          carry: async (id) => (id === "r-first" ? { x: null, arxiv: firstArxiv, huggingface: [] } : null),
        }),
      ),
  };
}

const reranks = (log: readonly TopicModelCall[]) => log.filter((c) => c.site === "rerank");
const itemOf = (r: TopicSearchResult, key: string) => r.items.find((i) => i.key === key);

describe("a study's builds with its graph expansion on file", () => {
  test("the first look judges and lists what only the graph found, with its way in, and counts the expansion", async () => {
    const w = world();
    w.files.set(`runs/r-first/${GRAPH_READ_FILE}`, JSON.stringify(firstGraph()));
    const out = await w.first();
    const r = parseResultFile(w.files.get(out.resultFile!)!)!;
    expect(reranks(w.log)[0].system).toContain(VIA_RULE);
    expect(itemOf(r, "arxiv:2601.00101")?.via).toEqual([
      { kind: "rec", from: [SEED_KEY] },
      { kind: "cites", from: [SEED_KEY] },
    ]);
    expect(itemOf(r, "arxiv:2601.00102")?.via).toEqual([{ kind: "cites", from: [SEED_KEY] }]);
    expect(itemOf(r, SEED_KEY)?.via).toEqual([{ kind: "rec", from: [SEED_KEY] }]);
    expect(itemOf(r, "arxiv:2601.00004")?.via).toBeUndefined();
    expect(r.stats.candidates).toEqual({ x: 0, arxiv: 2, huggingface: 0, graph: 3 });
    expect(r.graph).toEqual(resultGraph(firstGraph()));
    expect(r.graph).toMatchObject({ positives: 1, doiOnly: 1, streams: [{ id: "rec", outcome: "ok", kept: 2 }, { kept: 2 }, { kept: 1 }] });
  });

  test("an update takes the graph streams of the study's runs and its own, the latest answer of each", async () => {
    const w = world();
    w.files.set(`runs/r-first/${GRAPH_READ_FILE}`, JSON.stringify(firstGraph()));
    await w.first();
    let own = emptyGraphRead([{ key: "arxiv:2601.00102", title: SPARSE.title, why: "yes", s2: null, openAlex: null, citationCount: 4, walked: true }], []);
    own = withStream(own, stream("rec", "rec", [], { outcome: "cooling_down", total: 0 }));
    own = withStream(own, stream("cites:arxiv:2601.00102", "cites", [LATE]));
    w.files.set(`runs/r-up/${GRAPH_READ_FILE}`, JSON.stringify(own));
    const out = await w.update();
    expect(out.version).toBe(2);
    const prompt = reranks(w.log)[1].user;
    // The first look's recommendation stands beside the update's new walk.
    expect(prompt).toContain("arXiv 2601.00101");
    expect(prompt).toContain(`Found through: cites "${SPARSE.title}"`);
    const r = parseResultFile(w.files.get(out.resultFile!)!)!;
    expect(itemOf(r, "arxiv:2601.00103")?.via).toEqual([{ kind: "cites", from: ["arxiv:2601.00102"] }]);
    expect(r.retries![r.retries!.length - 1].stats.candidates.graph).toBe(4);
  });
});
