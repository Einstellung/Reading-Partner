import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Delegated, DelegateInput, WorkerContext } from "../../../src/legion/runner/worker";
import type { Run } from "../../../src/legion/run/types";
import { registerProgramTask, runProgramTask } from "../../../src/legion/durable/program-task";
import { GiveUpError } from "../../../src/legion/stop";
import { recordHalt, xGate } from "../../../src/info/topic-search/halt";
import { inNightWindow, lastNightAnchor, nightEndAt, nightStartAt, planNight } from "../../../src/info/topic-search/nightly";
import {
  encodeBrief,
  NO_BUILDER,
  parseBrief,
  READ_LATER,
  searchLines,
  topicSearchRunKey,
  topicSearchTask,
  type TopicSearchBrief,
  type TopicSearchRunDeps,
  type TopicSearchRunResult,
} from "../../../src/info/topic-search/run";
import type { BuildTopicSearchResult, BuildTopicSearchResultArgs } from "../../../src/info/topic-search/build-result";
import {
  createStateStore,
  emptyState,
  loadArxivRead,
  loadHfRead,
  loadFirstPart,
  nightLimits,
  permalinkBudget,
  progressLog,
  saveArxivRead,
  saveHfRead,
  saveFirstPart,
  spendNight,
  takePermalink,
  type StateFs,
} from "../../../src/info/topic-search/run-state";
import { createNightTick, topicSearchWorker } from "../../../src/info/topic-search/run-worker";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { unread } from "../../../src/info/topic-search/run";
import type { BrowseOpen } from "../../../src/workshop/extract/webview-browse";
import type { ArxivRead } from "../../../src/info/topic-search/arxiv-read";
import type { XReadResult } from "../../../src/info/topic-search/x-reader";
import type { InfoItem } from "../../../src/info/sources/item";
import { AbortError } from "../../../src/platform/app/abort";
import { HostCoolingDownError, HttpStatusError } from "../../../src/platform/http/throttled-fetch";
import { openTestRuntime } from "../../legion/durable/support/runtime";

const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function search(over: Partial<TopicSearch> = {}): TopicSearch {
  return {
    id: "ts-0000aaaa",
    name: "AI for science",
    concernId: "s-1",
    scope: "AI used in science",
    subtopics: [
      { id: "st1", name: "materials", picked: true },
      { id: "st2", name: "weather", picked: false },
    ],
    want: [],
    avoid: [],
    judgments: [],
    anchors: ["AI"],
    queries: [
      { id: "q1", subtopic: null, x: "AI for science", arxiv: null, ranking: "What is new in AI for science?", weight: 1 },
      { id: "q2", subtopic: "st1", x: "AI materials discovery", arxiv: null, ranking: "", weight: 0.7 },
      { id: "q3", subtopic: "st2", x: "AI weather model", arxiv: null, ranking: "", weight: 0.7 },
    ],
    answers: [],
    status: "active",
    revision: 1,
    createdAt: 1,
    lastRunAt: null,
    ...over,
  };
}

function memFs(): StateFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p) => files.has(p),
    readText: async (p) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`no ${p}`);
      return text;
    },
    writeAtomic: async (p, text) => void files.set(p, text),
    appendText: async (p, text) => void files.set(p, (files.get(p) ?? "") + text),
    mkdirp: async () => {},
  };
}

// --- the clock and the gates -------------------------------------------------

test("the night is the most recent 01:00, read from its offset start to 04:40", () => {
  expect(lastNightAnchor(local(2026, 10, 14, 0, 59))).toBe("2026-10-13");
  expect(lastNightAnchor(local(2026, 10, 14, 1, 0))).toBe("2026-10-14");
  expect(nightEndAt("2026-10-14")).toBe(local(2026, 10, 14, 4, 40));
  const start = nightStartAt("2026-10-14", "dev-a");
  expect(start).toBeGreaterThanOrEqual(local(2026, 10, 14, 1, 0));
  expect(start).toBeLessThan(local(2026, 10, 14, 1, 40));
  expect(nightStartAt("2026-10-14", "dev-a")).toBe(start);
  expect(inNightWindow(local(2026, 10, 14, 1, 40), "dev-a")).toEqual({ night: "2026-10-14", open: true });
  // Woke after 04:40: the night is not read.
  expect(inNightWindow(local(2026, 10, 14, 4, 40), "dev-a").open).toBe(false);
  expect(inNightWindow(local(2026, 10, 14, 12, 0), "dev-a").open).toBe(false);
});

test("the night plan asks every condition and orders the searches as they were made", () => {
  const base = { collecting: true, webview: true, sessionValid: true, gate: null, searches: [] as TopicSearch[] };
  expect(planNight({ ...base, collecting: false })).toEqual({ wait: "not the collector" });
  expect(planNight({ ...base, sessionValid: false })).toEqual({ wait: "no X session" });
  expect(planNight(base)).toEqual({ wait: "no active topic search" });
  const a = search({ id: "ts-a", createdAt: 5 });
  const b = search({ id: "ts-b", createdAt: 2 });
  const c = search({ id: "ts-c", status: "stopped" });
  const plan = planNight({ ...base, searches: [a, b, c] });
  expect("dispatch" in plan && plan.dispatch.map((s) => s.id)).toEqual(["ts-b", "ts-a"]);
});

test("a challenge skips the next night, the one after is tried, a second one pauses until resumed", () => {
  const first = recordHalt(null, { kind: "challenge", detail: "verify" }, 1, "2026-10-14");
  expect(xGate(first, "2026-10-14")).not.toBeNull();
  expect(xGate(first, "2026-10-15")).not.toBeNull();
  expect(xGate(first, "2026-10-16")).toBeNull();
  const second = recordHalt(first, { kind: "rate-limited", detail: "429" }, 2, "2026-10-16");
  expect(second?.paused).toBe(true);
  expect(xGate(second, "2026-10-30")).toContain("paused");
  // A changed page stops only its run; signed out waits on the session, not on this record.
  expect(recordHalt(null, { kind: "structure", detail: "no posts" }, 3, "2026-10-14")).toBeNull();
  expect(xGate(recordHalt(null, { kind: "signed-out", detail: "" }, 3, "2026-10-14"), "2026-10-14")).toBeNull();
});

test("the night's ceiling is shared by its runs", () => {
  const x = { ...unread("done", ""), pages: { search: 10, permalink: 5 }, activeMs: 60_000 };
  const used = spendNight(null, "2026-10-14", x);
  expect(nightLimits(used, "2026-10-14").searchPages).toBe(20);
  expect(nightLimits(used, "2026-10-15").searchPages).toBe(30);
});

test("a build's permalink pages come off the day's allowance and the run's or night's ceiling", () => {
  const at = { day: "2026-10-14", kind: "daily" as const, night: "2026-10-14", runLeft: 0 };
  const full = { ...emptyState(), reader: { marks: {}, daily: { day: "2026-10-14", search: 3, permalink: 80 } } };
  expect(takePermalink(full, at)).toBeNull();
  // Yesterday's count starts over.
  expect(takePermalink(full, { ...at, day: "2026-10-15" })?.reader.daily).toEqual({ day: "2026-10-15", search: 0, permalink: 1 });
  const nightSpent = { ...emptyState(), night: { night: "2026-10-14", posts: 0, searchPages: 0, permalinkPages: 40, activeMs: 0 } };
  expect(takePermalink(nightSpent, at)).toBeNull();
  const took = takePermalink(emptyState(), at)!;
  expect(took.night?.permalinkPages).toBe(1);
  expect(took.reader.daily?.permalink).toBe(1);
  // A first run spends its own ceiling, not the night's.
  expect(takePermalink(nightSpent, { ...at, kind: "first", runLeft: 1 })?.night).toEqual(nightSpent.night);
  expect(takePermalink(emptyState(), { ...at, kind: "first", runLeft: 0 })).toBeNull();
});

test("a first run's build has what the read left of its 40 permalink pages", async () => {
  const store = createStateStore(memFs(), "state.json");
  const x = { ...unread("done", ""), pages: { search: 2, permalink: 38 } };
  const budget = permalinkBudget(store, { kind: "first", night: "2026-10-14", x }, () => local(2026, 10, 14, 14));
  expect([await budget.take(), await budget.take(), await budget.take()]).toEqual([true, true, false]);
  expect((await store.load()).reader.daily?.permalink).toBe(2);
});

test("the state store chains writes and the progress log skips a torn line", async () => {
  const fs = memFs();
  const store = createStateStore(fs, "state.json");
  await Promise.all([
    store.reader.save({ marks: { a: { topId: "5", seen: {} } }, daily: null }),
    store.update((s) => ({ ...s, halt: recordHalt(null, { kind: "challenge", detail: "" }, 1, "2026-10-14") })),
  ]);
  const after = await store.load();
  expect(after.reader.marks.a?.topId).toBe("5");
  expect(after.halt?.kind).toBe("challenge");
  const log = progressLog(fs, "run");
  await log.append({ kind: "resume", n: 1, at: 1, activeMs: 0 });
  fs.files.set("run/x-progress.jsonl", `${fs.files.get("run/x-progress.jsonl")}{"kind":"re`);
  expect((await log.load()).length).toBe(1);
});

test("briefs, keys and lines", () => {
  const first = { searchId: "ts-1", kind: "first" as const, night: null };
  expect(topicSearchRunKey(first)).toBe("topic-search:ts-1:first");
  expect(topicSearchRunKey({ searchId: "ts-1", kind: "daily", night: "2026-10-14" })).toBe("topic-search:ts-1:2026-10-14");
  expect(parseBrief(encodeBrief(first))).toEqual(first);
  expect(parseBrief('{"searchId":"ts-1","kind":"daily"}')).toBeNull();
  const retry = { searchId: "ts-1", kind: "retry" as const, night: null, n: 2 };
  expect(topicSearchRunKey(retry)).toBe("topic-search:ts-1:retry:2");
  expect(parseBrief(encodeBrief(retry))).toEqual(retry);
  expect(parseBrief('{"searchId":"ts-1","kind":"retry"}')).toBeNull();
  expect(searchLines(search(), "first", 0, ["q2"]).map((l) => l.key)).toEqual(["ts-0000aaaa:q2"]);
  const lines = searchLines(search(), "first", local(2026, 9, 14, 12));
  // The unpicked subtopic's query is not read.
  expect(lines.map((l) => l.key)).toEqual(["ts-0000aaaa:q1", "ts-0000aaaa:q2"]);
  // The permalink floor is measured on the X query, as the build measures it, never the ranking question (pitfall 660).
  expect(lines[0]).toMatchObject({ order: "top", since: "2026-09-14", relevance: "AI for science" });
  expect(searchLines(search(), "daily", 0)[1]).toMatchObject({ order: "live", relevance: "AI materials discovery" });
  const chinese = search({
    queries: [{ id: "q1", subtopic: null, x: "symbolic regression equation discovery -filter:retweets lang:en", arxiv: null, ranking: "怎么从观测数据里自动归纳出规律、方程？", weight: 1 }],
  });
  expect(searchLines(chinese, "first", 0)[0].relevance).toBe("symbolic regression equation discovery");
});

// --- the task on a real Harness ------------------------------------------------

interface Trace {
  closed: { searchId: string; kind: string; night: string | null; resultFile: string | null }[];
  ran: number[];
  stopped: string[];
  locks: { taken: number; released: number };
  built: number;
  opened: number;
  halts: string[];
}

function fakeDeps(over: Partial<Omit<TopicSearchRunDeps, "now">> & { search?: TopicSearch; now?: number } = {}): {
  deps: TopicSearchRunDeps;
  trace: Trace;
  fs: ReturnType<typeof memFs>;
} {
  const fs = memFs();
  const store = createStateStore(fs, "state.json");
  const trace: Trace = { closed: [], ran: [], stopped: [], locks: { taken: 0, released: 0 }, built: 0, opened: 0, halts: [] };
  const { search: given, now: at, ...rest } = over;
  const the = given ?? search();
  const now = at ?? local(2026, 10, 14, 14);
  const deps: TopicSearchRunDeps = {
    loadSearch: async (id) => (id === the.id ? the : null),
    ran: async (_s, at) => void trace.ran.push(at),
    stopOnce: async (s) => void trace.stopped.push(s.id),
    builder: () => async () => {
      trace.built++;
      return { resultFile: "topic-search-ts-0000aaaa-2026-10-14.json", itemCount: 3, empty: false };
    },
    xPages: (about) => permalinkBudget(store, about, () => now),
    foldSourceHealth: async () => {},
    runDir: async (runId) => `runs/${runId}`,
    progress: (dir) => progressLog(fs, dir),
    saveRead: async (dir, x) => void fs.files.set(`${dir}/x-read.json`, JSON.stringify(x)),
    loadRead: async (dir) => (fs.files.has(`${dir}/x-read.json`) ? JSON.parse(fs.files.get(`${dir}/x-read.json`)!) : null),
    searchArxiv: async () => [],
    saveArxiv: (dir, read) => saveArxivRead(fs, dir, read),
    loadArxiv: (dir) => loadArxivRead(fs, dir),
    searchHf: async () => [],
    saveHf: (dir, read) => saveHfRead(fs, dir, read),
    loadHf: (dir) => loadHfRead(fs, dir),
    saveFirstPart: (dir, part) => saveFirstPart(fs, dir, part),
    loadFirstPart: (dir) => loadFirstPart(fs, dir),
    memory: store.reader,
    nightLimits: async (night) => nightLimits((await store.load()).night, night),
    spendNight: async (night, x) => void (await store.update((s) => ({ ...s, night: spendNight(s.night, night, x) }))),
    gate: async () => null,
    readClean: async () => {},
    checkSession: async () => "ok",
    retryPlan: async () => ({ x: [], arxiv: [] }),
    halted: async (halt) => void trace.halts.push(halt.kind),
    keepAwake: async () => {
      trace.locks.taken++;
      return { held: true, detail: null, release: async () => void trace.locks.released++ };
    },
    // No browse window in a test: the read comes back unavailable without touching anything.
    open: async () => {
      trace.opened++;
      return { status: "unsupported", detail: "test" } as unknown as BrowseOpen;
    },
    expandLink: async () => null,
    closed: async ({ searchId, kind, night, resultFile }) => void trace.closed.push({ searchId, kind, night, resultFile }),
    lane: (work) => work(),
    now: () => now,
    random: () => 0.5,
    sleep: async () => {},
    ...rest,
  };
  return { deps, trace, fs };
}

async function runTask(deps: TopicSearchRunDeps, input: { runId: string; brief: TopicSearchBrief }, signal?: AbortSignal) {
  const task = topicSearchTask(deps);
  const off = registerProgramTask(task);
  const t = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "ts-run-")), responses: [] });
  try {
    return await runProgramTask<TopicSearchRunResult>(t.runtime, { task, key: input.runId, name: "topic-search", input, signal });
  } finally {
    off();
  }
}

test("a first run delivers its first part, then reads X and adds to it: the brief is told twice, the lock taken once", async () => {
  const { deps, trace } = fakeDeps();
  const outcome = await runTask(deps, { runId: "r-1", brief: { searchId: "ts-0000aaaa", kind: "first", night: null } });
  expect(outcome.status).toBe("completed");
  const result = (outcome as { result: TopicSearchRunResult }).result;
  // Both parts' items: the run's outcome is the whole file.
  expect(result).toMatchObject({ status: "delivered", itemCount: 6 });
  expect(result.x?.status).toBe("unavailable");
  expect(trace.opened).toBe(1);
  expect(trace.built).toBe(2);
  const file = "topic-search-ts-0000aaaa-2026-10-14.json";
  expect(trace.closed).toEqual([
    { searchId: "ts-0000aaaa", kind: "first", night: null, resultFile: file },
    // The slow part is told as what a retry adds: an issue of its own, `first:<id>#<runId>`.
    { searchId: "ts-0000aaaa", kind: "retry", night: null, resultFile: file },
  ]);
  expect(trace.ran.length).toBe(1);
  expect(trace.locks).toEqual({ taken: 1, released: 1 });
  expect(trace.stopped).toEqual([]);
});

test("while it reads X a run reports counts off its progress file, so the synced run record says how far it got", async () => {
  const said: string[] = [];
  const { deps } = fakeDeps({ report: (_id, text) => void said.push(text) });
  await runTask(deps, { runId: "r-rep", brief: { searchId: "ts-0000aaaa", kind: "first", night: null } });
  const reading = said.filter((s) => s.startsWith("first part delivered; reading X: "));
  expect(reading.length).toBeGreaterThan(0);
  expect(reading[reading.length - 1]).toContain("0 screens read, 0 distinct posts found");
});

test("a once-only search stops after its first delivery; an empty daily run hands the brief nothing", async () => {
  const once = fakeDeps({ search: search({ once: true }) });
  await runTask(once.deps, { runId: "r-2", brief: { searchId: "ts-0000aaaa", kind: "first", night: null } });
  expect(once.trace.stopped).toEqual(["ts-0000aaaa"]);

  const empty: BuildTopicSearchResult = async () => ({ resultFile: "r.json", itemCount: 0, empty: true });
  const daily = fakeDeps({ builder: () => empty, now: local(2026, 10, 14, 2) });
  const outcome = await runTask(daily.deps, { runId: "r-3", brief: { searchId: "ts-0000aaaa", kind: "daily", night: "2026-10-14" } });
  expect((outcome as { result: TopicSearchRunResult }).result.status).toBe("empty");
  expect(daily.trace.closed).toEqual([{ searchId: "ts-0000aaaa", kind: "daily", night: "2026-10-14", resultFile: null }]);
});

test("a daily run skips a gated night, a signed-out session and a night that is over, without opening X", async () => {
  const gated = fakeDeps({ gate: async () => "the night after a challenge is skipped", now: local(2026, 10, 14, 2) });
  const a = await runTask(gated.deps, { runId: "r-4", brief: { searchId: "ts-0000aaaa", kind: "daily", night: "2026-10-14" } });
  expect((a as { result: TopicSearchRunResult }).result).toMatchObject({ status: "skipped", why: "the night after a challenge is skipped" });
  expect(gated.trace.opened + gated.trace.built + gated.trace.locks.taken).toBe(0);

  const out = fakeDeps({ checkSession: async () => "signed-out", now: local(2026, 10, 14, 2) });
  await runTask(out.deps, { runId: "r-5", brief: { searchId: "ts-0000aaaa", kind: "daily", night: "2026-10-14" } });
  expect(out.trace.halts).toEqual(["signed-out"]);
  expect(out.trace.opened).toBe(0);

  const late = fakeDeps({ now: local(2026, 10, 14, 5) });
  const c = await runTask(late.deps, { runId: "r-6", brief: { searchId: "ts-0000aaaa", kind: "daily", night: "2026-10-14" } });
  expect((c as { result: TopicSearchRunResult }).result.why).toBe("the night is over");
});

test("a retry reads X only for what it reads again, and skips when X is signed out and arXiv has nothing to redo", async () => {
  const seen: BuildTopicSearchResultArgs[] = [];
  const builder: BuildTopicSearchResult = async (args) => {
    seen.push(args);
    return { resultFile: "topic-search-ts-0000aaaa-2026-10-14.json", itemCount: 2, empty: false };
  };
  const retry = { searchId: "ts-0000aaaa", kind: "retry" as const, night: null, n: 1 };

  // Only arXiv to redo: X is not opened, the build is told which queries.
  const arxiv = fakeDeps({ builder: () => builder, retryPlan: async () => ({ x: [], arxiv: ["q2"] }) });
  const a = await runTask(arxiv.deps, { runId: "r-r1", brief: retry });
  expect((a as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  expect(arxiv.trace.opened + arxiv.trace.locks.taken).toBe(0);
  expect(seen[0]).toMatchObject({ kind: "first", retry: { runId: "r-r1", x: [], arxiv: ["q2"] } });
  expect(arxiv.trace.closed).toEqual([{ searchId: "ts-0000aaaa", kind: "retry", night: null, resultFile: "topic-search-ts-0000aaaa-2026-10-14.json" }]);

  // Only X to redo and X is still signed out: nothing to build from.
  const out = fakeDeps({ builder: () => builder, checkSession: async () => "signed-out", retryPlan: async () => ({ x: ["q1"], arxiv: [] }) });
  const b = await runTask(out.deps, { runId: "r-r2", brief: retry });
  expect((b as { result: TopicSearchRunResult }).result).toMatchObject({ status: "skipped", why: "signed out of X" });
  expect(out.trace.halts).toEqual(["signed-out"]);
  expect(seen.length).toBe(1);

  // Nothing to redo.
  const none = fakeDeps({ builder: () => builder });
  const c = await runTask(none.deps, { runId: "r-r3", brief: retry });
  expect((c as { result: TopicSearchRunResult }).result.why).toBe("nothing the first look missed is left to read again");

  // A one-look search stopped itself after its first run; its retry still runs, and does not stop it again.
  const once = fakeDeps({ search: search({ once: true, status: "stopped" }), builder: () => builder, retryPlan: async () => ({ x: ["q1"], arxiv: [] }) });
  const d = await runTask(once.deps, { runId: "r-r4", brief: retry });
  expect((d as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  expect(once.trace.opened).toBe(1);
  expect(once.trace.stopped).toEqual([]);
});

// --- arXiv beside X --------------------------------------------------------------

function withArxiv(over: Partial<TopicSearch> = {}): TopicSearch {
  return search({
    queries: [
      { id: "q1", subtopic: null, x: "AI for science", arxiv: "protein design", ranking: "", weight: 1 },
      { id: "q2", subtopic: "st1", x: "AI materials discovery", arxiv: "materials discovery", ranking: "", weight: 0.7 },
    ],
    ...over,
  });
}

const FIRST_LOOK: TopicSearchBrief = { searchId: "ts-0000aaaa", kind: "first", night: null };
/** A run that reads X and arXiv side by side: a retry of both (a first look reads arXiv first, pace.ts). */
const BOTH: TopicSearchBrief = { searchId: "ts-0000aaaa", kind: "retry", night: null, n: 1 };
const READ_BOTH = { retryPlan: async () => ({ x: ["q1", "q2"], arxiv: ["q1", "q2"] }) };

const paper = (id: string): InfoItem => ({ id: `arxiv-${id}`, source: "arxiv", sourceName: "arXiv", title: `Paper ${id}`, url: `https://arxiv.org/abs/${id}`, publishedAt: "" });
/** Three papers a request, so every ladder stops at its first step. */
const three = (text: string) => [1, 2, 3].map((i) => paper(`${text.replace(/\W/g, "")}.${i}`));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function capturing() {
  const seen: BuildTopicSearchResultArgs[] = [];
  const builder: BuildTopicSearchResult = async (args) => {
    seen.push(args);
    return { resultFile: "topic-search-ts-0000aaaa-2026-10-14.json", itemCount: 2, empty: false };
  };
  return { seen, builder };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 2000 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(check()).toBe(true);
}

const hfOnFile = (fs: { files: Map<string, string> }, runId: string): ArxivRead | null =>
  fs.files.has(`runs/${runId}/hf-read.json`) ? (JSON.parse(fs.files.get(`runs/${runId}/hf-read.json`)!) as ArxivRead) : null;
const arxivOnFile = (fs: { files: Map<string, string> }, runId: string): ArxivRead | null =>
  JSON.parse(fs.files.get(`runs/${runId}/arxiv-read.json`) ?? "null") as ArxivRead | null;

test("arXiv is searched while X still waits in the lane, and the run's line says so", async () => {
  const gate = deferred();
  let entered = false;
  const said: string[] = [];
  const searched: string[] = [];
  const { seen, builder } = capturing();
  const { deps, trace, fs } = fakeDeps({
    ...READ_BOTH,
    search: withArxiv(),
    builder: () => builder,
    searchArxiv: async (text) => (searched.push(text), three(text)),
    lane: async (work) => {
      await gate.promise;
      entered = true;
      return work();
    },
    report: (_id, text) => void said.push(text),
  });
  const running = runTask(deps, { runId: "r-a1", brief: BOTH });
  await until(() => arxivOnFile(fs, "r-a1")?.done === true && hfOnFile(fs, "r-a1")?.done === true);
  expect(entered).toBe(false);
  expect(trace.opened).toBe(0);
  expect(seen.length).toBe(0);
  expect(searched).toEqual(["protein design", "materials discovery"]);
  expect(said[said.length - 1]).toBe(
    "waiting to read X; arXiv done: 2 queries searched (2 direct), 6 papers; Hugging Face done: 2 queries searched (2 exhausted), 0 papers",
  );

  gate.resolve();
  const outcome = await running;
  expect(outcome.status).toBe("completed");
  expect(trace.opened).toBe(1);
  expect(seen[0].arxiv.map((f) => [f.query, f.ladder?.outcome, f.items.length])).toEqual([
    ["q1", "direct", 3],
    ["q2", "direct", 3],
  ]);
  // The build searched nothing.
  expect(searched.length).toBe(2);
});

test("with arXiv cooling down, Hugging Face reads alone and the build has its papers", async () => {
  const { seen, builder } = capturing();
  const hfAsked: { text: string; window: { since: string; until: string } }[] = [];
  const { deps, fs } = fakeDeps({
    ...READ_BOTH,
    search: withArxiv(),
    builder: () => builder,
    searchArxiv: async () => {
      throw new HostCoolingDownError("export.arxiv.org", Date.now() + 600_000, Date.now());
    },
    searchHf: async (text, window) => {
      hfAsked.push({ text, window });
      return [1, 2, 3].map((i) => ({
        ...paper(`2610.0000${i}`),
        source: "huggingface",
        sourceName: "Hugging Face",
        title: `${text} ${i}`,
        publishedAt: "2026-10-01",
      }));
    },
  });
  const outcome = await runTask(deps, { runId: "r-h1", brief: BOTH });
  expect(outcome.status).toBe("completed");
  expect(seen[0].arxiv.map((f) => [f.query, f.ladder?.outcome])).toEqual([
    ["q1", "cooling_down"],
    ["q2", "cooling_down"],
  ]);
  expect(seen[0].huggingface?.map((f) => [f.query, f.ladder?.outcome, f.items.length])).toEqual([
    ["q1", "direct", 3],
    ["q2", "direct", 3],
  ]);
  // One request a query, over the window widened by a year, which the ladder narrows on the client.
  expect(hfAsked.map((a) => a.text)).toEqual(["protein design", "materials discovery"]);
  expect(hfAsked[0].window).toEqual({ since: "2024-10-14", until: "2026-10-14" });
  expect(hfOnFile(fs, "r-h1")).toMatchObject({ done: true, window: { since: "2025-10-14", until: "2026-10-14" } });
});

test("an X read that halts early waits for arXiv, and the build has both", async () => {
  const release = deferred();
  let cleaned = 0;
  const { seen, builder } = capturing();
  const halted: XReadResult = { ...unread("halted", "X said stop"), halt: { kind: "rate-limited", detail: "Rate limit exceeded" } };
  const { deps, fs } = fakeDeps({
    ...READ_BOTH,
    search: withArxiv(),
    builder: () => builder,
    searchArxiv: async (text) => {
      await release.promise;
      return three(text);
    },
    lane: async () => halted as never,
    readClean: async () => void cleaned++,
  });
  const running = runTask(deps, { runId: "r-b1", brief: BOTH });
  await until(() => fs.files.has("runs/r-b1/x-read.json"));
  expect(arxivOnFile(fs, "r-b1")).toMatchObject({ done: false, found: [] });
  expect(seen.length).toBe(0);

  release.resolve();
  expect((await running).status).toBe("completed");
  expect(seen[0].x.status).toBe("halted");
  expect(seen[0].arxiv.map((f) => f.query)).toEqual(["q1", "q2"]);
  expect(cleaned).toBe(0);
});

test("arXiv refused for its rate limit does not stop X, and sends one request per query", async () => {
  let requests = 0;
  const { seen, builder } = capturing();
  const { deps, trace } = fakeDeps({
    search: withArxiv(),
    builder: () => builder,
    searchArxiv: async () => {
      requests++;
      throw new HttpStatusError(429, "export.arxiv.org");
    },
  });
  const outcome = await runTask(deps, { runId: "r-c1", brief: FIRST_LOOK });
  expect((outcome as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  // X went its own way: the browse window was opened (the fake has none, so it reads as unavailable).
  expect(trace.opened).toBe(1);
  expect(seen[0].arxiv.map((f) => f.ladder?.outcome)).toEqual(["rate_limited", "rate_limited"]);
  expect(seen[0].arxiv[0].error).toContain("rate limited");
  expect(requests).toBe(2);
});

test("a half that throws lets the other finish and save before the run fails", async () => {
  const brokenArxiv = fakeDeps({
    ...READ_BOTH,
    search: withArxiv(),
    saveArxiv: async () => {
      throw new Error("disk full");
    },
  });
  const a = await runTask(brokenArxiv.deps, { runId: "r-d1", brief: BOTH });
  expect(a).toMatchObject({ status: "failed", error: { message: "disk full" } });
  expect(brokenArxiv.trace.opened).toBe(1);
  expect(brokenArxiv.fs.files.has("runs/r-d1/x-read.json")).toBe(true);
  expect(brokenArxiv.trace.built).toBe(0);
  expect(brokenArxiv.trace.locks).toEqual({ taken: 1, released: 1 });

  const brokenX = fakeDeps({
    ...READ_BOTH,
    search: withArxiv(),
    searchArxiv: async (text) => three(text),
    lane: async () => {
      throw new Error("the browse window crashed");
    },
  });
  const b = await runTask(brokenX.deps, { runId: "r-d2", brief: BOTH });
  expect(b).toMatchObject({ status: "failed", error: { message: "the browse window crashed" } });
  expect(arxivOnFile(brokenX.fs, "r-d2")).toMatchObject({ done: true, planned: ["q1", "q2"] });
});

test("the run's signal stops arXiv too, and the run asked again searches only what is not on file", async () => {
  const stop = new AbortController();
  const searched: string[] = [];
  const { deps, trace, fs } = fakeDeps({
    ...READ_BOTH,
    search: withArxiv(),
    searchArxiv: (text, _window, signal) => {
      searched.push(text);
      if (text === "protein design") return Promise.resolve(three(text));
      // The second query is still out when the run is stopped.
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new AbortError()), { once: true }));
    },
  });
  const running = runTask(deps, { runId: "r-e1", brief: BOTH }, stop.signal);
  await until(() => searched.length === 2 && fs.files.has("runs/r-e1/x-read.json"));
  stop.abort();
  expect((await running).status).toBe("aborted");
  expect(arxivOnFile(fs, "r-e1")).toMatchObject({ done: false, found: [{ query: "q1" }] });

  deps.searchArxiv = async (text) => (searched.push(text), three(text));
  const again = await runTask(deps, { runId: "r-e1", brief: BOTH });
  expect((again as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  expect(searched).toEqual(["protein design", "materials discovery", "materials discovery"]);
  // X is on file too: not opened again.
  expect(trace.opened).toBe(1);
});

test("arXiv runs when X is not read: a signed-out first look, and a retry with only arXiv to redo", async () => {
  const signedOut = capturing();
  const searchedA: string[] = [];
  const a = fakeDeps({
    search: withArxiv(),
    builder: () => signedOut.builder,
    checkSession: async () => "signed-out",
    searchArxiv: async (text) => (searchedA.push(text), three(text)),
  });
  expect(((await runTask(a.deps, { runId: "r-f1", brief: FIRST_LOOK })) as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  expect(a.trace.opened).toBe(0);
  expect(searchedA).toEqual(["protein design", "materials discovery"]);
  expect(signedOut.seen[0].x.status).toBe("unavailable");

  const retried = capturing();
  const searchedB: string[] = [];
  const b = fakeDeps({
    search: withArxiv(),
    builder: () => retried.builder,
    retryPlan: async () => ({ x: [], arxiv: ["q2"] }),
    searchArxiv: async (text) => (searchedB.push(text), three(text)),
  });
  const brief: TopicSearchBrief = { searchId: "ts-0000aaaa", kind: "retry", night: null, n: 1 };
  expect(((await runTask(b.deps, { runId: "r-f2", brief })) as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  expect(b.trace.opened).toBe(0);
  expect(searchedB).toEqual(["materials discovery"]);
  expect(retried.seen[0].arxiv.map((f) => f.query)).toEqual(["q2"]);
  expect(retried.seen[0].retry).toMatchObject({ arxiv: ["q2"] });
  // A retry reads a year back, as the first look does.
  expect(arxivOnFile(b.fs, "r-f2")?.window).toEqual({ since: "2025-10-14", until: "2026-10-14" });
});

// --- a first look in two parts (pace.ts) ----------------------------------------

test("a first look builds and delivers arXiv before X is even in the lane, then adds X to the same file", async () => {
  const gate = deferred();
  let entered = false;
  const said: string[] = [];
  const searched: string[] = [];
  const { seen, builder } = capturing();
  const { deps, trace, fs } = fakeDeps({
    search: withArxiv(),
    builder: () => builder,
    searchArxiv: async (text) => (searched.push(text), three(text)),
    lane: async (work) => {
      entered = true;
      await gate.promise;
      return work();
    },
    report: (_id, text) => void said.push(text),
  });
  const running = runTask(deps, { runId: "r-s1", brief: FIRST_LOOK });
  await until(() => entered);
  // X still waits; the first part is built, delivered and told to the brief.
  const file = "topic-search-ts-0000aaaa-2026-10-14.json";
  expect(trace.closed).toEqual([{ searchId: "ts-0000aaaa", kind: "first", night: null, resultFile: file }]);
  expect(trace.opened).toBe(0);
  expect(seen.length).toBe(1);
  expect(seen[0]).toMatchObject({ kind: "first", later: ["x"], retry: null });
  expect(seen[0].x).toMatchObject({ status: "unavailable", why: READ_LATER, posts: [] });
  expect(seen[0].arxiv.map((f) => f.query)).toEqual(["q1", "q2"]);
  expect(await loadFirstPart(fs, "runs/r-s1")).toMatchObject({ status: "delivered", resultFile: file, itemCount: 2 });
  expect(said).toContain(
    "arXiv done: 2 queries searched (2 direct), 6 papers; Hugging Face done: 2 queries searched (2 exhausted), 0 papers; X: read after the first part",
  );
  expect(said[said.length - 1]).toBe("first part delivered; waiting to read X");

  gate.resolve();
  const outcome = await running;
  expect((outcome as { result: TopicSearchRunResult }).result).toMatchObject({ status: "delivered", resultFile: file, itemCount: 4 });
  // The slow part: X alone, merged the way a retry merges, over every query it read.
  expect(seen[1]).toMatchObject({ kind: "first", retry: { runId: "r-s1", x: ["q1", "q2"], arxiv: [], part: "slow" } });
  expect(seen[1].arxiv).toEqual([]);
  expect(seen[1].later).toBeUndefined();
  expect(trace.closed[1]).toEqual({ searchId: "ts-0000aaaa", kind: "retry", night: null, resultFile: file });
  expect(trace.opened).toBe(1);
  expect(searched.length).toBe(2);
  expect(trace.ran.length).toBe(1);
});

test("X signed out when its part starts: the first part stands, the slow part reads nothing and still builds", async () => {
  const { seen, builder } = capturing();
  const { deps, trace } = fakeDeps({ search: withArxiv(), builder: () => builder, searchArxiv: async (text) => three(text), checkSession: async () => "signed-out" });
  const outcome = await runTask(deps, { runId: "r-s2", brief: FIRST_LOOK });
  expect((outcome as { result: TopicSearchRunResult }).result).toMatchObject({ status: "delivered", x: { status: "unavailable", why: "signed out of X" } });
  expect(trace.halts).toEqual(["signed-out"]);
  expect(trace.opened + trace.locks.taken).toBe(0);
  // Built anyway, so the file stops awaiting X and the source health says X failed (retry.ts plans it again).
  expect(seen.map((s) => s.retry?.part ?? null)).toEqual([null, "slow"]);
  expect(seen[1].x).toMatchObject({ status: "unavailable", why: "signed out of X" });
  expect(trace.closed.map((c) => c.kind)).toEqual(["first", "retry"]);
});

test("a first look tried again after X failed goes straight on to X: nothing built or told twice", async () => {
  const searched: string[] = [];
  const { seen, builder } = capturing();
  const { deps, trace } = fakeDeps({
    search: withArxiv(),
    builder: () => builder,
    searchArxiv: async (text) => (searched.push(text), three(text)),
    lane: async () => {
      throw new Error("the browse window crashed");
    },
  });
  const failed = await runTask(deps, { runId: "r-s3", brief: FIRST_LOOK });
  expect(failed).toMatchObject({ status: "failed", error: { message: "the browse window crashed" } });
  expect(trace.closed.map((c) => c.kind)).toEqual(["first"]);
  expect(seen.length).toBe(1);

  // The runner tries a failed run again: a new task under the same run id, from `open`.
  deps.lane = (work) => work();
  const again = await runTask(deps, { runId: "r-s3", brief: FIRST_LOOK });
  expect((again as { result: TopicSearchRunResult }).result).toMatchObject({ status: "delivered", itemCount: 4 });
  expect(trace.closed.map((c) => c.kind)).toEqual(["first", "retry"]);
  expect(seen.map((s) => s.retry?.part ?? null)).toEqual([null, "slow"]);
  expect(searched.length).toBe(2);
  expect(trace.ran.length).toBe(1);
});

test("a once-only search stopped after its first part still has X read", async () => {
  const { seen, builder } = capturing();
  let the = search({ once: true });
  const { deps, trace } = fakeDeps({
    builder: () => builder,
    loadSearch: async () => the,
    stopOnce: async () => void (the = { ...the, status: "stopped" }),
    lane: async () => {
      throw new Error("the browse window crashed");
    },
  });
  await runTask(deps, { runId: "r-s4", brief: FIRST_LOOK });
  expect(the.status).toBe("stopped");
  deps.lane = (work) => work();
  const again = await runTask(deps, { runId: "r-s4", brief: FIRST_LOOK });
  expect((again as { result: TopicSearchRunResult }).result.status).toBe("delivered");
  expect(seen.map((s) => s.retry?.part ?? null)).toEqual([null, "slow"]);
  expect(trace.opened).toBe(1);
});

test("a night's run searches arXiv from the search's last run", async () => {
  const { deps, fs } = fakeDeps({ search: withArxiv({ lastRunAt: local(2026, 10, 13, 2) }), now: local(2026, 10, 14, 2) });
  await runTask(deps, { runId: "r-g1", brief: { searchId: "ts-0000aaaa", kind: "daily", night: "2026-10-14" } });
  expect(arxivOnFile(fs, "r-g1")).toMatchObject({ done: true, window: { since: "2026-10-13", until: "2026-10-14" } });
});

test("with no builder the task fails and the worker gives up", async () => {
  const { deps } = fakeDeps({ builder: () => null });
  const task = topicSearchTask(deps);
  const off = registerProgramTask(task);
  const t = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "ts-run-")), responses: [] });
  try {
    const worker = topicSearchWorker({
      runtime: async () => t.runtime,
      task,
      reporters: new Map(),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    const ctx = { run: { id: "r-7" } as Run, report: async () => {} } as unknown as WorkerContext;
    const handle = worker(encodeBrief({ searchId: "ts-0000aaaa", kind: "first", night: null }), ctx);
    const error = await handle.done.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(GiveUpError);
    expect((error as Error).message).toBe(NO_BUILDER);
  } finally {
    off();
  }
});

test("the night tick asks once a night, inside the window, one keyed run per active search", async () => {
  const asks: DelegateInput[] = [];
  let now = local(2026, 10, 14, 0, 30);
  const tick = createNightTick({
    now: () => now,
    deviceId: () => "dev-a",
    conditions: async () => ({
      collecting: true,
      webview: true,
      sessionValid: true,
      gate: null,
      searches: [search({ id: "ts-a", createdAt: 2 }), search({ id: "ts-b", createdAt: 1 })],
    }),
    delegate: async (input) => {
      asks.push(input);
      return { ok: true, run: {} as Run, existing: false } as Delegated;
    },
  });
  expect(await tick()).toEqual([]);
  now = local(2026, 10, 14, 1, 45);
  expect(await tick()).toEqual(["ts-b", "ts-a"]);
  expect(asks.map((a) => a.idempotencyKey)).toEqual(["topic-search:ts-b:2026-10-14", "topic-search:ts-a:2026-10-14"]);
  expect(await tick()).toEqual([]);
  expect(asks.length).toBe(2);
});
