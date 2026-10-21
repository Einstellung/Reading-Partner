// A topic-search run (docs/info/88 「两种 run」): the first look at a topic,
// each night's increment, and a retry of what the first look missed (retry.ts,
// 「重跑第一次」), as the pi-durable task `rp.topicsearch` the legion worker of
// kind `topic-search` runs (run-worker.ts). Phases:
//
//   open     the search is still followed, the night is not over, X may be
//            read (halt.ts) and the session is real; take the keep-awake lock
//   read     the X lines (x-reader.ts), in the X lane, inside the lock, and
//            beside them the arXiv queries (arxiv-read.ts) and the same queries
//            on Hugging Face (hf-read.ts): plain HTTP that touches neither the
//            screen nor the X session, so it does not wait in the lane or for X.
//            No source's failure stops another; the run's signal stops all.
//            Each writes what it got to the run directory (`x-read.json`,
//            `arxiv-read.json`, `hf-read.json`), and the phase moves on once
//            all have settled
//   build    the result, by the builder the caller injected (not built here),
//            from both files, opening X pages only from what is left of the
//            day's allowance and the run's ceiling; then the source health it
//            wrote goes into the collector's state file
//   deliver  the search's last run time; a study (`once`) is not stopped
//            by it, only by the reader ending it (docs/info/91)
//   wrap     the lock let go, and the run told closed (`closed`): the nightly
//            brief (info/issue) waits for every search's run of the night and
//            gives a first look an issue of its own. A run puts nothing in the
//            box itself
//
// A first look is split by the sources' pace (pace.ts, 88 「第一次分两段」): its
// first part reads only the fast sources (arXiv, Hugging Face) and goes read, build, deliver,
// telling the brief at once (its own issue `first:<id>`, with the file saying
// what it still awaits); then `later` checks X the way `open` would, and the
// slow part goes read (X only), build (added to the same file the way a retry
// adds, retry.ts), deliver, and wrap tells the brief again, as a retry
// (`first:<id>#<runId>`). The checkpoints carry `part`; one without it (the
// other kinds, and a first look started before the split) reads everything in
// one go.
//
// Every run reads only the sources the topic's config names (pace.ts
// topicSources; a config without `sources` reads all, docs/info/91 来源开关).
// A topic without X is not split: its first look reads in one go, takes no
// keep-awake lock and waits on no X gate.
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
import type { HfSearch } from "./hf-ladder";
import { hfProgressLine, readHf } from "./hf-read";
import { lastNightAnchor, nightEndAt } from "./nightly";
import { readsSource, sourceNames, sourcesOf, splitsFirstLook, type RunPart } from "./pace";
import { relevanceBasis } from "./rank-pool";
import type { FirstPartOnFile } from "./run-state";
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
      relevance: relevanceBasis(q, "x"),
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
    collapse: past.collapse,
    captureSilent: past.captureSilent,
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
  /** A split first look's part (pace.ts). Absent: the run reads every source in one go. */
  part?: RunPart;
}

type Checkpoint =
  | { phase: "open" }
  | ({ phase: "read"; blocked: string | null } & Window)
  | ({ phase: "build" } & Window)
  | ({ phase: "deliver"; built: BuiltTopicSearchResult } & Window)
  /** A split first look whose first part is delivered: whether X may be read now. */
  | ({ phase: "later" } & Window)
  | { phase: "wrap"; result: TopicSearchRunResult; part?: RunPart };

/** Why X is not read in a split first look's first part. */
export const READ_LATER = "read after the first part";

/** Why X is not read for a topic whose config leaves it out (docs/info/91 来源开关). */
export const NOT_A_SOURCE = "not one of the topic's sources";

export interface TopicSearchRunResult {
  status: "delivered" | "empty" | "skipped";
  why: string | null;
  resultFile: string | null;
  itemCount: number;
  x: { status: XRunStatus; why: string | null; posts: number; searchPages: number; permalinkPages: number } | null;
  /** Candidates no model judged (88 「判不了」): nothing listed, the file says so, the next run judges them. Absent otherwise. */
  unjudged?: number;
}

/** The result file the brief takes from a run: one that lists something or says what waits to be judged. */
function briefFile(result: TopicSearchRunResult): string | null {
  return result.status === "delivered" || result.unjudged ? result.resultFile : null;
}

export interface TopicSearchRunDeps {
  loadSearch(id: string): Promise<TopicSearch | null>;
  /** Record that the search ran, at the moment its read started. */
  ran(search: TopicSearch, at: number): Promise<void>;
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
  /** The Hugging Face plugin's search slot, through the host gate (build-live.ts searchHfLive). */
  searchHf: HfSearch;
  saveHf(dir: string, read: ArxivRead): Promise<void>;
  loadHf(dir: string): Promise<ArxivRead | null>;
  /** A split first look's delivered first part, in the run directory (run-state.ts). */
  saveFirstPart(dir: string, part: FirstPartOnFile): Promise<void>;
  loadFirstPart(dir: string): Promise<FirstPartOnFile | null>;
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
  open(viewport: { width: number; height: number }, opts?: { initScript?: string }): Promise<BrowseOpen>;
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
  const skip = (runtime: Runtime, why: string, context: Context, part?: RunPart) =>
    next(
      runtime,
      { phase: "wrap", result: { status: "skipped", why, resultFile: null, itemCount: 0, x: null }, ...(part ? { part } : {}) },
      context,
    );
  const windowOf = (cp: Window): Window => ({
    startedAt: cp.startedAt,
    since: cp.since,
    night: cp.night,
    retry: cp.retry ?? null,
    ...(cp.part ? { part: cp.part } : {}),
  });

  // Why X may not be read now (the stop rules, then the session), or null.
  const xBlocked = async (night: string, searchId: string, runId: string): Promise<string | null> => {
    const gated = await deps.gate(night);
    if (gated) return gated;
    if ((await deps.checkSession()) !== "signed-out") return null;
    await deps.halted({ kind: "signed-out", detail: "the session check found no X session" }, { searchId, runId, night });
    return "signed out of X";
  };

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
          open: (viewport, opts) => deps.open(viewport, opts),
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

  // The run's paper queries on arXiv and on Hugging Face, those not yet on file in its directory.
  const paperPlan = (brief: TopicSearchBrief, window: Window, only: readonly string[] | null) => ({
    kind: lookOf(brief.kind),
    since: window.since,
    today: localDay(deps.now()),
    only,
  });
  const readHfOf = (
    search: TopicSearch,
    brief: TopicSearchBrief,
    window: Window,
    dir: string,
    signal: AbortSignal,
    onChange?: (read: ArxivRead) => void,
  ) =>
    readHf(
      search,
      // A retry planned before Hugging Face was a source has no list for it: it reads it where it reads arXiv.
      paperPlan(brief, window, window.retry ? (window.retry.huggingface ?? window.retry.arxiv) : null),
      { search: deps.searchHf, load: () => deps.loadHf(dir), save: (read) => deps.saveHf(dir, read), onChange },
      signal,
    );
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
      paperPlan(brief, window, window.retry?.arxiv ?? null),
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
        // A split first look tried again after its first part was out (a failure later) goes on to X.
        const split = splitsFirstLook(brief.kind, search);
        const delivered = split ? await deps.loadFirstPart(await deps.runDir(runId)) : null;
        const part = delivered ? ("slow" as const) : undefined;
        if (!search) return skip(runtime, "the topic search is gone", context, part);
        // A study ended by the reader, or a one-look search an older build stopped after its
        // first run (part): reading again what that run missed is still its first look.
        const open = search.status === "active" || ((brief.kind === "retry" || delivered !== null) && search.once === true);
        if (!open) return skip(runtime, "the topic search was stopped", context, part);
        if (delivered) {
          say(runId, "first part delivered; waiting to read X");
          const window: Window = { startedAt: delivered.startedAt, since: delivered.since, night: delivered.night, retry: null, part: "fast" };
          return next(runtime, { phase: "later", ...window }, context);
        }
        if (brief.kind === "daily" && now >= nightEndAt(night)) return skip(runtime, "the night is over", context);
        const retry = brief.kind === "retry" ? await deps.retryPlan(search) : null;
        if (retry && isEmptyPlan(retry)) return skip(runtime, "nothing the first look missed is left to read again", context);
        if (split) {
          // The fast sources first; X is checked when its part starts (`later`).
          say(runId, `${sourceNames(sourcesOf("fast", search))}: starting; ${sourceNames(sourcesOf("slow", search))}: ${READ_LATER}`);
          const window: Window = { startedAt: now, since: now - FIRST_LOOK_BACK_MS, night, retry: null, part: "fast" };
          return next(runtime, { phase: "read", blocked: null, ...window }, context);
        }
        // A topic that does not read X neither waits for it nor takes the lock (docs/info/91 来源开关).
        const readsX = readsSource(search, "x");
        const blocked = !readsX ? null : retry && retry.x.length === 0 ? "no X query to read again" : await xBlocked(night, search.id, runId);
        // A night's increment is X alone, and so is a retry with no paper query to read again
        // and no unjudged reads to judge; the first look still builds from what else it has.
        const papersLeft = retry ? retry.arxiv.length + (retry.huggingface?.length ?? 0) + (retry.judge?.length ?? 0) : 0;
        if (blocked && (brief.kind === "daily" || (retry && papersLeft === 0))) return skip(runtime, blocked, context);
        if (readsX && !blocked) await hold(runId);
        const since = brief.kind === "daily" ? (search.lastRunAt ?? now - FIRST_LOOK_BACK_MS) : now - FIRST_LOOK_BACK_MS;
        const xNow = readsX ? `${blocked ? `not reading X: ${blocked}` : "waiting to read X"}; ` : "";
        say(runId, `${xNow}${sourceNames(sourcesOf("fast", search))}: starting`);
        await next(runtime, { phase: "read", blocked, startedAt: now, since, night, retry }, context);
      }),
      read: guarded<Extract<Checkpoint, { phase: "read" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const window = windowOf(cp);
        const part = cp.part ?? null;
        const dir = await deps.runDir(runId);
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context, part ?? undefined);
        const reads = sourcesOf(part, search);
        // The run's line says where each source is: "reading X: ...; arXiv done: ...; Hugging Face done: ...".
        const line = {
          x: cp.blocked ? `not reading X: ${cp.blocked}` : "waiting to read X",
          arxiv: "arXiv: starting",
          hf: "Hugging Face: starting",
        };
        const papersLine = () => [reads.includes("arxiv") ? line.arxiv : "", reads.includes("huggingface") ? line.hf : ""].filter(Boolean).join("; ");
        const tell = () =>
          say(
            runId,
            part === "fast"
              ? `${papersLine()}; ${sourceNames(sourcesOf("slow", search))}: ${READ_LATER}`
              : part === "slow"
                ? `first part delivered; ${line.x}`
                : [reads.includes("x") ? line.x : "", papersLine()].filter(Boolean).join("; "),
          );
        const arxivWork = reads.includes("arxiv")
          ? readArxivOf(search, brief, window, dir, runtime.signal, (read) => {
              line.arxiv = arxivProgressLine(read);
              tell();
            })
          : Promise.resolve(null);
        const hfWork = reads.includes("huggingface")
          ? readHfOf(search, brief, window, dir, runtime.signal, (read) => {
              line.hf = hfProgressLine(read);
              tell();
            })
          : Promise.resolve(null);
        const xWork = (async () => {
          // A first part leaves X to the slow part, and writes nothing for it; nor does a topic that does not read X.
          if (!reads.includes("x")) return unread("unavailable", part === "fast" ? READ_LATER : NOT_A_SOURCE);
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
        // Each runs to the end whatever the others do; a failure is raised once all have settled.
        const [xDone, arxivDone, hfDone] = await Promise.allSettled([xWork, arxivWork, hfWork]);
        if (xDone.status === "rejected") throw xDone.reason;
        if (arxivDone.status === "rejected") throw arxivDone.reason;
        if (hfDone.status === "rejected") throw hfDone.reason;
        const x = xDone.value;
        const count = (read: ArxivRead | null) => (read?.found ?? []).reduce((n, f) => n + f.items.length, 0);
        const papers = `${count(arxivDone.value)} arXiv and ${count(hfDone.value)} Hugging Face papers`;
        if (brief.kind === "daily" && !(await runtime.memo<boolean>("night-spent", context))) {
          await deps.spendNight(window.night, x);
          await runtime.memo("night-spent", true, context);
        }
        if (reads.includes("x") && !cp.blocked && x.status !== "halted" && x.status !== "unavailable") await deps.readClean();
        await release(runId);
        say(
          runId,
          part === "fast"
            ? `read ${papers}; building the first part`
            : part === "slow"
              ? `read ${x.posts.length} posts (${x.status}); adding them to the first part`
              : reads.includes("x")
                ? `read ${x.posts.length} posts (${x.status}) and ${papers}; building the result`
                : `read ${papers}; building the result`,
        );
        await next(runtime, { phase: "build", ...window }, context);
      }),
      build: guarded<Extract<Checkpoint, { phase: "build" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const window = windowOf(cp);
        const part = cp.part ?? null;
        // Memos are the task's: the slow part's build keeps its own.
        const memo = (name: string) => (part === "slow" ? `${name}:slow` : name);
        const build = deps.builder();
        if (!build) throw new Error(NO_BUILDER);
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context, part ?? undefined);
        const dir = await deps.runDir(runId);
        const x =
          part === "fast"
            ? unread("unavailable", READ_LATER)
            : !readsSource(search, "x")
              ? unread("unavailable", NOT_A_SOURCE)
              : ((await deps.loadRead(dir)) ?? unread("unavailable", "what was read is missing"));
        let built = await runtime.memo<BuiltTopicSearchResult>(memo("built"), context);
        if (!built) {
          const look = lookOf(brief.kind);
          const xPages = deps.xPages({ kind: look, night: window.night, x });
          // The slow part adds to the first part's file the way a retry adds, over every query it read on X.
          const retry = window.retry
            ? { runId, x: window.retry.x, arxiv: window.retry.arxiv, huggingface: window.retry.huggingface ?? window.retry.arxiv }
            : part === "slow"
              ? { runId, x: readQueries(search).map((q) => q.id), arxiv: [], huggingface: [], part: "slow" as const }
              : null;
          // On file since the read phase; a run whose read phase came before a paper source moved (or was added) there searches it here.
          const arxiv = part === "slow" || !readsSource(search, "arxiv") ? [] : (await readArxivOf(search, brief, window, dir, runtime.signal)).found;
          const huggingface =
            part === "slow" || !readsSource(search, "huggingface") ? [] : (await readHfOf(search, brief, window, dir, runtime.signal)).found;
          const later = part === "fast" ? sourcesOf("slow", search) : undefined;
          const made = await build({
            topic: search,
            kind: look,
            x,
            arxiv,
            huggingface,
            since: window.since,
            runDir: dir,
            xPages,
            signal: runtime.signal,
            retry,
            ...(later ? { later } : {}),
            runId,
            // Reads of earlier runs no model judged, out of their run directories.
            carry: async (id) => {
              const from = await deps.runDir(id);
              const [xRead, arxivRead, hfRead] = await Promise.all([deps.loadRead(from), deps.loadArxiv(from), deps.loadHf(from)]);
              if (!xRead && !arxivRead && !hfRead) return null;
              return { x: xRead, arxiv: arxivRead?.found ?? [], huggingface: hfRead?.found ?? [] };
            },
          });
          built = await runtime.memo(
            memo("built"),
            { resultFile: made.resultFile, itemCount: made.itemCount, empty: made.empty, ...(made.unjudged ? { unjudged: made.unjudged } : {}) },
            context,
          );
        }
        if (!(await runtime.memo<boolean>(memo("health-folded"), context))) {
          await deps.foldSourceHealth(dir, search);
          await runtime.memo(memo("health-folded"), true, context);
        }
        await next(runtime, { phase: "deliver", built, ...window }, context);
      }),
      deliver: guarded<Extract<Checkpoint, { phase: "deliver" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const { built, startedAt } = cp;
        const part = cp.part ?? null;
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context, part ?? undefined);
        // A study (`once`) is not stopped by its delivery: it ends only when the reader
        // ends it (docs/info/91 结束, end_study), which calls apply.ts stopFollowing.
        if (part !== "slow") await deps.ran(search, startedAt);
        const dir = await deps.runDir(runId);
        const x = part === "fast" ? null : await deps.loadRead(dir);
        const result: TopicSearchRunResult = {
          status: !built.empty && built.resultFile ? "delivered" : "empty",
          why: null,
          resultFile: built.resultFile,
          itemCount: built.itemCount,
          x: x ? { status: x.status, why: x.why, posts: x.posts.length, searchPages: x.pages.search, permalinkPages: x.pages.permalink } : null,
          ...(built.unjudged ? { unjudged: built.unjudged } : {}),
        };
        if (part === "fast") {
          // The first part goes to the brief now, as the first look's own issue.
          if (!(await runtime.memo<boolean>("closed:fast", context))) {
            await deps.closed({
              runId,
              searchId: brief.searchId,
              kind: brief.kind,
              night: brief.night,
              resultFile: briefFile(result),
            });
            await runtime.memo("closed:fast", true, context);
          }
          // Written once the brief has it, so a task made again after a failure neither builds nor tells it twice.
          await deps.saveFirstPart(dir, {
            version: 1,
            startedAt: cp.startedAt,
            since: cp.since,
            night: cp.night,
            status: result.status === "delivered" ? "delivered" : "empty",
            resultFile: result.resultFile,
            itemCount: result.itemCount,
          });
          say(
            runId,
            `first part ${result.unjudged ? `not judged (${result.unjudged} candidates kept for the next run)` : `delivered: ${result.itemCount} items`}; ` +
              `waiting to read ${sourceNames(sourcesOf("slow", search))}`,
          );
          return next(runtime, { phase: "later", ...windowOf(cp) }, context);
        }
        if (part === "slow") {
          // The run's outcome is the whole file: the first part's items and what the slow part added.
          const fast = await deps.loadFirstPart(dir);
          const whole: TopicSearchRunResult = {
            ...result,
            status: result.status === "delivered" || fast?.status === "delivered" ? "delivered" : "empty",
            resultFile: result.resultFile ?? fast?.resultFile ?? null,
            itemCount: result.itemCount + (fast?.itemCount ?? 0),
          };
          return next(runtime, { phase: "wrap", result: whole, part }, context);
        }
        await next(runtime, { phase: "wrap", result }, context);
      }),
      later: guarded<Extract<Checkpoint, { phase: "later" }>>(async (task, runtime, context) => {
        const { brief, runId } = task.input;
        const cp = task.state.checkpoint;
        const search = await deps.loadSearch(brief.searchId);
        if (!search) return skip(runtime, "the topic search is gone", context, "slow");
        // Checked now, not at the run's start: the first part may have taken a while.
        const blocked = await xBlocked(cp.night, search.id, runId);
        if (!blocked) await hold(runId);
        say(runId, `first part delivered; ${blocked ? `not reading X: ${blocked}` : "waiting to read X"}`);
        // Blocked, the slow part still builds: it adds nothing, settles what the file awaits, and its source health says X failed.
        await next(runtime, { phase: "read", blocked, ...windowOf(cp), part: "slow" }, context);
      }),
      wrap: guarded<Extract<Checkpoint, { phase: "wrap" }>>(async (task, runtime, context) => {
        const { runId, brief } = task.input;
        await release(runId);
        const { result, part } = task.state.checkpoint;
        if (!(await runtime.memo<boolean>("closed", context))) {
          await deps.closed({
            runId,
            searchId: brief.searchId,
            // The slow part is told as what a retry adds: an issue of its own, keyed by this run (first:<id>#<runId>).
            kind: part === "slow" ? "retry" : brief.kind,
            night: brief.night,
            resultFile: briefFile(result),
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
