// A topic-search run (docs/info/88 「两种 run」): the first look at a topic and
// each night's increment, as the pi-durable task `rp.topicsearch` the legion
// worker of kind `topic-search` runs (run-worker.ts). Phases:
//
//   open     the search is still followed, the night is not over, X may be
//            read (halt.ts) and the session is real; take the keep-awake lock
//   read     the X lines (x-reader.ts), in the X lane, inside the lock; what
//            came back is written to the run directory before moving on
//   build    the result, by the builder the caller injected (not built here)
//   deliver  a box item pointing at the result file; nothing when empty. A
//            search the reader wanted to see only once stops after its first
//   wrap     the lock let go
//
// Every phase writes before it commits, and reads what an earlier attempt of
// it wrote, so a phase run again after a kill does not read X twice, build
// twice, or put two items in the box. The definition lives here and reaches
// the Harness through legion/durable's program-task registry.

import type { Context } from "@earendil-works/chord";
import { defineTask, type Task, type TaskRuntime } from "@earendil-works/pi-durable";
import { t } from "../../i18n";
import { StoppedError } from "../../legion/stop";
import type { KeepAwakeLock } from "../../platform/app/keep-awake";
import type { BrowseOpen } from "../../workshop/extract/webview-browse";
import type { XHalt } from "../x/search-page";
import { lastNightAnchor, nightEndAt } from "./nightly";
import type { TopicSearch } from "./types";
import { localDay, replay, type XProgressLog, type XReaderStore, type XRunStatus } from "./x-progress";
import { readXSearch, X_FIRST_RUN_LIMITS, type XReadLimits, type XReadLine, type XReadResult } from "./x-reader";

/** Builds the result file out of what was read. Injected; another part of phase 3 implements it. */
export type BuildTopicSearchResult = (args: {
  topic: TopicSearch;
  kind: "first" | "daily";
  x: XReadResult;
  /** Start of this run's window, ms: 30 days back for the first run, the last run for a daily one. */
  since: number;
  runDir: string;
  signal: AbortSignal;
}) => Promise<{ resultFile: string | null; itemCount: number; empty: boolean }>;

export type BuiltTopicSearchResult = Awaited<ReturnType<BuildTopicSearchResult>>;

export const TOPIC_SEARCH_KIND = "topic-search";
export const TOPIC_SEARCH_TASK = "rp.topicsearch";
export const TOPIC_SEARCH_BOX_KIND = "topic-search";
export const TOPIC_SEARCH_HALT_BOX_KIND = "topic-search-halt";
/** How far back the first run looks (88: initial value). */
export const FIRST_LOOK_BACK_MS = 30 * 24 * 60 * 60_000;
export const NO_BUILDER = "no topic-search result builder is registered on this device";

export type TopicSearchRunKind = "first" | "daily";

/** What a run is asked to do. `night` is the anchor date of a daily run. */
export interface TopicSearchBrief {
  searchId: string;
  kind: TopicSearchRunKind;
  night: string | null;
}

/** 88: `topic-search:<id>:first`, or `topic-search:<id>:<anchor date>`. */
export function topicSearchRunKey(brief: TopicSearchBrief): string {
  return `topic-search:${brief.searchId}:${brief.kind === "first" ? "first" : brief.night}`;
}

export function encodeBrief(brief: TopicSearchBrief): string {
  return JSON.stringify(brief);
}

export function parseBrief(text: string): TopicSearchBrief | null {
  try {
    const raw = JSON.parse(text) as Partial<TopicSearchBrief>;
    if (typeof raw.searchId !== "string" || !raw.searchId) return null;
    if (raw.kind === "first") return { searchId: raw.searchId, kind: "first", night: null };
    if (raw.kind === "daily" && typeof raw.night === "string") return { searchId: raw.searchId, kind: "daily", night: raw.night };
    return null;
  } catch {
    return null;
  }
}

/** The X lines of a run: one per query of a picked subtopic or the whole topic. */
export function searchLines(search: TopicSearch, kind: TopicSearchRunKind, since: number): XReadLine[] {
  const picked = new Set(search.subtopics.filter((s) => s.picked).map((s) => s.id));
  return search.queries
    .filter((q) => q.subtopic === null || picked.has(q.subtopic))
    .map((q) => ({
      key: `${search.id}:${q.id}`,
      query: q.x,
      order: kind === "first" ? ("top" as const) : ("live" as const),
      ...(kind === "first" ? { since: localDay(since) } : {}),
      relevance: q.ranking.trim() || q.x,
    }));
}

/** The box item's line, written by the program (88 「送达」). */
export function deliveryCover(name: string, kind: TopicSearchRunKind, itemCount: number): string {
  return kind === "first"
    ? t("info.topicSearch.boxFirst", { name })
    : t("info.topicSearch.boxDaily", { name, n: String(itemCount) });
}

/** A read that opened nothing, with the reason. */
export function unread(status: XRunStatus, why: string): XReadResult {
  return { status, why, halt: null, posts: [], lines: [], pages: { search: 0, permalink: 0 }, activeMs: 0 };
}

/** What a progress file says was read, for a read cut short from outside (the night ended). */
export function readFromSteps(steps: Parameters<typeof replay>[0], status: XRunStatus, why: string): XReadResult {
  const past = replay(steps);
  return {
    status,
    why,
    halt: past.halt,
    posts: [...past.posts.values()],
    lines: [...past.lineEnds].map(([key, end]) => ({ key, ...end })),
    pages: { ...past.pages },
    activeMs: past.activeMs,
  };
}

export interface TopicSearchTaskInput {
  runId: string;
  brief: TopicSearchBrief;
}

interface Window {
  startedAt: number;
  since: number;
  night: string;
}

type Checkpoint =
  | { phase: "open" }
  | ({ phase: "read"; blocked: string | null } & Window)
  | ({ phase: "build" } & Window)
  | ({ phase: "deliver"; built: BuiltTopicSearchResult } & Window)
  | { phase: "wrap"; result: TopicSearchRunResult };

export interface TopicSearchRunResult {
  status: "delivered" | "empty" | "skipped";
  why: string | null;
  resultFile: string | null;
  itemCount: number;
  boxItemId: string | null;
  x: { status: XRunStatus; why: string | null; posts: number; searchPages: number; permalinkPages: number } | null;
}

export interface TopicSearchRunDeps {
  loadSearch(id: string): Promise<TopicSearch | null>;
  /** Record that the search ran, at the moment its read started. */
  ran(search: TopicSearch, at: number): Promise<void>;
  /** Stop a search the reader wanted to see once (apply.ts stopFollowing). */
  stopOnce(search: TopicSearch): Promise<void>;
  builder(): BuildTopicSearchResult | null;
  /** The run's directory, made if missing. */
  runDir(runId: string): Promise<string>;
  progress(dir: string): XProgressLog;
  saveRead(dir: string, x: XReadResult): Promise<void>;
  loadRead(dir: string): Promise<XReadResult | null>;
  memory: XReaderStore;
  /** What is left of the night's ceiling, and spending it. */
  nightLimits(night: string): Promise<XReadLimits>;
  spendNight(night: string, x: XReadResult): Promise<void>;
  /** Why X may not be read on the night (halt.ts), or null. */
  gate(night: string): Promise<string | null>;
  /** A read that ended without a halt: forget the last one. */
  readClean(): Promise<void>;
  checkSession(): Promise<"ok" | "signed-out" | "unknown">;
  /** X said stop: the state file, the collector's state file and the box. */
  halted(halt: XHalt, about: { searchId: string; runId: string; night: string }): Promise<void>;
  keepAwake(reason: string): Promise<KeepAwakeLock>;
  open(viewport: { width: number; height: number }): Promise<BrowseOpen>;
  expandLink(tco: string): Promise<string | null>;
  /** Put the result in the box under `id`; an id already there is left alone. */
  deliver(item: { id: string; runId: string; cover: string; resultFile: string; date: string }): Promise<void>;
  newBoxItemId(): string;
  /** One piece of X work at a time (x-lane.ts). */
  lane<T>(work: () => Promise<T>): Promise<T>;
  report?(runId: string, text: string): void;
  now(): number;
  random(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

class PastDeadline extends Error {}

type Runtime = TaskRuntime<TopicSearchTaskInput, Checkpoint, TopicSearchRunResult, object>;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function topicSearchTask(
  deps: TopicSearchRunDeps,
): Task<TopicSearchTaskInput, Checkpoint, TopicSearchRunResult, object> {
  // The keep-awake lock of each run in flight in this process. A process that
  // died took its lock with it; the phase that resumes takes a new one.
  const locks = new Map<string, Promise<KeepAwakeLock>>();
  const hold = (runId: string) => {
    if (!locks.has(runId)) locks.set(runId, deps.keepAwake(`Reading X for a topic search (${runId})`));
    return locks.get(runId)!;
  };
  const release = async (runId: string) => {
    const lock = locks.get(runId);
    locks.delete(runId);
    if (lock) await (await lock).release();
  };
  const say = (runId: string, text: string) => deps.report?.(runId, text);

  const next = (runtime: Runtime, checkpoint: Checkpoint, context: Context) =>
    runtime.commit(() => ({ status: "running", checkpoint }), context);
  const skip = (runtime: Runtime, why: string, context: Context) =>
    next(
      runtime,
      { phase: "wrap", result: { status: "skipped", why, resultFile: null, itemCount: 0, boxItemId: null, x: null } },
      context,
    );

  // A phase that throws ends the task as failed, so the legion run sees why;
  // an abort goes to the definition's abort.
  const guarded =
    <C>(body: (task: { input: TopicSearchTaskInput; state: { checkpoint: C } }, runtime: Runtime, context: Context) => Promise<void>) =>
    async (task: { input: TopicSearchTaskInput; state: { checkpoint: C } }, runtime: Runtime, context: Context) => {
      try {
        await body(task, runtime, context);
      } catch (e) {
        if (runtime.signal.aborted) throw e;
        await release(task.input.runId);
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "failed", error: { message: message(e) } } }), context);
      }
    };

  const readX = async (
    input: TopicSearchTaskInput,
    search: TopicSearch,
    window: Window,
    dir: string,
    signal: AbortSignal,
  ): Promise<XReadResult> => {
    const { brief, runId } = input;
    const limits = brief.kind === "first" ? X_FIRST_RUN_LIMITS : await deps.nightLimits(window.night);
    const deadline = brief.kind === "daily" ? nightEndAt(window.night) : null;
    const log = deps.progress(dir);
    const sleep = async (ms: number) => {
      if (signal.aborted) throw new StoppedError();
      if (deadline !== null && deps.now() + ms >= deadline) throw new PastDeadline();
      await deps.sleep(ms, signal);
    };
    try {
      return await readXSearch(
        { lines: searchLines(search, brief.kind, window.since), limits },
        {
          open: (viewport) => deps.open(viewport),
          progress: log,
          memory: deps.memory,
          expandLink: (tco) => deps.expandLink(tco),
          onHalt: (halt) => deps.halted(halt, { searchId: search.id, runId, night: window.night }),
          sleep,
          now: () => deps.now(),
          random: () => deps.random(),
        },
      );
    } catch (e) {
      if (!(e instanceof PastDeadline)) throw e;
      // 04:40: what was read stands, and the file says the run ended, so a
      // rerun answers from it without opening X again.
      const steps = await log.load();
      const why = "the night is over";
      const n = steps.reduce((most, s) => Math.max(most, s.n), 0) + 1;
      const activeMs = steps.reduce((most, s) => Math.max(most, s.activeMs), 0);
      await log.append({ kind: "end", status: "limit", why, n, at: deps.now(), activeMs });
      return readFromSteps(steps, "limit", why);
    }
  };

  return defineTask<TopicSearchTaskInput, Checkpoint, TopicSearchRunResult>({
    name: TOPIC_SEARCH_TASK,
    version: 1,
    initial: () => ({ phase: "open" }),
    phases: {
      open: guarded(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const now = deps.now();
        const night = brief.night ?? lastNightAnchor(now);
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context);
        if (search.status !== "active") return skip(runtime, "the topic search was stopped", context);
        if (brief.kind === "daily" && now >= nightEndAt(night)) return skip(runtime, "the night is over", context);
        let blocked = await deps.gate(night);
        if (!blocked) {
          const session = await deps.checkSession();
          if (session === "signed-out") {
            await deps.halted({ kind: "signed-out", detail: "the session check found no X session" }, { searchId: search.id, runId, night });
            blocked = "signed out of X";
          }
        }
        // A night's increment is X alone; the first look still builds from what else it has.
        if (blocked && brief.kind === "daily") return skip(runtime, blocked, context);
        if (!blocked) await hold(runId);
        const since = brief.kind === "first" ? now - FIRST_LOOK_BACK_MS : (search.lastRunAt ?? now - FIRST_LOOK_BACK_MS);
        say(runId, blocked ? `not reading X: ${blocked}` : "reading X");
        await next(runtime, { phase: "read", blocked, startedAt: now, since, night }, context);
      }),
      read: guarded<Extract<Checkpoint, { phase: "read" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const window: Window = { startedAt: cp.startedAt, since: cp.since, night: cp.night };
        const dir = await deps.runDir(runId);
        let x = await deps.loadRead(dir);
        if (!x) {
          if (cp.blocked) x = unread("unavailable", cp.blocked);
          else {
            const search = await deps.loadSearch(brief.searchId);
            if (!search) return skip(runtime, "the topic search is gone", context);
            await hold(runId);
            x = await deps.lane(() => readX(task.input, search, window, dir, runtime.signal));
          }
          await deps.saveRead(dir, x);
        }
        if (brief.kind === "daily" && !(await runtime.memo<boolean>("night-spent", context))) {
          await deps.spendNight(window.night, x);
          await runtime.memo("night-spent", true, context);
        }
        if (!cp.blocked && x.status !== "halted" && x.status !== "unavailable") await deps.readClean();
        await release(runId);
        say(runId, `read ${x.posts.length} posts (${x.status}); building the result`);
        await next(runtime, { phase: "build", ...window }, context);
      }),
      build: guarded<Extract<Checkpoint, { phase: "build" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const window: Window = { startedAt: cp.startedAt, since: cp.since, night: cp.night };
        const build = deps.builder();
        if (!build) throw new Error(NO_BUILDER);
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context);
        const dir = await deps.runDir(runId);
        const x = (await deps.loadRead(dir)) ?? unread("unavailable", "what was read is missing");
        let built = await runtime.memo<BuiltTopicSearchResult>("built", context);
        if (!built) {
          const made = await build({ topic: search, kind: brief.kind, x, since: window.since, runDir: dir, signal: runtime.signal });
          built = await runtime.memo("built", { resultFile: made.resultFile, itemCount: made.itemCount, empty: made.empty }, context);
        }
        await next(runtime, { phase: "deliver", built, ...window }, context);
      }),
      deliver: guarded<Extract<Checkpoint, { phase: "deliver" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const { built, startedAt } = task.state.checkpoint;
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context);
        let boxItemId: string | null = null;
        if (!built.empty && built.resultFile) {
          boxItemId = await runtime.memo("box-item", deps.newBoxItemId(), context);
          await deps.deliver({
            id: boxItemId,
            runId,
            cover: deliveryCover(search.name, brief.kind, built.itemCount),
            resultFile: built.resultFile,
            date: localDay(deps.now()),
          });
        }
        await deps.ran(search, startedAt);
        if (brief.kind === "first" && search.once) await deps.stopOnce(search);
        const x = await deps.loadRead(await deps.runDir(runId));
        await next(
          runtime,
          {
            phase: "wrap",
            result: {
              status: boxItemId ? "delivered" : "empty",
              why: null,
              resultFile: built.resultFile,
              itemCount: built.itemCount,
              boxItemId,
              x: x
                ? { status: x.status, why: x.why, posts: x.posts.length, searchPages: x.pages.search, permalinkPages: x.pages.permalink }
                : null,
            },
          },
          context,
        );
      }),
      wrap: guarded<Extract<Checkpoint, { phase: "wrap" }>>(async (task, runtime, context) => {
        await release(task.input.runId);
        const result = task.state.checkpoint.result;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
      }),
    },
    abort: async (task, runtime, context) => {
      await release(task.input.runId);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
}
