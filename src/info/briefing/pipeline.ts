// The info-briefing orchestrator (docs/16): collect every source, run one triage
// AI call under the stall watchdog, save the briefing + article cache. Like the
// notes pipeline it is a resumable state machine — the run checkpoint in
// run-state.ts is its state.json — with the same shape besides: injected deps so
// it runs headless in tests, subscribe/snapshot so the vestibule can show
// liveness, stoppable.
//
// Resumable because of where it runs (docs/22): on a phone the collection of a
// dozen sources takes minutes, and the OS may suspend or kill a backgrounded
// webview at any point in them. Fetching is the expensive half of a run — in
// wall clock, in the reader's patience, and in politeness to the sources — so a
// run that is cut off keeps every source it already fetched and the next start
// picks up the rest.

import {
  resolveWatchdogConfig,
  runWithWatchdog,
  StoppedError,
  type AiCallOptions,
  type WatchdogConfig,
} from "../../ai/watchdog";
import type { CachedArticle } from "./store";
import { todayLocal } from "./store";
import {
  applySourceResult,
  collectProgress,
  createRunState,
  isResumable,
  pendingSources,
  retryFailedSources,
  syncSources,
  type CollectProgress,
  type InfoRunState,
  type InfoSourceRef,
  type SourceResult,
} from "./run-state";
import type { FeedbackEvent } from "../../observation/feedback";
import type { Briefing, BriefingItemMeta, TriageResult } from "./types";
import type { InfoItem } from "../sources/item";

export type { AiCallOptions };
export type { CollectProgress, InfoSourceRef, SourceResult };

const ACTIVITY_NOTIFY_MS = 250;

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
  // Fetch the given sources fully (list + per-article bodies). A resumed run
  // passes only what it still owes. `onSettled` is awaited as each source
  // finishes, which is what makes the checkpoint per source rather than per run:
  // the slow ones cannot lose the fast ones' work. Per-source isolation stays in
  // the engine — a failed source arrives here as a result with an error, not as
  // a thrown run.
  //
  // `signal` is the Stop, and it has to reach the fetches: collection is the
  // long half of a run, so a Stop that only took effect at the phase boundary
  // would look like a button that does nothing. A source cut off mid-fetch is
  // not reported, so it stays pending and the resume refetches it; the ones
  // that already settled are kept.
  collect(
    sources: InfoSourceRef[],
    onSettled: (result: SourceResult) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  // The one triage AI call, wrapped by the watchdog. Validates + retries parse
  // internally; throws on a stall/error so the watchdog can retry the attempt.
  triage(
    input: { profile: string; feedback: FeedbackEvent[]; items: InfoItem[]; readerContext?: string },
    opts: AiCallOptions,
  ): Promise<TriageResult>;
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

export type InfoPhase = "idle" | "fetching" | "triaging";

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
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();

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

  // Load today's briefing from disk (if any) so the vestibule reflects it, then
  // pick up a run the app was killed in the middle of. A briefing from a
  // previous day is ignored — only today is ever shown.
  //
  // Resolves only when the resumed run does; callers fire and forget it.
  async init(): Promise<void> {
    if (this.running) return;
    if (!this.briefing) this.briefing = await this.deps.loadBriefing(this.today());
    this.notify();
    await this.resumeIfCutOff();
  }

  // Continue a run that was cut off mid-flight. Deliberately narrow: only
  // today's, and only one that never got the chance to say why it stopped. A run
  // the user stopped, or one that failed, is left parked — it spent the reader's
  // money once already and the next spend should be something they asked for.
  private async resumeIfCutOff(): Promise<void> {
    const date = this.today();
    let state: InfoRunState | null = null;
    try {
      state = await this.deps.loadRun(date);
    } catch {
      return;
    }
    if (!isResumable(state, date)) return;
    await this.runRun({ retryFailed: false });
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

  // Collect, triage, and save. A second call while running is a no-op.
  // Regenerate is the same entry point — it overwrites today's briefing.
  //
  // It is also the resume the user asks for by hand: an unfinished run for today
  // is continued, not restarted, so pressing Generate after a failed triage
  // (a bad key, no network) costs one AI call and no refetching. A run that
  // finished leaves no checkpoint behind, so a regenerate after a completed
  // briefing does fetch everything again, which is what regenerate means.
  async generate(): Promise<void> {
    if (this.running) return;
    await this.runRun({ retryFailed: true });
  }

  private async runRun(opts: { retryFailed: boolean }): Promise<void> {
    this.running = true;
    this.stopping = false;
    this.error = null;
    this.phase = "fetching";
    this.collect = null;
    this.activity = null;
    this.stopController = new AbortController();
    this.deps.keepAwake?.(true);
    this.notify();
    const date = this.today();
    try {
      await this.prune();
      await this.startOrContinue(date, opts.retryFailed);
      await this.collectPhase();
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
      // A run that got as far as triage steps back to collecting when it turns
      // out to owe a source after all — one that just failed and is being
      // retried, or one subscribed to since. Triage reads every item at once,
      // so a source collected late still lands in the same briefing.
      const phase = pendingSources(adopted).length > 0 ? "collecting" : adopted.phase;
      this.run = { ...adopted, phase, halt: undefined };
    } else {
      this.run = createRunState(date, this.deps.now(), sources);
    }
    this.phase = this.run.phase === "triaging" ? "triaging" : "fetching";
    this.touch();
    await this.persist();
  }

  // Fetch every source the run still owes, checkpointing each as it settles. A
  // run resumed into the triage phase skips this entirely.
  private async collectPhase(): Promise<void> {
    const state = this.run!;
    if (state.phase !== "collecting") return;
    const pending = pendingSources(state);
    if (pending.length > 0) {
      await this.deps.collect(
        pending,
        async (result) => {
          this.run = applySourceResult(this.run!, result, this.deps.now());
          this.touch();
          await this.persist();
        },
        this.stopController!.signal,
      );
    }
    if (this.stopController!.signal.aborted) throw new StoppedError();
    if (this.run!.items.length === 0) {
      throw new Error("No articles could be fetched from any source.");
    }
    this.run = { ...this.run!, phase: "triaging", updatedAt: this.deps.now() };
    this.touch();
    await this.persist();
  }

  // The one AI call, then the day's files. The checkpoint goes last: until the
  // briefing is on disk the run is still worth resuming.
  private async triagePhase(date: string): Promise<void> {
    this.phase = "triaging";
    this.notify();
    const items = this.run!.items;
    const [profile, feedback, readerContext] = await Promise.all([
      this.deps.loadProfile(),
      this.deps.loadFeedback(),
      this.readerContext(),
    ]);
    const briefing = await this.triageToBriefing(items, profile, feedback, readerContext, date);
    await this.deps.saveArticles(date, articleCache(items));
    await this.deps.saveItems(date, items);
    await this.deps.saveBriefing(briefing);
    this.briefing = briefing;
    this.run = null;
    this.dirty = false;
    await this.deps.clearRun(date);
  }

  // Re-triage today's cached items with the current profile — no re-collection.
  // Used after the user applies a profile change (docs/16): one triage call over
  // the saved item snapshot, reusing the same running/phase/activity machinery so
  // the briefing page and the chat progress card stay in step. A second call
  // while running is a no-op. It does not touch the run checkpoint: the snapshot
  // it reads is only ever written by a run that finished.
  async retriage(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.error = null;
    this.phase = "triaging";
    this.activity = null;
    this.collect = null;
    this.stopController = new AbortController();
    this.deps.keepAwake?.(true);
    this.notify();
    try {
      const date = this.today();
      const items = await this.deps.loadItems(date);
      if (items.length === 0) {
        throw new Error("No cached items to re-triage. Generate a briefing first.");
      }
      if (this.stopController.signal.aborted) throw new StoppedError();
      // Surface the item total so the progress card reads "triaging N items".
      this.collect = { total: 0, done: 0, failed: 0, items: items.length, lastDone: null };
      this.notify();
      const [profile, feedback, readerContext] = await Promise.all([
        this.deps.loadProfile(),
        this.deps.loadFeedback(),
        this.readerContext(),
      ]);
      const briefing = await this.triageToBriefing(items, profile, feedback, readerContext, date);
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
    };
  }
}
