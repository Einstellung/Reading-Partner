// The notes pipeline orchestrator (docs/14): plan -> generate each chapter in
// order -> write the whole-book overview, resumable from persisted state and
// stoppable mid-run. All IO and AI calls come in as injected deps so the whole
// state machine runs in bun tests with fakes; live.ts provides the real deps
// (Tauri fs, pi-ai). Structurally the unattended sibling of the prep pipeline;
// the stall watchdog is the shared src/ai/watchdog.

import {
  resolveWatchdogConfig,
  runWithWatchdog,
  StoppedError,
  type AiCallOptions,
  type WatchdogConfig,
} from "../ai/watchdog";
import { createNotesState, normalizeNotesOnLoad, type NoteChapter, type NotesState } from "./types";

export type { AiCallOptions };

// Cap on how often streaming progress re-renders React (~4/s).
const ACTIVITY_NOTIFY_MS = 250;

export type PipelineConfig = WatchdogConfig;

export interface PlanOutcome {
  chapters: NoteChapter[];
  source: "outline" | "ai";
}

export interface ChapterGenInput {
  chapter: NoteChapter;
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

// Runtime-only liveness of the in-flight long AI call. Never persisted — it
// exists only while a plan/chapter/overview streams, exposed through the snapshot
// so the panel can show a live counter.
export interface NotesActivity {
  kind: "plan" | "chapter" | "overview";
  // The chapter index for a "chapter" activity.
  chapter?: number;
  startedAt: number;
  chars: number;
  attempt: number;
  attempts: number;
}

export interface NotesSnapshot {
  state: NotesState | null;
  running: boolean;
  activity: NotesActivity | null;
}

export class NotesPipeline {
  private state: NotesState | null = null;
  private running = false;
  private listeners = new Set<() => void>();
  private snap: NotesSnapshot = { state: null, running: false, activity: null };
  private activity: NotesActivity | null = null;
  private lastActivityNotify = 0;
  private readonly config: PipelineConfig;
  // Aborts the in-flight AI call when the user presses Stop; recreated per run.
  private stopController: AbortController | null = null;
  private stopFlag = false;
  // One-line steers for a pending regenerate, keyed by chapter index (not
  // persisted — a steer only applies to the run it was requested for).
  private instructions = new Map<number, string>();

  constructor(
    private readonly bookId: string,
    private readonly bookName: string,
    private readonly deps: NotesDeps,
    config: Partial<PipelineConfig> = {},
  ) {
    this.config = resolveWatchdogConfig(config);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Stable between notifications so useSyncExternalStore doesn't loop.
  snapshot(): NotesSnapshot {
    return this.snap;
  }

  private notify(): void {
    this.snap = {
      state: this.state
        ? { ...this.state, chapters: this.state.chapters.map((c) => ({ ...c })) }
        : null,
      running: this.running,
      activity: this.activity,
    };
    for (const fn of this.listeners) fn();
  }

  private setActivity(activity: NotesActivity | null): void {
    this.activity = activity;
    this.lastActivityNotify = activity ? this.deps.now() : 0;
    this.notify();
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

  private async callWithWatchdog<T>(
    info: { kind: NotesActivity["kind"]; chapter?: number },
    invoke: (opts: AiCallOptions) => Promise<T>,
  ): Promise<T> {
    try {
      return await runWithWatchdog(
        invoke,
        this.config,
        { now: this.deps.now, sleep: this.deps.sleep, setTimer: this.deps.setTimer },
        {
          onAttempt: ({ attempt, attempts, startedAt }) =>
            this.setActivity({ ...info, startedAt, chars: 0, attempt, attempts }),
          onProgress: (chars) => this.bumpActivity(chars),
        },
        this.stopController?.signal,
      );
    } finally {
      this.setActivity(null);
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    try {
      await this.deps.saveState(this.state);
    } catch (e) {
      console.warn("failed to persist notes state", e);
    }
    this.notify();
  }

  // Idempotent entry point: load (or create) the state and run the loop to
  // completion. Callers that don't want to wait fire-and-forget it; a second call
  // while a run is active is a no-op. This is both first "Generate" and resume.
  async ensureStarted(): Promise<void> {
    if (!this.state) {
      const loaded = await this.deps.loadState(this.bookId);
      this.state = loaded
        ? normalizeNotesOnLoad(loaded)
        : createNotesState(this.bookId, this.bookName, this.deps.now());
      this.notify();
    }
    await this.run();
  }

  // Stop the current run: abort the in-flight AI call and break the loop. The
  // unit in flight is left "pending" so a later resume re-runs it, not failed.
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

  // Re-run a failed chapter (no-op while running).
  retryChapter(index: number): void {
    if (this.running || !this.state) return;
    const ch = this.state.chapters.find((c) => c.index === index);
    if (!ch || ch.status !== "failed") return;
    ch.status = "pending";
    ch.error = undefined;
    void this.persist();
    void this.ensureStarted();
  }

  // Regenerate one chapter, optionally steered by a one-line instruction. Marks
  // the overview stale (it is not regenerated automatically — the panel offers a
  // button). No-op while running.
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
    void this.persist();
    void this.ensureStarted();
  }

  // Regenerate the whole-book overview (e.g. after a chapter was regenerated).
  // No-op while running or before every chapter is done.
  regenerateOverview(): void {
    if (this.running || !this.state) return;
    if (!this.state.chapters.every((c) => c.status === "done") || this.state.chapters.length === 0) {
      return;
    }
    this.state.overviewStatus = "pending";
    this.state.overviewError = undefined;
    void this.persist();
    void this.ensureStarted();
  }

  private async run(): Promise<void> {
    if (this.running || !this.state) return;
    this.running = true;
    this.stopFlag = false;
    this.stopController = new AbortController();
    this.notify();
    try {
      await this.runPlan();
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
      const plan = await this.callWithWatchdog({ kind: "plan" }, (opts) => this.deps.buildPlan(opts));
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

  private async runChapters(): Promise<void> {
    const s = this.state!;
    // One chapter at a time, in reading order. Failed chapters are left for a
    // manual retry; done chapters are never re-run.
    for (const ch of s.chapters) {
      if (this.stopFlag) return;
      if (ch.status === "pending") await this.runChapter(ch);
    }
  }

  private async runChapter(ch: NoteChapter): Promise<void> {
    ch.status = "running";
    ch.error = undefined;
    await this.persist();
    const instruction = this.instructions.get(ch.index);
    try {
      const body = await this.callWithWatchdog({ kind: "chapter", chapter: ch.index }, (opts) =>
        this.deps.generateChapter({ chapter: ch, instruction }, opts),
      );
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

  // Write the overview once every chapter is done, unless it is already done or
  // was marked stale (a stale overview waits for an explicit regenerate).
  private async runOverviewIfReady(): Promise<void> {
    const s = this.state!;
    if (this.stopFlag) return;
    const allDone = s.chapters.length > 0 && s.chapters.every((c) => c.status === "done");
    if (!allDone) return;
    if (s.overviewStatus === "done" || s.overviewStatus === "stale") return;
    s.overviewStatus = "running";
    s.overviewError = undefined;
    await this.persist();
    try {
      const inputs: { index: number; title: string; body: string }[] = [];
      for (const c of s.chapters) {
        const body = (await this.deps.readChapterNote(c.index)) ?? "";
        inputs.push({ index: c.index, title: c.title, body });
      }
      const body = await this.callWithWatchdog({ kind: "overview" }, (opts) =>
        this.deps.buildOverview(inputs, opts),
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
