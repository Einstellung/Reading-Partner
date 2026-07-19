// The slides pipeline orchestrator (docs/14): plan -> per-slide content ->
// per-slot assets -> assemble, for one talk. All IO and AI calls are injected so
// the whole state machine runs in bun tests with fakes; live.ts provides the
// real deps. Structurally the sibling of the notes pipeline: the plan and
// content stages stream and run under the shared stall watchdog
// (src/ai/watchdog); the asset stage calls the image client (no char stream, so
// it carries its own timeout, not the watchdog) and the figure crop path. A run
// is one-shot — no resume across restart in v1; a Stop aborts it.

import {
  resolveWatchdogConfig,
  runWithWatchdog,
  StoppedError,
  type AiCallOptions,
  type WatchdogConfig,
} from "../ai/watchdog";
import type { DeckPlan } from "./plan";
import { slugify } from "./template";
import {
  SLIDES_VERSION,
  type SlideFigureRef,
  type SlideRun,
  type SlidesState,
} from "./types";

export type { AiCallOptions };

const ACTIVITY_NOTIFY_MS = 250;

export type PipelineConfig = WatchdogConfig;

// One assembled slide handed to the assemble stage: its kind, resolved fragment,
// and resolved asset (a data: URL, or null when none / dropped).
export interface AssembleSlide {
  kind: SlideRun["kind"];
  fragment: string;
  asset: string | null;
}

export interface AssembleInput {
  id: string;
  title: string;
  instruction: string;
  bookIds: string[];
  createdAt: number;
  slides: AssembleSlide[];
}

export interface SlidesDeps {
  // One AI call: the deck outline.
  buildPlan(opts: AiCallOptions): Promise<DeckPlan>;
  // One AI call per slide: the slide's sanitized HTML fragment.
  generateContent(slide: SlideRun, opts: AiCallOptions): Promise<string>;
  // The image client for an illustration slot; refImage is the first successful
  // illustration (a data URL) for style consistency. Resolves null when no key
  // is configured (the slot is skipped). Honors opts.signal for abort.
  generateIllustration(
    slide: SlideRun,
    refImage: string | null,
    opts: { signal: AbortSignal },
  ): Promise<string | null>;
  // The in-app figure crop for a figure slot; resolves null when the crop can't
  // be produced (bbox null / render failure) so the slot is dropped silently.
  renderFigureAsset(ref: SlideFigureRef): Promise<string | null>;
  // Write the deck and append the talk registry entry; returns the file path.
  assemble(input: AssembleInput): Promise<string>;
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(ms: number, cb: () => void): () => void;
}

export interface SlidesActivity {
  kind: "plan" | "content" | "assets" | "assemble";
  slide?: number; // 1-based slide index for content/assets
  startedAt: number;
  chars: number;
  attempt: number;
  attempts: number;
}

export interface SlidesSnapshot {
  state: SlidesState | null;
  running: boolean;
  activity: SlidesActivity | null;
}

export interface SlidesInit {
  createdAt: number;
  instruction: string;
  bookIds: string[];
}

export class SlidesPipeline {
  private state: SlidesState;
  private running = false;
  private listeners = new Set<() => void>();
  private snap: SlidesSnapshot;
  private activity: SlidesActivity | null = null;
  private lastActivityNotify = 0;
  private readonly config: PipelineConfig;
  private stopController: AbortController | null = null;
  private stopFlag = false;
  // The generated fragments and resolved assets, kept off the snapshot so a
  // notify never ships base64 through React (notes keeps chapter bodies on disk
  // for the same reason). Keyed by 1-based slide index.
  private fragments = new Map<number, string>();
  private assets = new Map<number, string>();
  // The first illustration that succeeded, reused as a style reference.
  private styleRef: string | null = null;

  constructor(
    private readonly deps: SlidesDeps,
    init: SlidesInit,
    config: Partial<PipelineConfig> = {},
  ) {
    this.config = resolveWatchdogConfig(config);
    this.state = {
      version: SLIDES_VERSION,
      id: `${init.createdAt}`,
      title: "Generating…",
      createdAt: init.createdAt,
      instruction: init.instruction,
      bookIds: init.bookIds,
      runStatus: "idle",
      planStatus: "pending",
      slides: [],
      assembleStatus: "pending",
    };
    this.snap = { state: this.state, running: false, activity: null };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): SlidesSnapshot {
    return this.snap;
  }

  private notify(): void {
    this.snap = {
      state: { ...this.state, slides: this.state.slides.map((s) => ({ ...s })) },
      running: this.running,
      activity: this.activity,
    };
    for (const fn of this.listeners) fn();
  }

  private setActivity(activity: SlidesActivity | null): void {
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
    info: { kind: SlidesActivity["kind"]; slide?: number },
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

  // Start (or, if called again, no-op while running) the one-shot run.
  async start(): Promise<void> {
    if (this.running || this.state.runStatus === "done") return;
    await this.run();
  }

  // Abort the in-flight AI/image call and stop the run.
  stop(): void {
    if (!this.running) return;
    this.stopFlag = true;
    this.stopController?.abort();
  }

  private async run(): Promise<void> {
    this.running = true;
    this.stopFlag = false;
    this.stopController = new AbortController();
    this.state.runStatus = "running";
    this.state.runError = undefined;
    this.notify();
    try {
      if (!(await this.runPlan())) return;
      if (this.stopFlag) return this.markStopped();
      if (!(await this.runContent())) return;
      if (this.stopFlag) return this.markStopped();
      await this.runAssets();
      if (this.stopFlag) return this.markStopped();
      if (!(await this.runAssemble())) return;
      this.state.runStatus = "done";
    } catch (e) {
      if (e instanceof StoppedError) return this.markStopped();
      this.fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.running = false;
      this.stopController = null;
      this.notify();
    }
  }

  private markStopped(): void {
    this.state.runStatus = "stopped";
    this.state.runError = "Stopped.";
  }

  private fail(message: string): void {
    this.state.runStatus = "failed";
    this.state.runError = message;
  }

  private async runPlan(): Promise<boolean> {
    const s = this.state;
    s.planStatus = "running";
    this.notify();
    try {
      const plan = await this.callWithWatchdog({ kind: "plan" }, (opts) => this.deps.buildPlan(opts));
      s.title = plan.title;
      s.id = `${s.createdAt}-${slugify(plan.title)}`;
      s.slides = plan.slides.map((o, i) => ({
        ...o,
        index: i + 1,
        contentStatus: "pending",
        assetStatus: o.illustration || o.figure ? "pending" : undefined,
      }));
      s.planStatus = "done";
      this.notify();
      return true;
    } catch (e) {
      if (e instanceof StoppedError) {
        s.planStatus = "pending";
        this.markStopped();
        return false;
      }
      s.planStatus = "failed";
      s.planError = e instanceof Error ? e.message : String(e);
      this.fail(`Planning failed: ${s.planError}`);
      return false;
    }
  }

  // Content is a hard stage: a slide that fails after the watchdog's retries
  // fails the run (a deck missing a slide body is not shippable).
  private async runContent(): Promise<boolean> {
    for (const slide of this.state.slides) {
      if (this.stopFlag) return false;
      slide.contentStatus = "running";
      this.notify();
      try {
        const fragment = await this.callWithWatchdog(
          { kind: "content", slide: slide.index },
          (opts) => this.deps.generateContent(slide, opts),
        );
        this.fragments.set(slide.index, fragment);
        slide.contentStatus = "done";
        this.notify();
      } catch (e) {
        if (e instanceof StoppedError) {
          slide.contentStatus = "pending";
          this.markStopped();
          return false;
        }
        slide.contentStatus = "failed";
        slide.error = e instanceof Error ? e.message : String(e);
        this.fail(`Slide ${slide.index} content failed: ${slide.error}`);
        return false;
      }
    }
    return true;
  }

  // Assets are best-effort: a skipped illustration (no key) or a dropped figure
  // (null bbox / render fail) leaves the slot empty and the deck still ships. An
  // illustration error is logged and the slot dropped, not run-fatal. Only a Stop
  // aborts the stage.
  private async runAssets(): Promise<void> {
    for (const slide of this.state.slides) {
      if (this.stopFlag) return;
      if (!slide.assetStatus) continue;
      slide.assetStatus = "running";
      this.setActivity({ kind: "assets", slide: slide.index, startedAt: this.deps.now(), chars: 0, attempt: 1, attempts: 1 });
      try {
        let asset: string | null = null;
        if (slide.figure) {
          asset = await this.deps.renderFigureAsset(slide.figure);
        } else if (slide.illustration) {
          asset = await this.deps.generateIllustration(slide, this.styleRef, {
            signal: this.stopController!.signal,
          });
          if (asset && !this.styleRef) this.styleRef = asset;
        }
        if (asset) this.assets.set(slide.index, asset);
        slide.assetStatus = "done";
      } catch (e) {
        if (this.stopFlag || (e instanceof DOMException && e.name === "AbortError")) {
          this.markStopped();
          this.setActivity(null);
          return;
        }
        console.warn(`slide ${slide.index} asset dropped`, e);
        slide.assetStatus = "failed";
      } finally {
        this.setActivity(null);
      }
    }
  }

  private async runAssemble(): Promise<boolean> {
    const s = this.state;
    s.assembleStatus = "running";
    this.setActivity({ kind: "assemble", startedAt: this.deps.now(), chars: 0, attempt: 1, attempts: 1 });
    try {
      const slides: AssembleSlide[] = s.slides.map((slide) => ({
        kind: slide.kind,
        fragment: this.fragments.get(slide.index) ?? "",
        asset: this.assets.get(slide.index) ?? null,
      }));
      const file = await this.deps.assemble({
        id: s.id,
        title: s.title,
        instruction: s.instruction,
        bookIds: s.bookIds,
        createdAt: s.createdAt,
        slides,
      });
      s.outputFile = file;
      s.assembleStatus = "done";
      return true;
    } catch (e) {
      s.assembleStatus = "failed";
      s.assembleError = e instanceof Error ? e.message : String(e);
      this.fail(`Assembling the deck failed: ${s.assembleError}`);
      return false;
    } finally {
      this.setActivity(null);
    }
  }
}
