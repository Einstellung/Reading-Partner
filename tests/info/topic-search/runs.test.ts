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
  searchLines,
  topicSearchRunKey,
  topicSearchTask,
  type TopicSearchBrief,
  type TopicSearchRunDeps,
  type TopicSearchRunResult,
} from "../../../src/info/topic-search/run";
import type { BuildTopicSearchResult, BuildTopicSearchResultArgs } from "../../../src/info/topic-search/build-result";
import { createStateStore, nightLimits, permalinkBudget, progressLog, spendNight, takePermalink, emptyState, type StateFs } from "../../../src/info/topic-search/run-state";
import { createNightTick, topicSearchWorker } from "../../../src/info/topic-search/run-worker";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { unread } from "../../../src/info/topic-search/run";
import type { BrowseOpen } from "../../../src/workshop/extract/webview-browse";
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
  expect(lines[0]).toMatchObject({ order: "top", since: "2026-09-14", relevance: "What is new in AI for science?" });
  expect(searchLines(search(), "daily", 0)[1]).toMatchObject({ order: "live", relevance: "AI materials discovery" });
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
  return { deps, trace };
}

async function runTask(deps: TopicSearchRunDeps, input: { runId: string; brief: TopicSearchBrief }) {
  const task = topicSearchTask(deps);
  const off = registerProgramTask(task);
  const t = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "ts-run-")), responses: [] });
  try {
    return await runProgramTask<TopicSearchRunResult>(t.runtime, { task, key: input.runId, name: "topic-search", input });
  } finally {
    off();
  }
}

test("a first run reads, builds, hands its result to the brief and lets the lock go", async () => {
  const { deps, trace } = fakeDeps();
  const outcome = await runTask(deps, { runId: "r-1", brief: { searchId: "ts-0000aaaa", kind: "first", night: null } });
  expect(outcome.status).toBe("completed");
  const result = (outcome as { result: TopicSearchRunResult }).result;
  expect(result).toMatchObject({ status: "delivered", itemCount: 3 });
  expect(result.x?.status).toBe("unavailable");
  expect(trace.opened).toBe(1);
  expect(trace.built).toBe(1);
  expect(trace.closed).toEqual([{ searchId: "ts-0000aaaa", kind: "first", night: null, resultFile: "topic-search-ts-0000aaaa-2026-10-14.json" }]);
  expect(trace.ran.length).toBe(1);
  expect(trace.locks).toEqual({ taken: 1, released: 1 });
  expect(trace.stopped).toEqual([]);
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
