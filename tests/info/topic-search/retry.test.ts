// Reading again what a first look missed (docs/info/88 「重跑第一次」): the plan
// from the source health, the keyed ask, the merge into the first look's file,
// the retry's own issue, the door tool's words, and a signed-out record that
// goes once a check finds X signed in again.

import { expect, test } from "bun:test";
import type { SourceHealth, TopicSearchLineHealth } from "../../../src/info/sources/engine";
import { noteClosed, emptyIssueState } from "../../../src/info/issue/assemble";
import { clearSignedOut, type XHaltRecord } from "../../../src/info/topic-search/halt";
import { planIssue } from "../../../src/info/issue/plan";
import { firstPart, mergeRetry, retryPart, type TopicSearchResult, type TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import { nextRetryNumber, planRetry } from "../../../src/info/topic-search/retry";
import { askedText, buildRetryFirstRunTool, type RetryToolDeps } from "../../../src/info/topic-search/retry-tool";
import { askRetryRun } from "../../../src/info/topic-search/run-worker";
import { encodeBrief, topicSearchRunKey, type TopicSearchBrief } from "../../../src/info/topic-search/run";
import { foldTopicSearchHealth } from "../../../src/info/topic-search/source-health";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { DelegateInput } from "../../../src/legion/runner/worker";
import type { Run } from "../../../src/legion/run/types";
import type { AgentTool } from "../../../src/legion/durable/contract";

type ToolResult = Awaited<ReturnType<AgentTool["execute"]>>;

const SEARCH: TopicSearch = {
  id: "ts-7a7a7a7a",
  name: "Mechanism discovery",
  concernId: null,
  scope: "How a system designs its own experiments.",
  subtopics: [
    { id: "s1", name: "Autonomous experiment design", picked: true },
    { id: "s2", name: "Alpha series", picked: false },
  ],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [
    { id: "q1", subtopic: null, x: "q1 x", arxiv: "autonomous experiment", ranking: "", weight: 1 },
    { id: "q2", subtopic: "s1", x: "q2 x", arxiv: "active learning physics", ranking: "", weight: 1 },
    { id: "q3", subtopic: "s1", x: "q3 x", arxiv: "symbolic regression", ranking: "", weight: 1 },
    { id: "q4", subtopic: "s1", x: "q4 x", arxiv: null, ranking: "", weight: 1 },
    { id: "q5", subtopic: "s2", x: "q5 x", arxiv: "alphafold limits", ranking: "", weight: 1 },
  ],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: 1,
};

function line(query: string, source: "x" | "arxiv" | "huggingface", status: TopicSearchLineHealth["status"], ladder?: TopicSearchLineHealth["ladder"]): [string, SourceHealth] {
  return [
    `topic-search:${SEARCH.id}:${query}:${source}`,
    { topicSearch: { searchId: SEARCH.id, name: SEARCH.name, query, label: query, source, status, read: 0, fresh: 0, passedFloor: 0, ...(ladder ? { ladder } : {}) } },
  ];
}

const EXHAUSTED = { outcome: "exhausted" as const, steps: [] };

test("a retry reads X that failed or was never read, arXiv that failed or was empty before the ladder, and Hugging Face that failed or was never read", () => {
  const health = Object.fromEntries([
    line("q1", "x", "failed"),
    line("q1", "arxiv", "empty"), // before the ladder: widening may find it something
    line("q2", "x", "empty"), // read, nothing new: left alone
    line("q2", "arxiv", "empty", EXHAUSTED), // the ladder already widened to the end
    line("q3", "x", "ok"),
    line("q3", "arxiv", "failed"),
    line("q1", "huggingface", "empty", EXHAUSTED),
    line("q2", "huggingface", "failed"),
    // q3 never searched on Hugging Face (before it was a source); q4 never read on X and has no arXiv words;
    // q5 is under an unpicked subtopic.
  ]);
  expect(planRetry(SEARCH, health)).toEqual({ x: ["q1", "q4"], arxiv: ["q1", "q3"], huggingface: ["q2", "q3"] });
  const all = Object.fromEntries(
    SEARCH.queries.flatMap((q) => [line(q.id, "x", "ok"), line(q.id, "arxiv", "ok"), line(q.id, "huggingface", "empty", EXHAUSTED)]),
  );
  expect(planRetry(SEARCH, all)).toEqual({ x: [], arxiv: [], huggingface: [] });
});

test("retries are keyed one past the highest still on file, per search", () => {
  const keys = ["topic-search:ts-7a7a7a7a:first", "topic-search:ts-7a7a7a7a:retry:2", "topic-search:ts-other:retry:9", undefined];
  expect(nextRetryNumber(keys, SEARCH.id)).toBe(3);
  expect(nextRetryNumber([], SEARCH.id)).toBe(1);
});

function runOf(brief: TopicSearchBrief, state: Run["state"]): Run {
  return { id: `run-${topicSearchRunKey(brief)}`, kind: "topic-search", brief: encodeBrief(brief), state, idempotencyKey: topicSearchRunKey(brief) } as Run;
}

test("asking for a retry waits for a first look or retry still going, and otherwise asks under the next key", async () => {
  const asks: DelegateInput[] = [];
  const delegate = async (input: DelegateInput) => {
    asks.push(input);
    return { ok: true as const, run: { id: "new" } as Run, existing: false };
  };
  const first: TopicSearchBrief = { searchId: SEARCH.id, kind: "first", night: null };
  const retry1: TopicSearchBrief = { searchId: SEARCH.id, kind: "retry", night: null, n: 1 };
  const nightly: TopicSearchBrief = { searchId: SEARCH.id, kind: "daily", night: "2026-10-16" };

  const busy = await askRetryRun(SEARCH.id, { runs: async () => [runOf(first, "running")], delegate });
  expect(busy).toMatchObject({ status: "busy", what: "first" });
  expect(asks).toEqual([]);

  const asked = await askRetryRun(SEARCH.id, {
    runs: async () => [runOf(first, "done"), runOf(retry1, "done"), runOf(nightly, "running")],
    delegate,
  });
  expect(asked).toMatchObject({ status: "asked", n: 2 });
  expect(asks.map((a) => [a.kind, a.idempotencyKey, JSON.parse(a.brief).kind])).toEqual([["topic-search", `topic-search:${SEARCH.id}:retry:2`, "retry"]]);
});

function item(id: string, materials: string[], subtopic: string | null = null): TopicSearchResultItem {
  return {
    id,
    key: `arxiv:${id}`,
    keys: [`arxiv:${id}`],
    kind: "paper",
    subtopic,
    title: id,
    titleFrom: "original",
    summary: `${id} summary`,
    facts: { kind: "paper", arxivId: id, authors: [], publishedAt: null },
    links: { original: null, posts: [] },
    materials,
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 70,
  };
}

const STATS = { candidates: { x: 0, arxiv: 1 }, passedFloor: 1, pooled: 1, reranked: true, anchorMiss: 0, avoidBlocked: {}, subtopicItems: { "": 1 }, modelCalls: 2 };
const PART_STATS = { candidates: { x: 40, arxiv: 0 }, passedFloor: 12, pooled: 10, reranked: true, anchorMiss: 0.25, avoidBlocked: { hype: 2 }, subtopicItems: { s1: 1 }, modelCalls: 4 };

function result(over: Partial<TopicSearchResult>): TopicSearchResult {
  return {
    version: 1,
    id: `topic-search-${SEARCH.id}-2026-10-16`,
    searchId: SEARCH.id,
    name: SEARCH.name,
    kind: "first",
    date: "2026-10-16",
    createdAt: 100,
    window: { since: 0, until: 100 },
    empty: false,
    writeup: "model",
    overview: { text: "The first look.", cites: ["E1"] },
    groups: [{ subtopic: null, items: ["E1"] }],
    quiet: [],
    items: [item("E1", ["M1"])],
    materials: [{ id: "M1" } as TopicSearchResult["materials"][number]],
    questions: [{ id: "qa", text: "First?", source: "model", template: null }],
    stats: STATS,
    runDir: "topic-search-runs/r-first",
    ...over,
  };
}

test("a retry's part is added to the first look's file and read back as its own issue", () => {
  const target = result({});
  const part = result({
    createdAt: 200,
    overview: { text: "E1 is now joined by what the retry found in E2.", cites: ["E1", "E2"] },
    groups: [
      { subtopic: "s1", items: ["E2"] },
      { subtopic: null, items: ["E3"] },
    ],
    items: [item("E2", ["M2"], "s1"), item("E3", ["M3"])],
    materials: [{ id: "M2" }, { id: "M3" }] as TopicSearchResult["materials"],
    questions: [{ id: "qb", text: "Second?", source: "model", template: null }],
    stats: PART_STATS,
    runDir: "topic-search-runs/r-retry",
  });
  const merged = mergeRetry(target, part, "r-retry");
  expect(merged.items.map((i) => i.id)).toEqual(["E1", "E2", "E3"]);
  // Every item is grouped; picked subtopics first, the whole topic last.
  expect(merged.groups).toEqual([
    { subtopic: "s1", items: ["E2"] },
    { subtopic: null, items: ["E1", "E3"] },
  ]);
  // The file speaks for the merged whole: the retry's overview was written over all of it.
  expect(merged.overview).toEqual(part.overview);
  expect(merged.stats).toEqual({
    candidates: { x: 40, arxiv: 1, huggingface: 0 },
    passedFloor: 13,
    pooled: 11,
    reranked: true,
    anchorMiss: 3 / 13,
    avoidBlocked: { hype: 2 },
    subtopicItems: { "": 1, s1: 1 },
    modelCalls: 6,
  });
  expect(merged.runDir).toBe("topic-search-runs/r-first");
  expect(merged.retries).toEqual([{ runId: "r-retry", at: 200, items: ["E2", "E3"], overview: part.overview, writeup: "model", questions: ["qb"], stats: PART_STATS }]);
  // The first look's own part is kept, and the first issue is assembled from it alone.
  expect(merged.firstLook).toEqual({ overview: target.overview, writeup: "model", stats: STATS });
  const first = firstPart(merged);
  expect(first.items.map((i) => i.id)).toEqual(["E1"]);
  expect(first.overview?.text).toBe("The first look.");
  expect(first.stats).toEqual(STATS);
  expect(first.groups).toEqual([{ subtopic: null, items: ["E1"] }]);
  expect(first.materials.map((m) => m.id)).toEqual(["M1"]);
  expect(first.questions.map((q) => q.id)).toEqual(["qa"]);

  const own = retryPart(merged, "r-retry")!;
  expect(own.items.map((i) => i.id)).toEqual(["E2", "E3"]);
  expect(own.materials.map((m) => m.id)).toEqual(["M2", "M3"]);
  expect(own.overview).toEqual(part.overview);
  expect(own.stats).toEqual(PART_STATS);
  expect(own.questions.map((q) => q.id)).toEqual(["qb"]);
  expect(retryPart(merged, "r-other")).toBeNull();
  // The retry's issue footnotes the first look's item its overview names, by title.
  const plan = planIssue([own], [{ searchId: SEARCH.id, name: SEARCH.name, subtopics: [] }])!;
  expect(plan.annex[0].cites).toEqual([
    { id: "E1", title: "E1" },
    { id: "E2", title: "E2" },
  ]);
  expect(planIssue([first], [{ searchId: SEARCH.id, name: SEARCH.name, subtopics: [] }])!.annex[0].text).toBe("The first look.");

  // A first look that found nothing takes the retry's overview.
  const fromEmpty = mergeRetry(result({ empty: true, writeup: "none", overview: null, groups: [], items: [], materials: [], questions: [] }), part, "r-retry");
  expect(fromEmpty).toMatchObject({ empty: false, writeup: "model", overview: part.overview });
});

test("a second part adds up over the first look and every part, and the first look stays as it was", () => {
  const once = mergeRetry(result({}), result({ createdAt: 200, items: [item("E2", ["M2"], "s1")], groups: [{ subtopic: "s1", items: ["E2"] }], stats: PART_STATS, overview: { text: "Whole, once.", cites: ["E2"] } }), "r-slow", true);
  // A write-up that fell back has no overview of the whole: none stands rather than the first look's stale one.
  const twice = mergeRetry(once, result({ createdAt: 300, items: [item("E3", ["M3"])], groups: [{ subtopic: null, items: ["E3"] }], stats: STATS, overview: null, writeup: "fallback" }), "r-retry");
  expect(twice.overview).toBeNull();
  expect(twice.stats.candidates).toEqual({ x: 40, arxiv: 2, huggingface: 0 });
  expect(twice.stats.modelCalls).toBe(8);
  expect(twice.firstLook).toEqual({ overview: { text: "The first look.", cites: ["E1"] }, writeup: "model", stats: STATS });
  expect(firstPart(twice).items.map((i) => i.id)).toEqual(["E1"]);
  expect(firstPart(twice).overview?.text).toBe("The first look.");
  // The same retry merged again replaces its record and its counts, never adds them twice.
  const again = mergeRetry(once, result({ createdAt: 200, items: [], groups: [], stats: PART_STATS, overview: null, questions: [] }), "r-slow", true);
  expect(again.stats).toEqual(mergeRetry(result({}), result({ items: [], stats: PART_STATS, questions: [] }), "r-slow", true).stats);
  // A part that added nothing leaves the file's overview standing.
  expect(again.overview?.text).toBe("Whole, once.");
  // A file merged before firstLook existed: its top-level overview was the first look's own.
  const { firstLook: _, ...old } = { ...once, overview: { text: "The first look.", cites: ["E1"] }, stats: STATS };
  expect(mergeRetry(old, result({ items: [item("E4", [])], stats: STATS }), "r-new").firstLook?.overview?.text).toBe("The first look.");
});

test("a retry closing is an issue of its own, keyed by its run", () => {
  const state = noteClosed(emptyIssueState(), { searchId: SEARCH.id, kind: "retry", night: null, resultFile: "f.json", runId: "r-retry" });
  expect(state.firsts).toEqual({ [`${SEARCH.id}#r-retry`]: "f.json" });
});

test("a retry's health folds over only what it read again", () => {
  const prior = Object.fromEntries([line("q1", "x", "failed"), line("q1", "arxiv", "ok"), line("q9", "x", "ok")]);
  const entry = { searchId: SEARCH.id, query: "q1", source: "x" as const, status: "ok" as const, why: null, fetchedAt: 5, read: 3, fresh: 3, passedFloor: 2 };
  const after = foldTopicSearchHealth(prior, { version: 1, searchId: SEARCH.id, kind: "first", at: 5, entries: [entry] }, SEARCH);
  expect(after[`topic-search:${SEARCH.id}:q1:x`]?.topicSearch?.status).toBe("ok");
  expect(after[`topic-search:${SEARCH.id}:q1:arxiv`]).toEqual(prior[`topic-search:${SEARCH.id}:q1:arxiv`]);
  // q9 is no longer a query of the search.
  expect(after[`topic-search:${SEARCH.id}:q9:x`]).toBeUndefined();
});

test("a signed-out record goes once a conclusive check after it found X signed in", () => {
  const out: XHaltRecord = { kind: "signed-out", detail: "", at: 100, night: "2026-10-16", strikes: 0, paused: false };
  expect(clearSignedOut(out, { signedIn: true, checkedAt: 200 })).toBeNull();
  expect(clearSignedOut(out, { signedIn: true, checkedAt: 50 })).toBe(out);
  expect(clearSignedOut(out, { signedIn: true, checkedAt: 200, unknown: "timeout" })).toBe(out);
  expect(clearSignedOut(out, { signedIn: false, checkedAt: 200 })).toBe(out);
  expect(clearSignedOut(out, undefined)).toBe(out);
  const limited: XHaltRecord = { ...out, kind: "rate-limited", strikes: 1 };
  expect(clearSignedOut(limited, { signedIn: true, checkedAt: 200 })).toBe(limited);
});

const textOf = (r: ToolResult) => (typeof r === "string" ? r : r.text);
const receiptOf = (r: ToolResult) => (typeof r === "string" ? undefined : r.receipt);

function tool(over: Partial<RetryToolDeps> = {}) {
  const asked: string[] = [];
  const deps: RetryToolDeps = {
    searches: async () => [SEARCH],
    known: () => [SEARCH],
    plan: async () => ({ x: ["q1", "q2"], arxiv: ["q1"] }),
    xSignedIn: async () => true,
    ask: async (id) => {
      asked.push(id);
      return { status: "asked", run: { id: "r" } as Run, n: 1 };
    },
    ...over,
  };
  return { run: (args: Record<string, unknown>) => buildRetryFirstRunTool(deps).execute(args), asked };
}

test("retry_topic_search_first_run asks only when something is left, and says only what it did", async () => {
  const ok = tool();
  const done = await ok.run({ searchId: "Mechanism discovery" });
  expect(ok.asked).toEqual([SEARCH.id]);
  expect(receiptOf(done)?.summary).toBe(SEARCH.name);
  expect(textOf(done)).toContain("X for 2 queries, arXiv for 1 query");
  expect(textOf(done)).toContain("Do not say when it will finish");
  expect(textOf(done)).not.toContain("signed out");

  const out = tool({ xSignedIn: async () => false });
  expect(textOf(await out.run({ searchId: SEARCH.id }))).toContain("found X signed out");

  const nothing = tool({ plan: async () => ({ x: [], arxiv: [] }) });
  expect(textOf(await nothing.run({ searchId: SEARCH.id }))).toContain("Nothing was asked");
  expect(nothing.asked).toEqual([]);

  const busy = tool({ ask: async () => ({ status: "busy", run: {} as Run, what: "first" }) });
  const b = await busy.run({ searchId: SEARCH.id });
  expect(textOf(b)).toContain("first run");
  expect(receiptOf(b)).toBeNull();

  const stopped = tool({ searches: async () => [{ ...SEARCH, status: "stopped" }] });
  expect(textOf(await stopped.run({ searchId: SEARCH.id }))).toContain("is stopped");
  expect(stopped.asked).toEqual([]);

  // A stopped study is an ended one (docs/info/91 结束): never read again.
  const ended = tool({ searches: async () => [{ ...SEARCH, status: "stopped", once: true }] });
  expect(textOf(await ended.run({ searchId: SEARCH.id }))).toContain("a study that has ended");
  expect(ended.asked).toEqual([]);

  expect(textOf(await ok.run({ searchId: "nope" }))).toContain("is not one of the reader's topic searches");
  expect(askedText("T", { x: [], arxiv: ["q1"] }, false)).not.toContain("signed out");
});
