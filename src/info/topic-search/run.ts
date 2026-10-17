// A topic-search run (docs/info/88 「两种 run」): the first look at a topic,
// each night's increment, and a retry of what the first look missed (retry.ts,
// 「重跑第一次」), as the pi-durable task `rp.topicsearch` the legion worker of
// kind `topic-search` runs (run-worker.ts). Phases:
//
//   open     the search is still followed, the night is not over, X may be
//            read (halt.ts) and the session is real; take the keep-awake lock
//   read     the X lines (x-reader.ts), in the X lane, inside the lock, and
//            beside them the arXiv queries (arxiv-read.ts): plain HTTP that
//            touches neither the screen nor the X session, so it does not wait
//            in the lane or for X. Neither half's failure stops the other; the
//            run's signal stops both. Each writes what it got to the run
//            directory (`x-read.json`, `arxiv-read.json`), and the phase moves
//            on once both have settled
//   build    the result, by the builder the caller injected (not built here),
//            from both files, opening X pages only from what is left of the
//            day's allowance and the run's ceiling; then the source health it
//            wrote goes into the collector's state file
//   deliver  the search's last run time; a search the reader wanted to see
//            only once stops after its first
//   wrap     the lock let go, and the run told closed (`closed`): the nightly
//            brief (info/issue) waits for every search's run of the night and
//            gives a first look an issue of its own. A run puts nothing in the
//            box itself
//
// Every phase writes before it commits, and reads what an earlier attempt of
// it wrote, so a phase run again after a kill does not read X twice, build
// twice, or tell the brief twice. The definition lives here and reaches
// the Harness through legion/durable's program-task registry.

import type { Context } from "@earendil-works/chord";
import { defineTask, type Task, type TaskRuntime } from "@earendil-works/pi-durable";
import { StoppedError } from "../../legion/stop";
import type { KeepAwakeLock } from "../../platform/app/keep-awake";
import type { BrowseOpen } from "../../workshop/extract/webview-browse";
import type { XHalt } from "../x/search-page";
import type { ArxivSearch } from "./arxiv-ladder";
import { arxivProgressLine, readArxiv, type ArxivRead } from "./arxiv-read";
import type { BuildTopicSearchResult, BuildTopicSearchResultOutput, XPageBudget } from "./build-result";
import { lastNightAnchor, nightEndAt } from "./nightly";
import type { TopicSearch } from "./types";
import { isEmptyPlan, readQueries, type RetryPlan } from "./retry";
import { FIRST_LOOK_BACK_MS } from "./windows";
import { localDay, replay, xTally, type XProgressLog, type XReaderStore, type XRunStatus } from "./x-progress";
import { readXSearch, X_FIRST_RUN_LIMITS, type XReadLimits, type XReadLine, type XReadResult } from "./x-reader";

export type BuiltTopicSearchResult = BuildTopicSearchResultOutput;

export const TOPIC_SEARCH_KIND = "topic-search";
export const TOPIC_SEARCH_TASK = "rp.topicsearch";
export const TOPIC_SEARCH_HALT_BOX_KIND = "topic-search-halt";
export const NO_BUILDER = "no topic-search result builder is registered on this device";

/** The first look, a night's increment, or reading again what the first look missed (retry.ts). */
export type TopicSearchRunKind = "first" | "daily" | "retry";

/** How a run reads: a retry reads the way the first look does. */
export function lookOf(kind: TopicSearchRunKind): "first" | "daily" {
  return kind === "daily" ? "daily" : "first";
}

/** What a run is asked to do. `night` is the anchor date of a daily run; `n` numbers a search's retries. */
export interface TopicSearchBrief {
  searchId: string;
  kind: TopicSearchRunKind;
  night: string | null;
  n?: number;
}

/** 88: `topic-search:<id>:first`, `topic-search:<id>:<anchor date>`, or `topic-search:<id>:retry:<n>`. */
export function topicSearchRunKey(brief: TopicSearchBrief): string {
  const tail = brief.kind === "first" ? "first" : brief.kind === "retry" ? `retry:${brief.n ?? 1}` : brief.night;
  return `topic-search:${brief.searchId}:${tail}`;
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
    if (raw.kind === "retry" && Number.isInteger(raw.n) && (raw.n as number) > 0) {
      return { searchId: raw.searchId, kind: "retry", night: null, n: raw.n };
    }
    return null;
  } catch {
    return null;
  }
}

/** The X lines of a run: one per query of a picked subtopic or the whole topic; a retry's, only those it reads again. */
export function searchLines(search: TopicSearch, kind: "first" | "daily", since: number, only?: readonly string[]): XReadLine[] {
  return readQueries(search)
    .filter((q) => !only || only.includes(q.id))
    .map((q) => ({
      key: `${search.id}:${q.id}`,
      query: q.x,
      order: kind === "first" ? ("top" as const) : ("live" as const),
      ...(kind === "first" ? { since: localDay(since) } : {}),
      relevance: q.ranking.trim() || q.x,
    }));
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
  /** A retry's: what it reads again. Absent on the other kinds (and in checkpoints written before retries). */
  retry?: RetryPlan | null;
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
  x: { status: XRunStatus; why: string | null; posts: number; searchPages: number; permalinkPages: number } | null;
}

export interface TopicSearchRunDeps {
  loadSearch(id: string): Promise<TopicSearch | null>;
  /** Record that the search ran, at the moment its read started. */
  ran(search: TopicSearch, at: number): Promise<void>;
  /** Stop a search the reader wanted to see once (apply.ts stopFollowing). */
  stopOnce(search: TopicSearch): Promise<void>;
  builder(): BuildTopicSearchResult | null;
  /** The X pages the build may open after a read that used `x` (the daily allowance, the run's or night's ceiling). */
  xPages(about: { kind: "first" | "daily"; night: string; x: XReadResult }): XPageBudget;
  /** Fold the run's `<dir>/topic-search-source-health.json` into the collector's state file. */
  foldSourceHealth(dir: string, search: TopicSearch): Promise<void>;
  /** The run's directory, made if missing. */
  runDir(runId: string): Promise<string>;
  progress(dir: string): XProgressLog;
  saveRead(dir: string, x: XReadResult): Promise<void>;
  loadRead(dir: string): Promise<XReadResult | null>;
  /** The arXiv plugin's search slot, spaced per host (build-live.ts searchArxivLive). */
  searchArxiv: ArxivSearch;
  saveArxiv(dir: string, read: ArxivRead): Promise<void>;
  loadArxiv(dir: string): Promise<ArxivRead | null>;
  memory: XReaderStore;
  /** What is left of the night's ceiling, and spending it. */
  nightLimits(night: string): Promise<XReadLimits>;
  spendNight(night: string, x: XReadResult): Promise<void>;
  /** Why X may not be read on the night (halt.ts), or null. */
  gate(night: string): Promise<string | null>;
  /** A read that ended without a halt: forget the last one. */
  readClean(): Promise<void>;
  checkSession(): Promise<"ok" | "signed-out" | "unknown">;
  /** What a retry reads again (retry.ts planRetry over the collector's source health). */
  retryPlan(search: TopicSearch): Promise<RetryPlan>;
  /** X said stop: the state file, the collector's state file and the box. */
  halted(halt: XHalt, about: { searchId: string; runId: string; night: string }): Promise<void>;
  keepAwake(reason: string): Promise<KeepAwakeLock>;
  open(viewport: { width: number; height: number }): Promise<BrowseOpen>;
  expandLink(tco: string): Promise<string | null>;
  /**
   * The run is over: the brief (info/issue) takes the result file, null when
   * the run left nothing new. Called once per run, skipped runs included, so a
   * night's issue does not wait for a run that will never deliver.
   */
  closed(run: { runId: string; searchId: string; kind: TopicSearchRunKind; night: string | null; resultFile: string | null }): Promise<void>;
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
      { phase: "wrap", result: { status: "skipped", why, resultFile: null, itemCount: 0, x: null } },
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
    note: (text: string) => void,
  ): Promise<XReadResult> => {
    const { brief } = input;
    const look = lookOf(brief.kind);
    const limits = look === "first" ? X_FIRST_RUN_LIMITS : await deps.nightLimits(window.night);
    const deadline = brief.kind === "daily" ? nightEndAt(window.night) : null;
    const log = deps.progress(dir);
    // What the run reports while it reads: counts off the progress file, so the
    // run record (which syncs) says how far X has got (background_status).
    const tally = xTally();
    const watched: XProgressLog = {
      load: async () => {
        const steps = await log.load();
        for (const step of steps) tally.add(step);
        return steps;
      },
      append: async (step) => {
        await log.append(step);
        tally.add(step);
        note(`reading X: ${tally.line()}`);
      },
    };
    const sleep = async (ms: number) => {
      if (signal.aborted) throw new StoppedError();
      if (deadline !== null && deps.now() + ms >= deadline) throw new PastDeadline();
      await deps.sleep(ms, signal);
    };
    try {
      return await readXSearch(
        { lines: searchLines(search, look, window.since, window.retry?.x), limits },
        {
          open: (viewport) => deps.open(viewport),
          progress: watched,
          memory: deps.memory,
          expandLink: (tco) => deps.expandLink(tco),
          onHalt: (halt) => deps.halted(halt, { searchId: search.id, runId: input.runId, night: window.night }),
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

  // The run's arXiv queries, those not yet on file in its directory.
  const readArxivOf = (
    search: TopicSearch,
    brief: TopicSearchBrief,
    window: Window,
    dir: string,
    signal: AbortSignal,
    onChange?: (read: ArxivRead) => void,
  ) =>
    readArxiv(
      search,
      { kind: lookOf(brief.kind), since: window.since, today: localDay(deps.now()), only: window.retry?.arxiv ?? null },
      { search: deps.searchArxiv, load: () => deps.loadArxiv(dir), save: (read) => deps.saveArxiv(dir, read), onChange },
      signal,
    );

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
        // A one-look search stops itself after its first run; reading again what that run missed is still its first look.
        const open = search.status === "active" || (brief.kind === "retry" && search.once === true);
        if (!open) return skip(runtime, "the topic search was stopped", context);
        if (brief.kind === "daily" && now >= nightEndAt(night)) return skip(runtime, "the night is over", context);
        const retry = brief.kind === "retry" ? await deps.retryPlan(search) : null;
        if (retry && isEmptyPlan(retry)) return skip(runtime, "nothing the first look missed is left to read again", context);
        let blocked = retry && retry.x.length === 0 ? "no X query to read again" : await deps.gate(night);
        if (!blocked) {
          const session = await deps.checkSession();
          if (session === "signed-out") {
            await deps.halted({ kind: "signed-out", detail: "the session check found no X session" }, { searchId: search.id, runId, night });
            blocked = "signed out of X";
          }
        }
        // A night's increment is X alone, and so is a retry with no arXiv query to read again;
        // the first look still builds from what else it has.
        if (blocked && (brief.kind === "daily" || (retry && retry.arxiv.length === 0))) return skip(runtime, blocked, context);
        if (!blocked) await hold(runId);
        const since = brief.kind === "daily" ? (search.lastRunAt ?? now - FIRST_LOOK_BACK_MS) : now - FIRST_LOOK_BACK_MS;
        say(runId, `${blocked ? `not reading X: ${blocked}` : "waiting to read X"}; arXiv: starting`);
        await next(runtime, { phase: "read", blocked, startedAt: now, since, night, retry }, context);
      }),
      read: guarded<Extract<Checkpoint, { phase: "read" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const window: Window = { startedAt: cp.startedAt, since: cp.since, night: cp.night, retry: cp.retry ?? null };
        const dir = await deps.runDir(runId);
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context);
        // The run's line says where each half is: "reading X: ...; arXiv done: ...".
        const line = { x: cp.blocked ? `not reading X: ${cp.blocked}` : "waiting to read X", arxiv: "arXiv: starting" };
        const tell = () => say(runId, `${line.x}; ${line.arxiv}`);
        const arxivWork = readArxivOf(search, brief, window, dir, runtime.signal, (read) => {
          line.arxiv = arxivProgressLine(read);
          tell();
        });
        const xWork = (async () => {
          let read = await deps.loadRead(dir);
          if (!read) {
            if (cp.blocked) read = unread("unavailable", cp.blocked);
            else {
              await hold(runId);
              read = await deps.lane(() => {
                line.x = "reading X";
                tell();
                return readX(task.input, search, window, dir, runtime.signal, (text) => {
                  line.x = text;
                  tell();
                });
              });
            }
            await deps.saveRead(dir, read);
          }
          if (!cp.blocked) {
            line.x = `X read: ${read.posts.length} posts (${read.status})`;
            tell();
          }
          return read;
        })();
        // Both run to the end whatever the other does; a failure is raised once both have settled.
        const [xDone, arxivDone] = await Promise.allSettled([xWork, arxivWork]);
        if (xDone.status === "rejected") throw xDone.reason;
        if (arxivDone.status === "rejected") throw arxivDone.reason;
        const x = xDone.value;
        const papers = arxivDone.value.found.reduce((n, f) => n + f.items.length, 0);
        if (brief.kind === "daily" && !(await runtime.memo<boolean>("night-spent", context))) {
          await deps.spendNight(window.night, x);
          await runtime.memo("night-spent", true, context);
        }
        if (!cp.blocked && x.status !== "halted" && x.status !== "unavailable") await deps.readClean();
        await release(runId);
        say(runId, `read ${x.posts.length} posts (${x.status}) and ${papers} arXiv papers; building the result`);
        await next(runtime, { phase: "build", ...window }, context);
      }),
      build: guarded<Extract<Checkpoint, { phase: "build" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const window: Window = { startedAt: cp.startedAt, since: cp.since, night: cp.night, retry: cp.retry ?? null };
        const build = deps.builder();
        if (!build) throw new Error(NO_BUILDER);
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context);
        const dir = await deps.runDir(runId);
        const x = (await deps.loadRead(dir)) ?? unread("unavailable", "what was read is missing");
        let built = await runtime.memo<BuiltTopicSearchResult>("built", context);
        if (!built) {
          const look = lookOf(brief.kind);
          const xPages = deps.xPages({ kind: look, night: window.night, x });
          const retry = window.retry ? { runId, x: window.retry.x, arxiv: window.retry.arxiv } : null;
          // On file since the read phase; a run whose read phase came before arXiv moved there searches it here.
          const arxiv = (await readArxivOf(search, brief, window, dir, runtime.signal)).found;
          const made = await build({ topic: search, kind: look, x, arxiv, since: window.since, runDir: dir, xPages, signal: runtime.signal, retry });
          built = await runtime.memo("built", { resultFile: made.resultFile, itemCount: made.itemCount, empty: made.empty }, context);
        }
        if (!(await runtime.memo<boolean>("health-folded", context))) {
          await deps.foldSourceHealth(dir, search);
          await runtime.memo("health-folded", true, context);
        }
        await next(runtime, { phase: "deliver", built, ...window }, context);
      }),
      deliver: guarded<Extract<Checkpoint, { phase: "deliver" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const { built, startedAt } = task.state.checkpoint;
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context);
        await deps.ran(search, startedAt);
        if (brief.kind === "first" && search.once) await deps.stopOnce(search);
        const x = await deps.loadRead(await deps.runDir(runId));
        await next(
          runtime,
          {
            phase: "wrap",
            result: {
              status: !built.empty && built.resultFile ? "delivered" : "empty",
              why: null,
              resultFile: built.resultFile,
              itemCount: built.itemCount,
              x: x
                ? { status: x.status, why: x.why, posts: x.posts.length, searchPages: x.pages.search, permalinkPages: x.pages.permalink }
                : null,
            },
          },
          context,
        );
      }),
      wrap: guarded<Extract<Checkpoint, { phase: "wrap" }>>(async (task, runtime, context) => {
        const { runId, brief } = task.input;
        await release(runId);
        const result = task.state.checkpoint.result;
        if (!(await runtime.memo<boolean>("closed", context))) {
          await deps.closed({
            runId,
            searchId: brief.searchId,
            kind: brief.kind,
            night: brief.night,
            resultFile: result.status === "delivered" ? result.resultFile : null,
          });
          await runtime.memo("closed", true, context);
        }
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
      }),
    },
    abort: async (task, runtime, context) => {
      await release(task.input.runId);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
}
