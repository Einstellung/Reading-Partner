// The info-briefing orchestrator (docs/16, docs/35): a funnel of four phases —
// discover headlines, screen them, fetch the survivors' bodies, triage what is
// left — ending in the briefing and the article cache. Like the notes pipeline
// it is a resumable state machine — the run checkpoint in run-state.ts is its
// state.json — with the same shape besides: injected deps so it runs headless in
// tests, subscribe/snapshot so the vestibule can show liveness, stoppable.
//
// The funnel is what keeps a briefing's cost off the subscription count: the two
// expensive steps (a page fetch per article, a triage prompt carrying every
// article's text) only ever see the few items screening kept, while the cheap
// steps scale with the day.
//
// Discovery is no longer where the day's material comes from — the pool is
// (item-pool.ts, collector.ts). Background collection polls each source on its
// own interval, and a run draws from what has accumulated: everything nobody has
// judged, plus what today's briefing already carries, so a refresh merges into
// the day's one briefing instead of starting a second. What the run settles goes
// back into the pool, so tomorrow morning does not re-judge tonight's headlines.
//
// Resumable because of where it runs (docs/22): on a phone a run takes minutes,
// and the OS may suspend or kill a backgrounded webview at any point in it.
// Every phase spends something the reader cannot get back — requests, tokens,
// patience — so a run that is cut off keeps what each phase already paid for and
// the next start picks up from there: discovered sources are not rediscovered,
// judged items are not rejudged, fetched bodies are not refetched.

import { isAbortError } from "../../platform/app/abort";
import {
  resolveWatchdogConfig,
  runWithWatchdog,
  StoppedError,
  type AiCallOptions,
  type WatchdogConfig,
} from "../../ai/watchdog";
import { mapSettled } from "../sources/pool";
import {
  SCREEN_BATCH_SIZE,
  SCREEN_CONCURRENCY,
  SCREEN_MAX_KEEP,
  screenBatches,
  type ScreenVerdict,
} from "./screen";
import type { CachedArticle } from "./store";
import { todayLocal } from "./store";
import {
  applyBody,
  applySourceResult,
  applyVerdicts,
  collectProgress,
  createRunState,
  emptyProgress,
  finishScreening,
  pendingBodies,
  pendingSources,
  retryFailedSources,
  seedRun,
  selectedItems,
  startupAction,
  syncSources,
  unscreenedItems,
  type CollectProgress,
  type InfoRunPhase,
  type InfoRunState,
  type InfoSourceRef,
  type RunSeed,
  type SourceResult,
} from "./run-state";
import type { PoolRecord } from "./item-pool";
import type { FeedbackEvent } from "../../observation/feedback";
import type { Briefing, BriefingItemMeta, ScreenSummary, TriageResult } from "./types";
import type { InfoItem } from "../sources/item";

export type { AiCallOptions };
export type { CollectProgress, InfoSourceRef, SourceResult };

const ACTIVITY_NOTIFY_MS = 250;

// How many settled bodies may accumulate before the checkpoint is written. Per
// body would be correct and wasteful: the checkpoint is one self-contained file
// holding every body collected so far, so writing it 120 times over would cost
// more than the fetches it protects.
const BODY_CHECKPOINT_EVERY = 10;

// Phase order, so a resumed run can tell which phases it is already past.
const PHASE_RANK: Record<InfoRunPhase, number> = {
  discovering: 0,
  screening: 1,
  fetching: 2,
  triaging: 3,
};

export interface InfoDeps {
  loadBriefing(date: string): Promise<Briefing | null>;
  loadProfile(): Promise<string>;
  loadFeedback(): Promise<FeedbackEvent[]>;
  // Optional reading-side signal (docs/16): what the reader is reading and stuck
  // on lately, injected into triage as background relevance context. Absent, or
  // returning "" / throwing, simply omits the section — it never blocks a briefing.
  loadReaderContext?(): Promise<string>;
  // The enabled sources, in list order. The run checkpoint is per source, so the
  // roster has to be known before any fetching starts.
  listSources(): Promise<InfoSourceRef[]>;
  // Discovery (docs/35): ask each source for its list of items — headlines,
  // blurbs, dates, and whatever bodies the list response already carried — and
  // send no per-article request. A resumed run passes only what it still owes.
  // `onSettled` is awaited as each source finishes, which is what makes the
  // checkpoint per source rather than per run: the slow ones cannot lose the
  // fast ones' work. Per-source isolation stays in the engine — a failed source
  // arrives here as a result with an error, not as a thrown run.
  //
  // `signal` is the Stop, and it has to reach the fetches: a Stop that only took
  // effect at the phase boundary would look like a button that does nothing. A
  // source cut off mid-fetch is not reported, so it stays pending and the resume
  // rediscovers it; the ones that already settled are kept.
  //
  // `force` says whether this run was asked for by hand. Background collection
  // keeps the pool stocked on each source's own interval (docs/35), so an
  // automatic run polls only what is genuinely due and takes the rest from the
  // pool; a regenerate the user asked for goes and looks regardless, because a
  // schedule is not an answer to "re-collect everything".
  discover(
    sources: InfoSourceRef[],
    onSettled: (result: SourceResult) => Promise<void>,
    signal: AbortSignal,
    opts: { force: boolean },
  ): Promise<void>;
  // Screening: one AI call over one batch of discovered items, answering only
  // "is this worth fetching the body for". The pipeline owns the batching and
  // the concurrency; this is the single call, wrapped by the watchdog outside.
  // Throws on a stall/error so the watchdog can retry the attempt.
  screen(
    input: { profile: string; items: InfoItem[] },
    opts: AiCallOptions,
  ): Promise<ScreenVerdict[]>;
  // Material: fetch the article bodies of the items screening kept. `onSettled`
  // is awaited per item so a run cut off keeps the bodies it paid for. A body
  // that will not come degrades the item to summary-only rather than failing;
  // only a Stop throws.
  fetchBodies(
    items: InfoItem[],
    onSettled: (item: InfoItem) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  // The one triage AI call, wrapped by the watchdog. Validates + retries parse
  // internally; throws on a stall/error so the watchdog can retry the attempt.
  triage(
    input: { profile: string; feedback: FeedbackEvent[]; items: InfoItem[]; readerContext?: string },
    opts: AiCallOptions,
  ): Promise<TriageResult>;
  // Where a run's wall clock went, one line per phase (live.ts writes them to
  // events-info.jsonl). Optional: instrumentation never decides whether a
  // briefing generates.
  logPhase?(phase: InfoRunPhase, data: Record<string, number>): void;
  saveBriefing(briefing: Briefing): Promise<void>;
  saveArticles(date: string, articles: Record<string, CachedArticle>): Promise<void>;
  // Persist / load the day's item snapshot so a profile change can re-triage the
  // cached items without re-collecting. Written only when a run completes: a
  // half-collected day must never become the snapshot a re-triage reads.
  saveItems(date: string, items: InfoItem[]): Promise<void>;
  loadItems(date: string): Promise<InfoItem[]>;
  // The run checkpoint (run-state.ts).
  loadRun(date: string): Promise<InfoRunState | null>;
  saveRun(state: InfoRunState): Promise<void>;
  clearRun(date: string): Promise<void>;
  // The item pool (docs/35). Absent, a run is exactly what it was before the
  // pool existed: it judges and fetches the day from scratch.
  //
  // poolDraw hands over the day's candidates — what nobody has judged yet, what
  // was judged worth keeping but never delivered, and what today's briefing
  // already carries — with the verdicts and bodies already paid for. poolRecord
  // hands back what this run decided, so tomorrow morning does not re-judge
  // tonight's headlines. Both are best effort: a pool that cannot be read or
  // written costs requests and tokens, never a briefing.
  poolDraw?(date: string): Promise<RunSeed>;
  poolRecord?(date: string, record: PoolRecord): Promise<void>;
  // Whether a briefing may be generated without being asked for: a provider is
  // configured and at least one source is subscribed. Absent means no — nothing
  // spends the reader's money on a guess.
  canAutoGenerate?(): Promise<boolean>;
  // Optional housekeeping: drop the derived per-day info files of every day but
  // the given one. Absent, or throwing, leaves the old files on disk.
  pruneStaleDays?(today: string): Promise<void>;
  // Optional screen wake lock for the length of a run (platform/app/wake-lock).
  // Best effort by construction: a screen that sleeps is a worse experience, not
  // a broken run.
  keepAwake?(on: boolean): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(ms: number, cb: () => void): () => void;
  today?(): string;
}

// The run phases as the UI names them, plus idle. Same four as InfoRunPhase
// (docs/35): "fetching" is the article-body step, not the whole collection.
export type InfoPhase = "idle" | InfoRunPhase;

export interface InfoActivity {
  startedAt: number;
  chars: number;
  attempt: number;
  attempts: number;
}

export interface InfoSnapshot {
  briefing: Briefing | null;
  running: boolean;
  // Stop was pressed and the run has not unwound yet. It flips the instant the
  // button is pressed, before anything is aborted, because the alternative is a
  // UI that sits unchanged until the last fetch comes back.
  stopping: boolean;
  phase: InfoPhase;
  collect: CollectProgress | null;
  activity: InfoActivity | null;
  error: string | null;
}

// What a start attempt did. "busy" used to be a silent early return, which is a
// promise that resolves like a start and changes nothing: the caller drew a
// progress card for a run that never began, and nothing was ever going to
// update it. Callers have to read this.
export type RunStart = "started" | "busy";

// A start attempt: what it did, and when the run it concerns is over — the one
// this call started, or, when it was refused, the one that was already going.
// Not a promise of the outcome, because the two answers are needed at different
// times: "did this start a run" has to be answered now, before anything is
// drawn, while "is the run finished" cannot be answered for minutes.
export interface RunHandle {
  start: RunStart;
  done: Promise<void>;
}

function itemsMeta(items: InfoItem[]): Record<string, BriefingItemMeta> {
  const out: Record<string, BriefingItemMeta> = {};
  for (const it of items) {
    out[it.id] = {
      title: it.title,
      url: it.url,
      source: it.source,
      sourceName: it.sourceName,
      publishedAt: it.publishedAt,
    };
  }
  return out;
}

function articleCache(items: InfoItem[]): Record<string, CachedArticle> {
  const out: Record<string, CachedArticle> = {};
  for (const it of items) {
    if (it.contentHtml || it.textContent) {
      out[it.id] = { contentHtml: it.contentHtml, textContent: it.textContent };
    }
  }
  return out;
}

export class InfoPipeline {
  private briefing: Briefing | null = null;
  private running = false;
  private stopping = false;
  private phase: InfoPhase = "idle";
  private collect: CollectProgress | null = null;
  private activity: InfoActivity | null = null;
  private error: string | null = null;
  private lastActivityNotify = 0;
  private listeners = new Set<() => void>();
  private snap: InfoSnapshot = {
    briefing: null,
    running: false,
    stopping: false,
    phase: "idle",
    collect: null,
    activity: null,
    error: null,
  };
  private readonly config: WatchdogConfig;
  private stopController: AbortController | null = null;
  // The run in flight and whether it has changes not yet on disk. Null between
  // runs: the checkpoint file, not this field, is what a resume reads.
  private run: InfoRunState | null = null;
  // The run in flight, as something to await. The UI subscribes instead; this is
  // for init and for the tests, and it is what a refused start hands back so the
  // caller can still wait on the run it lost the race to.
  private current: Promise<void> = Promise.resolve();
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  // Whether the run in flight was asked for by hand. It decides one thing: a
  // hand-driven run polls every source, an automatic one only what is due.
  private byHand = false;

  constructor(private readonly deps: InfoDeps, config: Partial<WatchdogConfig> = {}) {
    this.config = resolveWatchdogConfig(config);
  }

  private today(): string {
    return this.deps.today ? this.deps.today() : todayLocal();
  }

  // The reading-side signal, guarded: absent dep, an empty result, or a thrown
  // error all resolve to "" so triage simply omits the context section.
  private async readerContext(): Promise<string> {
    if (!this.deps.loadReaderContext) return "";
    try {
      return (await this.deps.loadReaderContext()) || "";
    } catch {
      return "";
    }
  }

  // Housekeeping before a generation, guarded: it only ever removes days other
  // than today, and a failure must not cost the reader a briefing. Not called
  // from retriage, which reads today's item snapshot.
  private async prune(): Promise<void> {
    if (!this.deps.pruneStaleDays) return;
    try {
      await this.deps.pruneStaleDays(this.today());
    } catch {
      // Leave the old files; they cost disk, not correctness.
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): InfoSnapshot {
    return this.snap;
  }

  private notify(): void {
    this.snap = {
      briefing: this.briefing,
      running: this.running,
      stopping: this.stopping,
      phase: this.phase,
      collect: this.collect,
      activity: this.activity,
      error: this.error,
    };
    for (const fn of this.listeners) fn();
  }

  private bumpActivity(chars: number): void {
    if (!this.activity) return;
    this.activity = { ...this.activity, chars };
    const now = this.deps.now();
    if (now - this.lastActivityNotify >= ACTIVITY_NOTIFY_MS) {
      this.lastActivityNotify = now;
      this.notify();
    }
  }

  // The run changed: republish the derived progress and mark the checkpoint
  // owed. Every caller follows with persist(); flush() covers whatever a caller
  // could not.
  private touch(): void {
    this.dirty = true;
    this.collect = this.run ? collectProgress(this.run) : null;
    this.notify();
  }

  // Writes are chained, not just awaited: sources settle concurrently, so two
  // checkpoints can be in flight at once and the one that must survive is the
  // later state, not whichever write happens to land last.
  private persist(): Promise<void> {
    if (!this.run || !this.dirty) return this.writing;
    this.dirty = false;
    const state = this.run;
    this.writing = this.writing
      .then(() => this.deps.saveRun(state))
      .catch((e) => {
        this.dirty = true;
        console.warn("failed to persist the briefing run", e);
      });
    return this.writing;
  }

  // Going to the background (docs/22): write what the run has and nothing else.
  // iOS gives a backgrounded webview seconds before it may be suspended, so this
  // may not start network or AI work. On a healthy run it writes nothing at all
  // — every source is checkpointed as it settles, so there is normally nothing
  // outstanding; this is here for the one write that failed and for whatever
  // stage is added later without its own checkpoint.
  flush(): Promise<void> {
    return this.persist();
  }

  // Opening the app is the trigger (docs/35): there is no Generate button any
  // more. Load today's briefing so the launch screen reflects it, then either
  // pick up a run the app was killed in the middle of, or — the day's first open
  // with nothing to show — collect today's briefing out of the pool.
  //
  // Called again every time the app comes back to the front, which is also how
  // the day rolling over while the app sat open is noticed. It is cheap when
  // there is nothing to do: a briefing already on disk for today answers it.
  //
  // Resolves only when the run it starts does; callers fire and forget it.
  async init(): Promise<void> {
    if (this.running) return;
    const date = this.today();
    // Reloaded whenever what is held is not today's — the app may have been open
    // across midnight, in which case what is held is yesterday's.
    if (this.briefing?.date !== date) {
      this.briefing = await this.deps.loadBriefing(date);
      this.notify();
    }
    let state: InfoRunState | null = null;
    try {
      state = await this.deps.loadRun(date);
    } catch {
      return;
    }
    const action = startupAction({ briefing: this.briefing, run: state, today: date });
    if (action === "none") return;
    // A run cut off mid-flight is finished without asking: the reader asked for
    // it and never got an answer. A first briefing of the day is only started
    // when there is something to make it out of and something to make it with.
    if (action === "generate" && !(await this.canAutoGenerate())) return;
    // Through launch, not runRun: the guard at the top of this method was read
    // several awaits ago, and a generate the user asked for in the meantime must
    // not end up with two runs writing the same checkpoint.
    await this.launch(() => this.runRun({ retryFailed: false })).done;
  }

  // One run at a time, and the caller is told which of the two it got. Not async
  // on purpose: whoever starts a run has to draw something now, and "one was
  // already going" is not an answer a promise that resolves when the run ends
  // can give in time.
  private launch(run: () => Promise<void>): RunHandle {
    if (this.running) return { start: "busy", done: this.current };
    this.current = run();
    return { start: "started", done: this.current };
  }

  private async canAutoGenerate(): Promise<boolean> {
    if (!this.deps.canAutoGenerate) return false;
    try {
      return await this.deps.canAutoGenerate();
    } catch {
      return false;
    }
  }

  // Publish the intent before acting on it: aborting is the slow part (a fetch
  // has to unwind, the run has to be parked), and the user is owed an answer to
  // the press itself.
  stop(): void {
    if (!this.running || this.stopping) return;
    this.stopping = true;
    this.notify();
    this.stopController?.abort();
  }

  // Collect, triage, and save. A second call while running is a no-op. There is
  // no button behind this any more (docs/35): the day's first briefing comes
  // from init, and a regenerate comes from the companion's generate_briefing.
  //
  // A regenerate is a refresh, not a second briefing. It polls every source, and
  // the pool hands back today's items alongside whatever has come in since, so
  // the triage that follows produces one briefing for the day with the new
  // material merged into it.
  //
  // It is also the resume the user asks for by hand: an unfinished run for today
  // is continued, not restarted, so asking again after a failed triage (a bad
  // key, no network) costs one AI call and no refetching.
  //
  // A second call while one is going is refused, and the refusal is the return
  // value: it used to be a bare `return`, which reads to the caller exactly like
  // a start — the chat drew a progress card for a run that never began and
  // nothing was ever going to update it.
  generate(): RunHandle {
    return this.launch(() => this.runRun({ retryFailed: true }));
  }

  private async runRun(opts: { retryFailed: boolean }): Promise<void> {
    this.running = true;
    // Everything after the flag is inside the try: a throw between setting it
    // and the try — a listener of notify(), a keepAwake that is not there —
    // would otherwise leave `running` true for the life of the app, and every
    // start after it refused.
    try {
      this.byHand = opts.retryFailed;
      this.stopping = false;
      this.error = null;
      this.phase = "discovering";
      this.collect = null;
      this.activity = null;
      this.stopController = new AbortController();
      this.deps.keepAwake?.(true);
      this.notify();
      const date = this.today();
      await this.prune();
      await this.startOrContinue(date, opts.retryFailed);
      await this.discoverPhase();
      await this.screenPhase();
      await this.materialPhase();
      await this.triagePhase(date);
    } catch (e) {
      const stopped = e instanceof StoppedError;
      this.error = stopped ? null : e instanceof Error ? e.message : String(e);
      // Park the run: it keeps every source it collected, and the next Generate
      // continues from there instead of paying for the fetching twice.
      if (this.run) {
        this.run = {
          ...this.run,
          updatedAt: this.deps.now(),
          halt: stopped ? { kind: "stopped" } : { kind: "failed", error: this.error ?? undefined },
        };
        this.dirty = true;
        await this.persist();
      }
    } finally {
      this.running = false;
      this.stopping = false;
      this.phase = "idle";
      this.collect = null;
      this.activity = null;
      this.stopController = null;
      this.run = null;
      this.deps.keepAwake?.(false);
      this.notify();
    }
  }

  // Start today's run, or adopt the checkpoint of one that did not finish. The
  // source list is reconciled either way (syncSources), so a source subscribed
  // to since the run started is collected and one unsubscribed from is dropped.
  private async startOrContinue(date: string, retryFailed: boolean): Promise<void> {
    const sources = await this.deps.listSources();
    let prior: InfoRunState | null = null;
    try {
      prior = await this.deps.loadRun(date);
    } catch {
      prior = null;
    }
    if (prior && prior.date === date) {
      // A hand-driven Generate gives the sources that failed another go: the
      // reason they failed (offline, a host down) is usually the reason the
      // reader is asking again. A startup resume does not — it only picks up
      // what was never attempted.
      const adopted = retryFailed
        ? retryFailedSources(syncSources(prior, sources))
        : syncSources(prior, sources);
      // A run that got past discovery steps back to it when it turns out to owe
      // a source after all — one that just failed and is being retried, or one
      // subscribed to since. The selection goes with it: items arriving late
      // have to be screened alongside the rest, and the ceiling has to be
      // applied to the day as a whole. The verdicts and the bodies already paid
      // for are kept, so stepping back costs only the source that is owed.
      const owed = pendingSources(adopted).length > 0;
      this.run = owed
        ? { ...adopted, phase: "discovering", selection: undefined, halt: undefined }
        : { ...adopted, halt: undefined };
    } else {
      this.run = createRunState(date, this.deps.now(), sources);
    }
    this.phase = this.run.phase;
    this.touch();
    await this.persist();
  }

  // A phase the run is already past. Phases only ever move forward within a run,
  // so a resumed one skips straight to where it stopped.
  private past(phase: InfoRunPhase): boolean {
    return PHASE_RANK[this.run!.phase] > PHASE_RANK[phase];
  }

  // Enter a phase: publish it and start its clock.
  private enter(phase: InfoRunPhase): number {
    this.phase = phase;
    this.notify();
    return this.deps.now();
  }

  private logPhase(phase: InfoRunPhase, startedAt: number, data: Record<string, number>): void {
    this.deps.logPhase?.(phase, { ms: Math.round(this.deps.now() - startedAt), ...data });
  }

  // Move the run to the next phase and checkpoint it there.
  private async advance(state: InfoRunState): Promise<void> {
    this.run = state;
    this.touch();
    await this.persist();
  }

  // Discovery: ask every source the run still owes for its item list — one
  // request per source, no article pages — checkpointing each as it settles,
  // then take the rest of the day out of the pool.
  private async discoverPhase(): Promise<void> {
    if (this.past("discovering")) return;
    const startedAt = this.enter("discovering");
    const pending = pendingSources(this.run!);
    if (pending.length > 0) {
      await this.deps.discover(
        pending,
        async (result) => {
          this.run = applySourceResult(this.run!, result, this.deps.now());
          this.touch();
          await this.persist();
        },
        this.stopController!.signal,
        { force: this.byHand },
      );
    }
    if (this.stopController!.signal.aborted) throw new StoppedError();
    const own = this.run!.items.length;
    await this.seedFromPool();
    if (this.run!.items.length === 0) {
      throw new Error("No articles could be fetched from any source.");
    }
    this.logPhase("discovering", startedAt, {
      sources: this.run!.sources.length,
      items: this.run!.items.length,
      // What the pool contributed on top of this run's own requests: on a device
      // that has been collecting in the background, most of the day.
      pooled: this.run!.items.length - own,
    });
    await this.advance({ ...this.run!, phase: "screening", updatedAt: this.deps.now() });
  }

  // Take the day's candidates out of the pool (docs/35), with the verdicts and
  // bodies already paid for. Guarded: a pool that will not load leaves the run
  // with exactly what it just discovered itself, which is what a run was before
  // the pool existed.
  private async seedFromPool(): Promise<void> {
    if (!this.deps.poolDraw) return;
    let seed: RunSeed;
    try {
      seed = await this.deps.poolDraw(this.run!.date);
    } catch (e) {
      console.warn("could not draw from the item pool", e);
      return;
    }
    this.run = seedRun(this.run!, seed, this.deps.now());
    this.touch();
    await this.persist();
  }

  // Hand back to the pool what this run has settled. Called at the end of
  // screening (so a crash before triage does not cost the verdicts) and again
  // when the briefing lands (bodies and deliveries). Guarded for the same reason
  // the draw is: the pool is a saving, not a dependency.
  private async recordToPool(record: PoolRecord): Promise<void> {
    if (!this.deps.poolRecord || !this.run) return;
    try {
      await this.deps.poolRecord(this.run.date, record);
    } catch (e) {
      console.warn("could not record the run into the item pool", e);
    }
  }

  // Screening: batches of headlines, a few calls at a time, each batch
  // checkpointed as it lands so a Stop or a crash never buys the same verdicts
  // twice. A batch that fails after its watchdog retries fails the run rather
  // than guessing on the reader's behalf — the batches that landed are kept, so
  // the next Generate pays only for the rest.
  private async screenPhase(): Promise<void> {
    if (this.past("screening")) return;
    const startedAt = this.enter("screening");
    const owed = unscreenedItems(this.run!);
    const batches = screenBatches(owed, SCREEN_BATCH_SIZE);
    if (batches.length > 0) {
      const profile = await this.deps.loadProfile();
      const signal = this.stopController!.signal;
      const results = await mapSettled(
        batches,
        async (batch) => {
          const ids = batch.map((it) => it.id);
          const verdicts = await runWithWatchdog(
            (opts) => this.deps.screen({ profile, items: batch }, opts),
            this.config,
            { now: this.deps.now, sleep: this.deps.sleep, setTimer: this.deps.setTimer },
            { onAttempt: () => {}, onProgress: () => {} },
            signal,
          );
          this.run = applyVerdicts(this.run!, ids, verdicts, this.deps.now());
          this.touch();
          await this.persist();
        },
        { limit: SCREEN_CONCURRENCY, signal },
      );
      for (const r of results) {
        if (r.ok) continue;
        if (signal.aborted || r.error instanceof StoppedError || isAbortError(r.error)) {
          throw new StoppedError();
        }
        throw r.error;
      }
    }
    if (this.stopController!.signal.aborted) throw new StoppedError();
    const screened = finishScreening(this.run!, SCREEN_MAX_KEEP, this.deps.now());
    const cappedOut = screened.selection!.cappedOut;
    if (cappedOut > 0) {
      // Never a silent trim: the log, the progress line and the briefing all
      // carry it, so a day that lost items to the ceiling says so.
      console.warn(
        `briefing screen kept ${screened.selection!.ids.length} items and cut ${cappedOut} more at the ${SCREEN_MAX_KEEP} cap`,
      );
    }
    this.logPhase("screening", startedAt, {
      items: this.run!.items.length,
      batches: batches.length,
      kept: screened.selection!.ids.length,
      dropped: this.run!.items.length - screened.selection!.ids.length,
      cappedOut,
    });
    await this.recordToPool({ verdicts: this.run!.verdicts });
    await this.advance(screened);
  }

  // Material: article bodies, for the survivors only. Checkpointed in small
  // batches — one write per body would cost more than the fetches it protects.
  private async materialPhase(): Promise<void> {
    if (this.past("fetching")) return;
    const startedAt = this.enter("fetching");
    const owed = pendingBodies(this.run!);
    if (owed.length > 0) {
      let sinceWrite = 0;
      await this.deps.fetchBodies(
        owed,
        async (item) => {
          this.run = applyBody(this.run!, item, this.deps.now());
          this.touch();
          if (++sinceWrite >= BODY_CHECKPOINT_EVERY) {
            sinceWrite = 0;
            await this.persist();
          }
        },
        this.stopController!.signal,
      );
      await this.persist();
    }
    if (this.stopController!.signal.aborted) throw new StoppedError();
    this.logPhase("fetching", startedAt, {
      items: this.run!.selection?.ids.length ?? 0,
      fetched: this.run!.material.length,
    });
    await this.advance({ ...this.run!, phase: "triaging", updatedAt: this.deps.now() });
  }

  // The one AI call, then the day's files. The checkpoint goes last: until the
  // briefing is on disk the run is still worth resuming.
  private async triagePhase(date: string): Promise<void> {
    this.phase = "triaging";
    this.notify();
    // Only what screening kept, with bodies: the screened-out items were never
    // fetched, so they have nothing for triage to read. They survive in the
    // briefing as a count and a list of ids (screenSummary).
    const items = selectedItems(this.run!);
    const screen = screenSummary(this.run!);
    const [profile, feedback, readerContext] = await Promise.all([
      this.deps.loadProfile(),
      this.deps.loadFeedback(),
      this.readerContext(),
    ]);
    const briefing = await this.triageToBriefing(
      items,
      profile,
      feedback,
      readerContext,
      date,
      screen,
    );
    await this.deps.saveArticles(date, articleCache(items));
    await this.deps.saveItems(date, items);
    await this.deps.saveBriefing(briefing);
    // Before the checkpoint goes: every item this briefing carried is delivered,
    // so a run tomorrow leaves it alone, and every body it fetched is on disk,
    // so a refresh later today reads it instead of fetching it again.
    await this.recordToPool({
      verdicts: this.run!.verdicts,
      bodies: this.run!.material,
      briefed: items.map((it) => it.id),
    });
    this.briefing = briefing;
    this.run = null;
    this.dirty = false;
    await this.deps.clearRun(date);
  }

  // Re-triage today's cached items with the current profile — no re-collection.
  // Used after the user applies a profile change (docs/16): one triage call over
  // the saved item snapshot, reusing the same running/phase/activity machinery so
  // the briefing page and the chat progress card stay in step. A second call
  // while running is refused the same way generate is, and says so. It does not
  // touch the run checkpoint: the snapshot it reads is only ever written by a
  // run that finished.
  retriage(): RunHandle {
    return this.launch(() => this.runRetriage());
  }

  private async runRetriage(): Promise<void> {
    this.running = true;
    try {
      this.stopping = false;
      this.error = null;
      this.phase = "triaging";
      this.activity = null;
      this.collect = null;
      this.stopController = new AbortController();
      this.deps.keepAwake?.(true);
      this.notify();
      const date = this.today();
      const items = await this.deps.loadItems(date);
      if (items.length === 0) {
        throw new Error("No cached items to re-triage. Generate a briefing first.");
      }
      if (this.stopController.signal.aborted) throw new StoppedError();
      // Surface the item total so the progress card reads "triaging N items".
      this.collect = emptyProgress(items.length);
      this.notify();
      const [profile, feedback, readerContext] = await Promise.all([
        this.deps.loadProfile(),
        this.deps.loadFeedback(),
        this.readerContext(),
      ]);
      // The screen's tally belongs to the day, not to the triage call, so a
      // re-triage carries the one the collecting run wrote rather than dropping
      // it — otherwise the companion would read the new briefing as the whole
      // day when most of it was screened out hours ago.
      const screen = this.briefing?.date === date ? this.briefing.screen : undefined;
      const briefing = await this.triageToBriefing(
        items,
        profile,
        feedback,
        readerContext,
        date,
        screen,
      );
      await this.deps.saveBriefing(briefing);
      this.briefing = briefing;
    } catch (e) {
      if (e instanceof StoppedError) this.error = null;
      else this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.running = false;
      this.stopping = false;
      this.phase = "idle";
      this.collect = null;
      this.activity = null;
      this.stopController = null;
      this.deps.keepAwake?.(false);
      this.notify();
    }
  }

  // The one triage call under the watchdog, folded into a Briefing. Shared by
  // generate (after collection) and retriage (over the cached snapshot). Streams
  // activity for the progress card; keeps only references to items we hold.
  private async triageToBriefing(
    items: InfoItem[],
    profile: string,
    feedback: FeedbackEvent[],
    readerContext: string,
    date: string,
    screen?: ScreenSummary,
  ): Promise<Briefing> {
    const validIds = new Set(items.map((it) => it.id));
    const result = await runWithWatchdog(
      (opts) => this.deps.triage({ profile, feedback, items, readerContext }, opts),
      this.config,
      { now: this.deps.now, sleep: this.deps.sleep, setTimer: this.deps.setTimer },
      {
        onAttempt: ({ attempt, attempts, startedAt }) => {
          this.activity = { startedAt, chars: 0, attempt, attempts };
          this.lastActivityNotify = this.deps.now();
          this.notify();
        },
        onProgress: (chars) => this.bumpActivity(chars),
      },
      this.stopController!.signal,
    );
    return {
      date,
      generatedAt: this.deps.now(),
      overview: result.overview,
      mustRead: result.mustRead.filter((r) => validIds.has(r.itemId)),
      oneLiners: result.oneLiners.filter((r) => validIds.has(r.itemId)),
      outOfLane: result.outOfLane.filter((r) => validIds.has(r.itemId)),
      filtered: result.filtered.filter((r) => validIds.has(r.itemId)),
      items: itemsMeta(items),
      ...(screen ? { screen } : {}),
    };
  }
}

// What the screen did, for the briefing to carry (docs/35). Counts plus the ids
// it dropped and nothing more: the companion can be asked about them, and they
// can never fill its context the way the triage-level filtered list does.
function screenSummary(state: InfoRunState): ScreenSummary {
  const keptIds = new Set(state.selection?.ids ?? []);
  const droppedIds = state.items.map((it) => it.id).filter((id) => !keptIds.has(id));
  return {
    discovered: state.items.length,
    kept: keptIds.size,
    dropped: droppedIds.length,
    cappedOut: state.selection?.cappedOut ?? 0,
    droppedIds,
  };
}
