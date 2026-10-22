// A study's second round of queries (docs/info/92 「第二轮查询」): the gaps,
// the proposal's checks and numbering, the lines said plainly, and the build
// that searches, judges only what is new and merges both rounds. No network:
// every search and model answer is scripted.

import { describe, expect, test } from "bun:test";
import type { InfoItem } from "../../../src/info/sources/item";
import { makeResultBuilder, type BuildResultDeps, type BuildTopicSearchResultArgs } from "../../../src/info/topic-search/build-result";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import type { ArxivFound, Numbered, RerankAnswer } from "../../../src/info/topic-search/rank-pool";
import type { TopicSearchResult } from "../../../src/info/topic-search/result-types";
import { unread } from "../../../src/info/topic-search/run";
import type { StudyFile } from "../../../src/info/topic-search/study";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import {
  ARXIV_READ_2_FILE,
  calibrationBlock,
  checkProposals,
  findGaps,
  HF_READ_2_FILE,
  JUDGE_1_FILE,
  JUDGE_2_FILE,
  judgeFileBody,
  judgeOnFile,
  newCandidates,
  onTopicPapers,
  parseProposals,
  queryResults,
  WIDEN_FILE,
  widenLines,
  widenQueries,
  type WidenChecked,
} from "../../../src/info/topic-search/widen";
import { HostCoolingDownError } from "../../../src/platform/http/host-gate";

const SEARCH_ID = "ts-7c7c7c7c";

const STUDY: TopicSearch = {
  id: SEARCH_ID,
  name: "Machine-made science",
  concernId: null,
  scope: "Systems that find laws from data.",
  subtopics: [
    { id: "s1", name: "Symbolic regression", picked: true },
    { id: "s2", name: "Domain priors", picked: true },
    { id: "s3", name: "Lab robots", picked: false },
  ],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [
    { id: "q1", subtopic: "s1", x: "symbolic regression", arxiv: "symbolic regression", ranking: "Is this symbolic regression?", weight: 1 },
    { id: "q2", subtopic: "s2", x: "domain priors", arxiv: "domain priors", ranking: "Does it bring domain knowledge in?", weight: 1 },
  ],
  answers: [],
  status: "active",
  revision: 3,
  createdAt: 0,
  lastRunAt: null,
  once: true,
  sources: ["arxiv", "huggingface"],
  seeds: [{ key: "arxiv:2601.00002", title: "Agents that plan symbolic regression experiments", said: "the agents paper", at: 1 }],
};

const judged = (score: number, subtopic: string | null, answered = true) => ({ score, rerank: answered ? { score, subtopic } : null });

describe("gaps", () => {
  test("a picked line with fewer than two judged candidates at or over 45 is a gap", () => {
    const gaps = findGaps(STUDY, [judged(80, "s1"), judged(50, "s1"), judged(70, "s2"), judged(44, "s2"), judged(90, "s2", false), judged(99, "s3")]);
    expect(gaps).toEqual([{ subtopic: "s2", hits: 1 }]);
  });

  test("with no picked subtopic the whole topic is the one line", () => {
    const topic = { ...STUDY, subtopics: [] };
    expect(findGaps(topic, [judged(60, null), judged(30, "x")])).toEqual([{ subtopic: null, hits: 1 }]);
    expect(findGaps(topic, [judged(60, null), judged(46, "x")])).toEqual([]);
  });
});

describe("the proposal", () => {
  const papers = [{ key: "arxiv:1", title: "Physics-informed law discovery", abstract: "Prior knowledge of conservation guides the search." }];
  const gaps = [{ subtopic: "s2", hits: 0 }];

  test("the reader's papers lead, then the first round's on the mark by score", () => {
    const cand = (key: string, title: string) => ({ key, paper: { id: key, title, abstract: `${title} abstract`, authors: [], publishedAt: null, url: "" } });
    const got = onTopicPapers(
      [{ key: "arxiv:seed", title: "Seed as the reader named it" }, { key: "arxiv:b", title: "B" }],
      [
        { ...judged(50, "s1"), cand: cand("arxiv:a", "A") },
        { ...judged(90, "s1"), cand: cand("arxiv:b", "B") },
        { ...judged(70, "s2"), cand: cand("arxiv:c", "C") },
        { ...judged(40, "s2"), cand: cand("arxiv:d", "D") },
      ],
    );
    expect(got.map((p) => p.key)).toEqual(["arxiv:seed", "arxiv:b", "arxiv:c", "arxiv:a"]);
    expect(got[0]).toEqual({ key: "arxiv:seed", title: "Seed as the reader named it", abstract: "" });
    expect(got[1].abstract).toBe("B abstract");
  });

  test("the reply is read leniently and a null line is the whole topic", () => {
    expect(parseProposals('```json\n{"queries": [{"line": "s2", "text": "  physics   priors "}, {"line": null, "text": "law discovery"}, {"text": ""}, 3]}\n```')).toEqual([
      { line: "s2", text: "physics priors" },
      { line: "topic", text: "law discovery" },
    ]);
    expect(() => parseProposals('{"items": []}')).toThrow();
  });

  test("each check drops what fails it; what passes is numbered in order", () => {
    const got = checkProposals(
      [
        { line: "s1", text: "symbolic regression agents" },
        { line: "s2", text: "priors" },
        { line: "s2", text: "quantum lattice gauge" },
        { line: "s2", text: "domain priors knowledge" },
        { line: "s2", text: "physics informed discovery" },
        { line: "s2", text: "discovery physics informed networks" },
        { line: "s2", text: "conservation knowledge search" },
        { line: "s2", text: "prior knowledge guided search" },
      ],
      gaps,
      ["domain priors", "symbolic regression"],
      papers,
    );
    expect(got.map((c) => [c.id, c.rejected])).toEqual([
      [null, "not_a_gap"],
      [null, "too_few_words"],
      [null, "not_in_papers"],
      [null, "repeat"],
      ["w1", null],
      [null, "repeat"],
      ["w2", null],
      [null, "over_limit"],
    ]);
    expect(got[4].subtopic).toBe("s2");
  });

  test("at most four in all, two per line", () => {
    const four = [{ subtopic: "s1", hits: 0 }, { subtopic: "s2", hits: 1 }, { subtopic: null, hits: 0 }];
    const words = ["alpha beta", "gamma delta", "epsilon zeta", "theta iota", "kappa lambda"];
    const lines = ["s1", "s2", "topic", "topic", "s1"];
    const vocab = [{ key: "k", title: words.join(" "), abstract: "" }];
    const got = checkProposals(words.map((text, i) => ({ line: lines[i], text })), four, [], vocab);
    expect(got.map((c) => c.id)).toEqual(["w1", "w2", "w3", "w4", null]);
    expect(got[4].rejected).toBe("over_limit");
    expect(got[2].subtopic).toBeNull();
  });

  test("a passed search is a query of this run: weight 0.7, the line's ranking question, no X words", () => {
    const checked: WidenChecked[] = [
      { line: "s2", subtopic: "s2", text: "physics informed discovery", id: "w1", rejected: null },
      { line: "s2", subtopic: "s2", text: "priors", id: null, rejected: "too_few_words" },
      { line: "topic", subtopic: null, text: "law discovery", id: "w2", rejected: null },
    ];
    expect(widenQueries(STUDY, checked)).toEqual([
      { id: "w1", subtopic: "s2", x: "", arxiv: "physics informed discovery", ranking: "Does it bring domain knowledge in?", weight: 0.7 },
      { id: "w2", subtopic: null, x: "", arxiv: "law discovery", ranking: "Is this symbolic regression?", weight: 0.7 },
    ]);
  });
});

const item = (id: string): InfoItem => ({
  id: `arxiv-${id}`,
  source: "arxiv",
  sourceName: "arXiv",
  sourceKey: id,
  title: id,
  url: `https://arxiv.org/abs/${id}`,
  publishedAt: "2026-01-10T00:00:00Z",
});
const queries = widenQueries(STUDY, [
  { line: "s2", subtopic: "s2", text: "physics informed discovery", id: "w1", rejected: null },
  { line: "s2", subtopic: "s2", text: "conservation knowledge search", id: "w2", rejected: null },
]);
const checked = queries.map((q): WidenChecked => ({ line: "s2", subtopic: "s2", text: q.arxiv!, id: q.id, rejected: null }));

describe("what the round came to", () => {
  test("a query is ok, empty, or not searched when no source answered it", () => {
    const found: ArxivFound[] = [
      { query: "w1", items: [item("2601.00011"), item("2601.00012")], error: null },
      { query: "w1", items: [item("2601.00011")], error: null },
      { query: "w2", items: [], error: "cooling down", ladder: { outcome: "cooling_down", steps: [] } },
    ];
    expect(queryResults(queries, found).map((r) => [r.id, r.outcome, r.found])).toEqual([
      ["w1", "ok", 2],
      ["w2", "not_searched", 0],
    ]);
    expect(queryResults(queries, [{ query: "w2", items: [], error: null }]).map((r) => r.outcome)).toEqual(["not_searched", "empty"]);
  });

  const gaps = [{ subtopic: "s1", hits: 1 }, { subtopic: "s2", hits: 0 }];
  const round = (over: Partial<Parameters<typeof widenLines>[2]>) => ({ checked, results: [], found: [], unjudged: false, ...over });

  test("a line searched in both rounds with nothing on the mark is empty; one now filled or with one find is not listed", () => {
    const results = queryResults(queries, [{ query: "w1", items: [], error: null }]);
    expect(widenLines(gaps, [judged(80, "s1"), judged(10, "s2")], round({ results }))).toEqual([
      { subtopic: "s1", status: "not_searched", why: "no_query" },
      { subtopic: "s2", status: "empty" },
    ]);
    expect(widenLines(gaps, [judged(80, "s1"), judged(70, "s1"), judged(60, "s2")], round({ results }))).toEqual([]);
  });

  test("a line not searched says why: the cooldown, the proposal, the judging", () => {
    const cooling: ArxivFound[] = ["w1", "w2"].map((q) => ({ query: q, items: [], error: "x", ladder: { outcome: "cooling_down", steps: [] } }));
    const s2 = [{ subtopic: "s2", hits: 0 }];
    expect(widenLines(s2, [], round({ results: queryResults(queries, cooling), found: cooling }))).toEqual([{ subtopic: "s2", status: "not_searched", why: "cooling_down" }]);
    expect(widenLines(s2, [], round({ checked: null, stopped: "proposal_failed" }))).toEqual([{ subtopic: "s2", status: "not_searched", why: "proposal_failed" }]);
    const results = queryResults(queries, [{ query: "w1", items: [item("2601.00011")], error: null }]);
    expect(widenLines(s2, [], round({ results, unjudged: true }))).toEqual([{ subtopic: "s2", status: "not_searched", why: "unjudged" }]);
  });

  test("the new candidates are those a second-round query found that the first pool lacked", () => {
    const f = (key: string, foundIn: string[]) => ({ cand: { key, foundIn } });
    const fused = [f("a", ["q1|arxiv", "w1|arxiv"]), f("b", ["w1|arxiv"]), f("c", ["q1|arxiv"]), f("d", ["w2|huggingface"])];
    expect(newCandidates(fused, new Set(["a"])).map((x) => x.cand.key)).toEqual(["b", "d"]);
  });

  test("the scale shows the first round's highest and lowest three, once each", () => {
    const block = calibrationBlock([10, 90, 50, 70, 30].map((score) => ({ score, title: `T${score}` })));
    expect(block.match(/^\d+: T\d+$/gm)).toEqual(["90: T90", "70: T70", "50: T50", "30: T30", "10: T10"]);
    expect(calibrationBlock([])).toBe("");
  });

  test("a judging on file answers only for the very pool it judged", () => {
    const n = (c: string, key: string) => ({ c, cand: { key }, rrf: 0, links: [] }) as unknown as Numbered;
    const pool = [n("c1", "arxiv:a"), n("c2", "arxiv:b")];
    const answers = new Map<string, RerankAnswer>([["c1", { score: 70, main: "self", subtopic: "s1", doubt: null }]]);
    const body = judgeFileBody(pool, answers);
    expect(judgeOnFile(body, pool)).toEqual(answers);
    expect(judgeOnFile(body, [pool[1], pool[0]])).toBeNull();
    expect(judgeOnFile("not json", pool)).toBeNull();
    expect(judgeOnFile(null, pool)).toBeNull();
  });
});

// --- the build ---

const paper = (id: string, title: string, abstract: string): InfoItem => ({
  id: `arxiv-${id}`,
  source: "arxiv",
  sourceName: "arXiv",
  sourceKey: id,
  title,
  url: `https://arxiv.org/abs/${id}`,
  publishedAt: "2026-01-10T00:00:00Z",
  textContent: abstract,
  summaryOnly: true,
  authors: [`Author ${id}`],
});
const P1 = paper("2601.00002", "Agents that plan symbolic regression experiments", "Symbolic regression agents use physics knowledge to plan experiments.");
const P3 = paper("2601.00004", "A benchmark for symbolic regression", "A symbolic regression benchmark of formula fitting.");
const P2 = paper("2601.00003", "Sparse data with domain priors", "Domain priors for sparse data.");
const NEW = ["2601.00011", "2601.00012", "2601.00013"].map((id, i) =>
  paper(id, `Physics prior knowledge for law discovery ${i + 1}`, "Physics prior knowledge guides the discovery of laws."),
);
const ALL = [P1, P2, P3, ...NEW];

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><article><h2>Abstract</h2><p>${title}.</p>` +
  `<h2>1 Introduction</h2><p>${"Laws are found from data. ".repeat(40)}</p><h2>2 Method</h2><p>${"A model proposes a form and fits it. ".repeat(40)}</p></article></body></html>`;

const PROPOSAL = JSON.stringify({
  queries: [
    { line: "s1", text: "symbolic regression agents" },
    { line: "s2", text: "physics prior knowledge" },
    { line: "s2", text: "quantum lattice gauge" },
  ],
});

interface Script {
  /** Rerank scores by arXiv id: [score, subtopic]. */
  scores: Record<string, [number, string | null]>;
  /** What the arXiv search does for the second round. */
  arxiv?: (text: string) => Promise<InfoItem[]>;
}

function world(topic: TopicSearch, script: Script, opts: { search?: boolean; files?: Map<string, string> } = {}) {
  const files = opts.files ?? new Map<string, string>();
  const calls: TopicModelCall[] = [];
  const searched: string[] = [];
  const now = Date.parse("2026-10-21T08:00:00Z");
  const model = (call: TopicModelCall): Promise<string> => {
    calls.push(call);
    if (call.site === "widen") return Promise.resolve(PROPOSAL);
    if (call.site === "rerank") {
      const items = [...call.user.matchAll(/(c\d+) · paper · .*? · arXiv (\S+)/g)].map((m) => {
        const [score, subtopic] = script.scores[m[2]] ?? [5, null];
        return { c: m[1], score, main: "self", subtopic };
      });
      return Promise.resolve(JSON.stringify({ items }));
    }
    const own = call.user.split("Already in this result (no entries):")[0];
    const blocks = [...own.matchAll(/<material id="(E\d+)">\n[\s\S]*?<\/material>/g)];
    const items = blocks.map((b) => ({
      e: b[1],
      conclusion: "Work on finding laws from data.",
      summary: "Work on finding laws from data.",
      body: ["A model proposes a form and fits it."],
      method: [[{ text: "A model proposes a form and fits it.", cite: [/^(M\d+\.§\d+) /m.exec(b[0])?.[1] ?? "M0.§1"] }]],
      results: [],
    }));
    return Promise.resolve(JSON.stringify({ overview: { text: `Laws from data; see ${blocks[0]?.[1] ?? "E1"}.`, cites: [blocks[0]?.[1] ?? "E1"] }, items }));
  };
  const titles = new Map(ALL.map((p) => [p.sourceKey!, p.title]));
  const deps: BuildResultDeps = {
    model,
    sleep: async () => {},
    fetchText: async (url) => {
      const id = /arxiv\.org\/html\/(\d{4}\.\d{5})/.exec(url)?.[1];
      return id && titles.has(id) ? { status: 200, text: html(titles.get(id)!) } : { status: 404, text: "" };
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
    labels: async () => [],
    study: async (): Promise<StudyFile> => ({ version: 1, searchId: SEARCH_ID, lines: [], rollbacks: [] }),
    seedPaper: async () => null,
    ...(opts.search === false
      ? {}
      : {
          searchArxiv: async (text: string) => {
            searched.push(`arxiv:${text}`);
            return script.arxiv ? script.arxiv(text) : text.includes("physics") ? NEW : [];
          },
          searchHf: async (text: string) => {
            searched.push(`hf:${text}`);
            return [];
          },
        }),
    now: () => now,
    today: () => "2026-10-21",
  };
  const build = makeResultBuilder(deps);
  const firstArxiv: ArxivFound[] = [
    { query: "q1", items: [P1, P3], error: null },
    { query: "q2", items: [P2], error: null },
  ];
  const args = (over: Partial<BuildTopicSearchResultArgs>): BuildTopicSearchResultArgs => ({
    topic,
    kind: "first",
    x: unread("unavailable", "not one of the topic's sources"),
    arxiv: [],
    huggingface: [],
    since: now - 365 * 86_400_000,
    runDir: "runs/r-first",
    xPages: { take: async () => true },
    signal: new AbortController().signal,
    ...over,
  });
  const result = (): TopicSearchResult => JSON.parse([...files.entries()].find(([k]) => k.startsWith("topic-search-ts-"))![1]);
  return {
    files,
    calls,
    searched,
    result,
    first: () => build(args({ arxiv: firstArxiv, runId: "r-first" })),
    update: () =>
      build(
        args({
          arxiv: [],
          runDir: "runs/r-up",
          runId: "r-up",
          update: { runId: "r-up", lines: null, queries: [] },
          carry: async (id) => (id === "r-first" ? { x: null, arxiv: firstArxiv, huggingface: [] } : null),
        }),
      ),
  };
}

const ROUND_ONE: Script["scores"] = {
  "2601.00002": [80, "s1"],
  "2601.00004": [75, "s1"],
  "2601.00003": [30, "s2"],
};
const FOUND_ONE: Script = { scores: { ...ROUND_ONE, "2601.00011": [70, "s2"], "2601.00012": [20, "s2"], "2601.00013": [10, "s2"] } };
const run = (name: string) => `runs/r-first/${name}`;

describe("a study's first look with a short line", () => {
  test("searches the passed queries, judges only the new candidates and lists what they found", async () => {
    const w = world(STUDY, FOUND_ONE);
    await w.first();
    for (const f of [JUDGE_1_FILE, WIDEN_FILE, ARXIV_READ_2_FILE, HF_READ_2_FILE, JUDGE_2_FILE]) expect(w.files.has(run(f))).toBe(true);
    const reranks = w.calls.filter((c) => c.site === "rerank");
    expect(reranks).toHaveLength(2);
    expect(w.calls.filter((c) => c.site === "widen")).toHaveLength(1);
    // The second judging sees the three new papers, numbered after the first pool's three, and the first round's scale.
    const second = reranks[1].user;
    expect([...second.matchAll(/(c\d+) · paper/g)].map((m) => m[1])).toEqual(["c4", "c5", "c6"]);
    expect(second).toContain("Judged earlier in this run");
    expect(second).toContain("80: Agents that plan symbolic regression experiments");
    expect(second).toContain("queries w1");
    expect(w.searched).toEqual(["arxiv:physics prior knowledge", "hf:physics prior knowledge"]);

    const result = w.result();
    expect(result.widen).toEqual({
      queries: [{ id: "w1", subtopic: "s2", text: "physics prior knowledge", outcome: "ok", found: 3 }],
      lines: [],
    });
    const found = result.items.find((i) => i.key === "arxiv:2601.00011")!;
    expect(found.subtopic).toBe("s2");
    expect(found.via).toEqual([{ kind: "query2", from: ["w1"] }]);
    expect(result.stats.modelCalls).toBe(reranks.length + 1 + w.calls.filter((c) => c.site === "write").length);
    const filed = JSON.parse(w.files.get(run(WIDEN_FILE))!);
    expect(filed.gaps).toEqual([{ subtopic: "s2", hits: 0 }]);
    expect(filed.checked.map((c: WidenChecked) => c.rejected)).toEqual(["not_a_gap", null, "not_in_papers"]);
    expect(filed.result).toEqual(result.widen);
  });

  test("a line searched twice with nothing on the mark is said to be empty", async () => {
    const w = world(STUDY, { scores: { ...ROUND_ONE, "2601.00011": [30, "s2"] } });
    await w.first();
    expect(w.result().widen!.lines).toEqual([{ subtopic: "s2", status: "empty" }]);
  });

  test("a source cooling down is not waited for: the line was not searched", async () => {
    const cooling = new HostCoolingDownError("export.arxiv.org", Date.parse("2026-10-21T08:20:00Z"), Date.parse("2026-10-21T08:00:00Z"));
    const w = world({ ...STUDY, sources: ["arxiv"] }, { scores: ROUND_ONE, arxiv: async () => Promise.reject(cooling) });
    await w.first();
    expect(w.result().widen).toEqual({
      queries: [{ id: "w1", subtopic: "s2", text: "physics prior knowledge", outcome: "not_searched", found: 0 }],
      lines: [{ subtopic: "s2", status: "not_searched", why: "cooling_down" }],
    });
    expect(w.calls.filter((c) => c.site === "rerank")).toHaveLength(1);
    expect(w.files.has(run(HF_READ_2_FILE))).toBe(false);
  });

  test("a resumed build reads every step on file and calls nothing again", async () => {
    const w = world(STUDY, FOUND_ONE);
    await w.first();
    const before = w.result();
    // The build died after the round: the run directory stays, the result and the queue are gone.
    for (const k of [...w.files.keys()]) if (!k.startsWith("runs/")) w.files.delete(k);
    const again = world(STUDY, FOUND_ONE, { files: w.files });
    await again.first();
    expect(again.calls.filter((c) => c.site === "rerank" || c.site === "widen")).toHaveLength(0);
    expect(again.searched).toEqual([]);
    const after = again.result();
    expect(after.items.map((i) => [i.key, i.score])).toEqual(before.items.map((i) => [i.key, i.score]));
    expect(after.widen).toEqual(before.widen);
  });

  test("an update takes the second round's finds into its pool without searching again", async () => {
    const w = world(STUDY, FOUND_ONE);
    await w.first();
    w.calls.length = 0;
    await w.update();
    const rerank = w.calls.find((c) => c.site === "rerank")!;
    expect(rerank.user).toContain("arXiv 2601.00012");
    expect(rerank.user).toMatch(/w1 \(s2\): Does it bring domain knowledge in\?/);
    expect(w.calls.some((c) => c.site === "widen")).toBe(false);
    expect(w.searched).toEqual(["arxiv:physics prior knowledge", "hf:physics prior knowledge"]);
  });
});

describe("no second round", () => {
  test("a study with no short line writes what it wrote without the round", async () => {
    const study = { ...STUDY, subtopics: STUDY.subtopics.map((s) => (s.id === "s1" ? s : { ...s, picked: false })) };
    const plain = world(study, { scores: ROUND_ONE }, { search: false });
    await plain.first();
    const wired = world(study, { scores: ROUND_ONE });
    await wired.first();
    expect(wired.files).toEqual(plain.files);
    expect(wired.calls.map((c) => c.site)).toEqual(plain.calls.map((c) => c.site));
    expect(wired.searched).toEqual([]);
  });

  test("a topic that is not a study never widens, however short a line", async () => {
    const followed = { ...STUDY, once: false, seeds: [] };
    const plain = world(followed, { scores: ROUND_ONE }, { search: false });
    await plain.first();
    const wired = world(followed, { scores: ROUND_ONE });
    await wired.first();
    expect(wired.files).toEqual(plain.files);
    expect(wired.calls.some((c) => c.site === "widen")).toBe(false);
  });
});
