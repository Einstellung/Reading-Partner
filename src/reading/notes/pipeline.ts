// The chapter-spine orchestrator (docs/09): plan the chapter table -> write every
// chapter's spine, several at a time -> connect them into the chapter graph.
// Resumable from persisted state, stoppable mid-run. All IO and AI calls come in
// as injected deps so the whole state machine runs in bun tests with fakes;
// live.ts provides the real deps (Tauri fs, pi-ai). Structurally the unattended
// sibling of the prep pipeline; the stall watchdog and the pacing limiter are the
// shared src/ai ones.
//
// Two passes, because the two halves of a chapter's place in a book become
// knowable at different times. What a chapter builds on is written in the
// chapter itself, so pass one can read it off the pages; what later chapters take
// from it is not written anywhere, so pass two reads all the spines at once and
// connects them.
//
// Pass one is parallel. Chapter calls take only a chapter and the chapter table,
// share nothing, and write to separate files, so running them one after another
// bought nothing but an hour of waiting. What running them together does cost is
// paced by the shared limiter rather than by a fixed worker count: starts are
// staggered, and a provider pushing back slows the whole group instead of sending
// one call straight back into the same minute (src/ai/limiter).
//
// (The prep pipeline stays serial on purpose: it re-picks the next paper after
// each one finishes so the queue follows the reader's chapter. Whole-book spines
// have no such order to follow.)

import { runWithWatchdog, StoppedError, type AiCallOptions, type WatchdogConfig } from "../../ai/watchdog";
import { CallLimiter, type LimiterConfig } from "../../ai/limiter";
import { ObservableRun, type RunActivity, type RunSnapshot } from "../../ai/observable-run";
import { createNotesState, normalizeNotesOnLoad, type BookChapter, type NoteChapter, type NotesState } from "./types";

export type { AiCallOptions };

// The stall watchdog's settings plus the limiter's: how many chapter calls may be
// in flight and how far apart they start.
export interface PipelineConfig extends WatchdogConfig {
  limit: number;
  rampMs: number;
}

export interface PlanOutcome {
  chapters: NoteChapter[];
  source: "outline" | "ai";
}

export interface ChapterGenInput {
  chapter: NoteChapter;
  // The whole chapter table. Chapters are written in parallel, so a chapter never
  // sees the spines written before it; the table is how "builds on" still names
  // real chapters by the numbers the rest of the app uses.
  chapters: BookChapter[];
  // A one-line steer for a regenerate; absent for the first generation.
  instruction?: string;
}

export interface NotesDeps {
  loadState(bookId: string): Promise<NotesState | null>;
  saveState(state: NotesState): Promise<void>;
  buildPlan(opts: AiCallOptions): Promise<PlanOutcome>;
  generateChapter(input: ChapterGenInput, opts: AiCallOptions): Promise<string>;
  writeChapter(index: number, body: string): Promise<void>;
  readChapterNote(index: number): Promise<string | null>;
  buildOverview(
    chapters: { index: number; title: string; body: string }[],
    opts: AiCallOptions,
  ): Promise<string>;
  writeOverview(body: string): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(ms: number, cb: () => void): () => void;
}

// Runtime-only liveness of an in-flight long AI call. Never persisted — it exists
// only while a plan/chapter/graph call streams, exposed through the snapshot so
// the panel can show a live counter. With several chapters in flight the snapshot
// carries the one that started earliest; which chapters are running is in the
// state's per-chapter statuses, where the panel already reads it.
export interface NotesActivity {
  kind: "plan" | "chapter" | "overview";
  // The chapter index for a "chapter" activity.
  chapter?: number;
  startedAt: number;
  chars: number;
  attempt: number;
  attempts: number;
}

export type NotesSnapshot = RunSnapshot<NotesState | null, NotesActivity>;

// How often the published activity may be refreshed by streamed progress. Six
// streams at once would otherwise copy the whole state per delta.
const ACTIVITY_PUBLISH_MS = 250;

function toBookChapter(c: NoteChapter): BookChapter {
  return { index: c.index, title: c.title, startPage: c.startPage, endPage: c.endPage };
}

export class NotesPipeline extends ObservableRun<NotesState | null, NotesActivity> {
  private stopFlag = false;
  // One-line steers for a pending regenerate, keyed by chapter index (not
  // persisted — a steer only applies to the run it was requested for).
  private instructions = new Map<number, string>();
  // When set, only these chapter indexes run (a single-chapter retry or
  // regenerate). Null is the whole-book run: every pending chapter. Every run
  // entry sets it, so a stale value never leaks into the next run.
  private targets: Set<number> | null = null;
  // The in-flight calls' liveness, keyed by call. The snapshot shows one of them;
  // this is what decides which.
  private readonly live = new Map<string, NotesActivity>();
  private lastPublish = 0;
  private readonly limiter: CallLimiter;

  constructor(
    private readonly bookId: string,
    private readonly bookName: string,
    private readonly deps: NotesDeps,
    config: Partial<PipelineConfig> = {},
  ) {
    super(null, deps, config);
    const limiter: Partial<LimiterConfig> = {};
    if (config.limit !== undefined) limiter.limit = config.limit;
    if (config.rampMs !== undefined) limiter.rampMs = config.rampMs;
    this.limiter = new CallLimiter(limiter, deps);
  }

  protected copyState(state: NotesState | null): NotesState | null {
    return state ? { ...state, chapters: state.chapters.map((c) => ({ ...c })) } : null;
  }

  // --- state file writes ---
  //
  // Chapters run at once and every status change rewrites the whole state file,
  // so the writes have to be queued: two in flight would race to write the same
  // path, and the loser's chapter would come back "pending" after a restart even
  // though its spine is on disk. Chapter spines need no such care — they are one
  // file each.
  //
  // Coalescing is the other half: a run with a dozen chapters produces bursts of
  // changes, and the write that is already queued will carry all of them, because
  // the state object is mutated in place and serialized when the write runs.
  private writing = false;
  private dirty = false;
  private writeWaiters: (() => void)[] = [];

  private persist(): Promise<void> {
    this.notify();
    this.dirty = true;
    const done = new Promise<void>((resolve) => this.writeWaiters.push(resolve));
    void this.drainWrites();
    return done;
  }

  private async drainWrites(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        const waiters = this.writeWaiters;
        this.writeWaiters = [];
        try {
          if (this.state) await this.deps.saveState(this.state);
        } catch (e) {
          console.warn("failed to persist notes state", e);
        }
        for (const w of waiters) w();
      }
    } finally {
      this.writing = false;
    }
  }

  // --- liveness ---

  // Publish the earliest-started in-flight call as the snapshot's activity.
  // Throttled for progress; immediate when a call starts or ends.
  private publish(immediate: boolean): void {
    if (!immediate) {
      const now = this.deps.now();
      if (now - this.lastPublish < ACTIVITY_PUBLISH_MS) return;
    }
    this.lastPublish = this.deps.now();
    let earliest: NotesActivity | null = null;
    for (const a of this.live.values()) {
      if (!earliest || a.startedAt < earliest.startedAt) earliest = a;
    }
    this.setActivity(earliest);
  }

  // One long AI call under the stall watchdog, tracked as its own liveness entry
  // so parallel calls do not overwrite each other's counter. A retry waits out
  // whatever pause the limiter is holding, so a rate limit slows the group rather
  // than being answered by this one call alone.
  private async callTracked<T>(
    key: string,
    info: Omit<NotesActivity, keyof RunActivity>,
    invoke: (opts: AiCallOptions) => Promise<T>,
  ): Promise<T> {
    try {
      return await runWithWatchdog(
        invoke,
        this.config,
        this.deps,
        {
          onAttempt: ({ attempt, attempts, startedAt }) => {
            this.live.set(key, { ...info, startedAt, chars: 0, attempt, attempts });
            this.publish(true);
          },
          onProgress: (chars) => {
            const a = this.live.get(key);
            if (!a) return;
            this.live.set(key, { ...a, chars });
            this.publish(false);
          },
          beforeRetry: async (err) => {
            this.limiter.noteFailure(err);
            await this.limiter.hold(this.stopController?.signal ?? undefined);
          },
        },
        this.stopController?.signal,
      );
    } finally {
      this.live.delete(key);
      this.publish(true);
    }
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.state) return;
    const loaded = await this.deps.loadState(this.bookId);
    this.state = loaded
      ? normalizeNotesOnLoad(loaded)
      : createNotesState(this.bookId, this.bookName, this.deps.now());
    this.notify();
  }

  // Idempotent entry point: load (or create) the state and prepare the whole book
  // — every chapter in the table, whether or not the reader has reached it, because
  // the questions the spine answers ("should I start at chapter 3?") are about the
  // chapters they have not read. Callers that don't want to wait fire-and-forget
  // it; a second call while a run is active is a no-op. This is the Generate
  // button, the resume, and the mark-driven start alike.
  async ensureStarted(): Promise<void> {
    this.targets = null;
    if (!this.state) await this.loadIfNeeded();
    await this.run();
  }

  // Stop the current run: abort the in-flight AI calls and drop the ones still
  // queued. Anything in flight is left "pending" so a later resume re-runs it,
  // not failed.
  stop(): void {
    if (!this.running) return;
    this.stopFlag = true;
    this.stopController?.abort();
  }

  // Re-run a failed plan (no-op while running). The idle run picks it up because
  // planStatus is not "done".
  retryPlan(): void {
    if (this.running || !this.state) return;
    if (this.state.planStatus === "done") return;
    void this.ensureStarted();
  }

  // Runs the loop without disturbing targets — for the single-chapter entries
  // that set their own target set first.
  private async kick(): Promise<void> {
    if (!this.state) await this.loadIfNeeded();
    await this.run();
  }

  // Re-run a failed chapter (no-op while running). Only that chapter runs.
  retryChapter(index: number): void {
    if (this.running || !this.state) return;
    const ch = this.state.chapters.find((c) => c.index === index);
    if (!ch || ch.status !== "failed") return;
    ch.status = "pending";
    ch.error = undefined;
    this.targets = new Set([index]);
    void this.persist();
    void this.kick();
  }

  // Generate one chapter on demand (the panel's per-chapter affordance, and the
  // way back for a chapter left pending by a stop). No-op while running.
  generateChapter(index: number): void {
    if (this.running || !this.state) return;
    const ch = this.state.chapters.find((c) => c.index === index);
    if (!ch || (ch.status !== "skipped" && ch.status !== "pending")) return;
    ch.status = "pending";
    ch.error = undefined;
    this.targets = new Set([index]);
    void this.persist();
    void this.kick();
  }

  // Regenerate one chapter, optionally steered by a one-line instruction. Marks
  // the chapter graph stale (it is not regenerated automatically — the panel
  // offers a button). No-op while running. Only that chapter runs.
  regenerateChapter(index: number, instruction?: string): void {
    if (this.running || !this.state) return;
    const ch = this.state.chapters.find((c) => c.index === index);
    if (!ch) return;
    ch.status = "pending";
    ch.error = undefined;
    const steer = instruction?.trim();
    if (steer) this.instructions.set(index, steer);
    else this.instructions.delete(index);
    if (this.state.overviewStatus === "done") this.state.overviewStatus = "stale";
    this.targets = new Set([index]);
    void this.persist();
    void this.kick();
  }

  // Every chapter has a spine, so the graph can be drawn. Under whole-book
  // preparation there is no chapter the pass is allowed to leave out: an edge
  // missing because a chapter was never written reads exactly like a chapter
  // nothing depends on.
  private allChaptersSettled(s: NotesState): boolean {
    return s.chapters.length > 0 && s.chapters.every((c) => c.status === "done");
  }

  // The graph is due when the chapters are settled and it isn't already done,
  // stale, or in flight.
  private overviewDue(): boolean {
    if (!this.state) return false;
    if (this.state.overviewStatus === "done" || this.state.overviewStatus === "stale") return false;
    return this.allChaptersSettled(this.state);
  }

  // Regenerate the chapter graph (e.g. after a chapter was regenerated). No-op
  // while running or before the chapters are settled.
  regenerateOverview(): void {
    if (this.running || !this.state) return;
    if (!this.allChaptersSettled(this.state)) return;
    this.state.overviewStatus = "pending";
    this.state.overviewError = undefined;
    this.targets = new Set();
    void this.persist();
    void this.kick();
  }

  private async run(mode: "full" | "plan-only" = "full"): Promise<void> {
    if (this.running || !this.state) return;
    this.running = true;
    this.stopFlag = false;
    this.stopController = new AbortController();
    this.notify();
    try {
      await this.runPlan();
      if (mode === "plan-only") return;
      if (this.state.planStatus === "done" && !this.stopFlag) {
        await this.runChapters();
        await this.runOverviewIfReady();
      }
    } finally {
      this.running = false;
      this.stopController = null;
      this.notify();
    }
  }

  private async runPlan(): Promise<void> {
    const s = this.state!;
    if (s.planStatus === "done") return;
    s.planStatus = "running";
    s.planError = undefined;
    await this.persist();
    try {
      const plan = await this.limiter.run(
        () => this.callTracked("plan", { kind: "plan" }, (opts) => this.deps.buildPlan(opts)),
        this.stopController?.signal ?? undefined,
      );
      s.chapters = plan.chapters;
      s.planSource = plan.source;
      s.planStatus = "done";
    } catch (e) {
      if (e instanceof StoppedError) {
        s.planStatus = "pending";
        await this.persist();
        return;
      }
      s.planStatus = "failed";
      s.planError = e instanceof Error ? e.message : String(e);
    }
    await this.persist();
  }

  // Pass one: every pending chapter, at once, paced by the limiter. Failed
  // chapters are left for a manual retry; done chapters are never re-run.
  // `targets`, when set, narrows the run to a single chapter.
  private async runChapters(): Promise<void> {
    const s = this.state!;
    const table = s.chapters.map(toBookChapter);
    const due = s.chapters.filter(
      (c) => c.status === "pending" && (!this.targets || this.targets.has(c.index)),
    );
    await Promise.all(due.map((ch) => this.runChapter(ch, table)));
  }

  private async runChapter(ch: NoteChapter, table: BookChapter[]): Promise<void> {
    if (this.stopFlag) return;
    const instruction = this.instructions.get(ch.index);
    try {
      const body = await this.limiter.run(async () => {
        // Checked inside the slot: a chapter that waited its turn while the user
        // pressed Stop must not start now.
        if (this.stopFlag) throw new StoppedError();
        ch.status = "running";
        ch.error = undefined;
        await this.persist();
        return this.callTracked(`chapter-${ch.index}`, { kind: "chapter", chapter: ch.index }, (opts) =>
          this.deps.generateChapter({ chapter: ch, chapters: table, instruction }, opts),
        );
      }, this.stopController?.signal ?? undefined);
      await this.deps.writeChapter(ch.index, body);
      ch.status = "done";
      this.instructions.delete(ch.index);
    } catch (e) {
      if (e instanceof StoppedError) {
        ch.status = "pending";
        await this.persist();
        return;
      }
      ch.status = "failed";
      ch.error = e instanceof Error ? e.message : String(e);
    }
    await this.persist();
  }

  // Pass two: connect the spines into the chapter graph, once every chapter has
  // one, unless it is already done or was marked stale (a stale graph waits for an
  // explicit regenerate).
  private async runOverviewIfReady(): Promise<void> {
    const s = this.state!;
    if (this.stopFlag) return;
    if (!this.overviewDue()) return;
    s.overviewStatus = "running";
    s.overviewError = undefined;
    await this.persist();
    try {
      const inputs: { index: number; title: string; body: string }[] = [];
      for (const c of s.chapters) {
        const body = (await this.deps.readChapterNote(c.index)) ?? "";
        inputs.push({ index: c.index, title: c.title, body });
      }
      const body = await this.limiter.run(
        () =>
          this.callTracked("overview", { kind: "overview" }, (opts) =>
            this.deps.buildOverview(inputs, opts),
          ),
        this.stopController?.signal ?? undefined,
      );
      await this.deps.writeOverview(body);
      s.overviewStatus = "done";
    } catch (e) {
      if (e instanceof StoppedError) {
        s.overviewStatus = "pending";
        await this.persist();
        return;
      }
      s.overviewStatus = "failed";
      s.overviewError = e instanceof Error ? e.message : String(e);
    }
    await this.persist();
  }
}
