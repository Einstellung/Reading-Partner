// The slides pipeline orchestrator (docs/14, docs/29): plan -> per-slide content
// -> per-slot assets -> assemble, for one talk. All IO and AI calls are injected
// so the whole state machine runs in bun tests with fakes; live.ts provides the
// real deps. Structurally the sibling of the notes pipeline: the plan and
// content stages stream and run under the shared stall watchdog
// (src/ai/watchdog); the asset stage calls the image client (no char stream, so
// it carries its own timeout, not the watchdog) and the figure crop path.
//
// Everything the run produces goes to disk as it is produced (state.json, one
// file per slide body, one per asset), which buys three things a one-shot
// in-memory run could not have: a talk interrupted halfway resumes where it
// stopped, one page can be re-run without touching the rest, and assembling is
// just reading what is on disk — so it can be repeated at any time.

import { StoppedError, type AiCallOptions, type WatchdogConfig } from "../../ai/watchdog";
import { ObservableRun, type RunSnapshot } from "../../ai/observable-run";
import { overflowNotice } from "./overflow";
import type { DeckPlan } from "./plan";
import {
  createSlidesState,
  normalizeSlidesOnLoad,
  type SlideFigureRef,
  type SlideRun,
  type SlidesInit,
  type SlidesState,
} from "./types";

export type { AiCallOptions };

export type PipelineConfig = WatchdogConfig;

// One assembled slide handed to the assemble stage: its kind, resolved fragment,
// and resolved asset (a data: URL, or null when none was produced).
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

// What one slide's content call produced: the sanitized fragment, plus a note
// about the material it was actually written from when that was not what the
// plan asked for (the fallback to a book overview used to be silent).
export interface ContentOutcome {
  html: string;
  sourceNotice?: string;
}

// What an asset slot produced. `url` null means nothing was produced — `reason`
// says why, and the slot is reported as missing rather than done.
export interface AssetOutcome {
  url: string | null;
  reason?: string;
}

export interface ContentInput {
  slide: SlideRun;
  // A one-line steer for a re-run; absent for the first generation.
  instruction?: string;
}

export interface SlidesDeps {
  // One AI call: the deck outline.
  buildPlan(opts: AiCallOptions): Promise<DeckPlan>;
  // One AI call per slide: the slide's sanitized HTML fragment.
  generateContent(input: ContentInput, opts: AiCallOptions): Promise<ContentOutcome>;
  // The image client for an illustration slot; refImage is the first successful
  // illustration (a data URL) for style consistency. Honors opts.signal for abort.
  generateIllustration(
    slide: SlideRun,
    refImage: string | null,
    opts: { signal: AbortSignal },
  ): Promise<AssetOutcome>;
  // The in-app figure crop for a figure slot.
  renderFigureAsset(ref: SlideFigureRef): Promise<AssetOutcome>;
  // Persist the run state (the resume point).
  saveState(state: SlidesState): Promise<void>;
  // Per-slide body and asset files. writeAsset(index, null) drops the file.
  writeFragment(index: number, html: string): Promise<void>;
  readFragment(index: number): Promise<string | null>;
  writeAsset(index: number, dataUrl: string | null): Promise<void>;
  readAsset(index: number): Promise<string | null>;
  // Write the deck and record the talk; returns the file path.
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

export type SlidesSnapshot = RunSnapshot<SlidesState, SlidesActivity>;

// Which slides a stage covers this run: nothing, everything still pending, or a
// named set (a re-run of one page, which runs whatever its current status).
type Targets = "none" | "all" | ReadonlySet<number>;

interface RunSpec {
  plan: boolean;
  content: Targets;
  assets: Targets;
  assemble: boolean;
}

const FULL_RUN: RunSpec = { plan: true, content: "all", assets: "all", assemble: true };

export class SlidesPipeline extends ObservableRun<SlidesState, SlidesActivity> {
  private stopFlag = false;
  // One-line steers for a pending re-run, keyed by slide index (not persisted —
  // a steer only applies to the run it was requested for).
  private instructions = new Map<number, string>();
  // The first illustration that succeeded, reused as a style reference. Restored
  // from disk on the first asset of a resumed run.
  private styleRef: string | null = null;

  constructor(
    private readonly deps: SlidesDeps,
    state: SlidesState,
    config: Partial<PipelineConfig> = {},
  ) {
    // Whatever was in flight when the app died goes back to pending here, so a
    // resumed talk re-runs the interrupted unit and nothing else.
    super(normalizeSlidesOnLoad(state), deps, config);
  }

  // A pipeline over a talk that does not exist yet.
  static create(
    deps: SlidesDeps,
    init: SlidesInit,
    config: Partial<PipelineConfig> = {},
  ): SlidesPipeline {
    return new SlidesPipeline(deps, createSlidesState(init), config);
  }

  protected copyState(state: SlidesState): SlidesState {
    return { ...state, slides: state.slides.map((s) => ({ ...s })) };
  }

  private async persist(): Promise<void> {
    try {
      await this.deps.saveState(this.state);
    } catch (e) {
      console.warn("failed to persist slides state", e);
    }
    this.notify();
  }

  // Run everything this talk still needs: the plan if it has none, every pending
  // slide body, every pending asset, then the deck. This is both the first run
  // and the resume — a slide that is done is never re-run.
  async start(): Promise<void> {
    if (this.running) return;
    await this.run(FULL_RUN);
  }

  // Abort the in-flight AI/image call and stop the run.
  stop(): void {
    if (!this.running) return;
    this.stopFlag = true;
    this.stopController?.abort();
  }

  // Re-run one slide's body, optionally steered by a one-line instruction (the
  // same affordance as the notes panel's per-chapter Regenerate). The assembled
  // deck is then out of date, so it is marked stale rather than rebuilt silently.
  regenerateSlide(index: number, instruction?: string): void {
    if (this.running) return;
    const slide = this.state.slides.find((s) => s.index === index);
    if (!slide) return;
    slide.contentStatus = "pending";
    slide.error = undefined;
    slide.overflow = undefined;
    slide.sourceNotice = undefined;
    const steer = instruction?.trim();
    if (steer) this.instructions.set(index, steer);
    else this.instructions.delete(index);
    void this.run({ plan: false, content: new Set([index]), assets: "none", assemble: false });
  }

  // Re-run one slide's asset slot (a figure crop or an illustration).
  regenerateAsset(index: number): void {
    if (this.running) return;
    const slide = this.state.slides.find((s) => s.index === index);
    if (!slide || !slide.assetStatus) return;
    slide.assetStatus = "pending";
    slide.assetError = undefined;
    void this.run({ plan: false, content: "none", assets: new Set([index]), assemble: false });
  }

  // Rebuild the deck from what is on disk. No AI calls: assemble is assembly.
  reassemble(): void {
    if (this.running) return;
    this.state.assembleStatus = "pending";
    this.state.assembleError = undefined;
    void this.run({ plan: false, content: "none", assets: "none", assemble: true });
  }

  private markDeckStale(): void {
    if (this.state.assembleStatus === "done") this.state.assembleStatus = "stale";
  }

  private covers(targets: Targets, index: number): boolean {
    if (targets === "none") return false;
    if (targets === "all") return true;
    return targets.has(index);
  }

  private async run(spec: RunSpec): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopFlag = false;
    this.stopController = new AbortController();
    this.state.runStatus = "running";
    this.state.runError = undefined;
    // Notify before the first await so a caller that fired this off (the per-page
    // re-runs are fire-and-forget) sees "running" immediately, not one IO later.
    this.notify();
    await this.persist();
    try {
      if (spec.plan && this.state.planStatus !== "done") {
        if (!(await this.runPlan())) return;
      }
      if (this.stopFlag) return this.markStopped();
      if (!(await this.runContent(spec.content))) return;
      if (this.stopFlag) return this.markStopped();
      await this.runAssets(spec.assets);
      if (this.stopFlag) return this.markStopped();
      if (spec.assemble && this.state.assembleStatus !== "done") {
        if (!(await this.runAssemble())) return;
      }
      this.settle();
    } catch (e) {
      if (e instanceof StoppedError) this.markStopped();
      else this.fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.running = false;
      this.stopController = null;
      await this.persist();
    }
  }

  // Where the run lands when nothing failed: "done" only once a deck exists on
  // disk. A talk whose pages were re-run sits at "idle" until it is reassembled.
  private settle(): void {
    this.state.runStatus = this.state.assembleStatus === "done" ? "done" : "idle";
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
    s.planError = undefined;
    await this.persist();
    try {
      const plan = await this.callWithWatchdog({ kind: "plan" }, (opts) => this.deps.buildPlan(opts));
      s.title = plan.title;
      s.slides = plan.slides.map((o, i) => ({
        ...o,
        index: i + 1,
        contentStatus: "pending",
        assetStatus: o.illustration || o.figure ? "pending" : undefined,
      }));
      s.planStatus = "done";
      await this.persist();
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
  // fails the run (a deck missing a slide body is not shippable). The body goes
  // to disk before the status flips to done, so "done" always means there is a
  // file to assemble from.
  private async runContent(targets: Targets): Promise<boolean> {
    if (targets === "none") return true;
    for (const slide of this.state.slides) {
      if (this.stopFlag) return false;
      if (!this.covers(targets, slide.index)) continue;
      if (targets === "all" && slide.contentStatus !== "pending") continue;
      slide.contentStatus = "running";
      slide.error = undefined;
      await this.persist();
      const instruction = this.instructions.get(slide.index);
      try {
        const outcome = await this.callWithWatchdog(
          { kind: "content", slide: slide.index },
          (opts) => this.deps.generateContent({ slide, instruction }, opts),
        );
        await this.deps.writeFragment(slide.index, outcome.html);
        slide.sourceNotice = outcome.sourceNotice;
        slide.overflow = overflowNotice(outcome.html);
        slide.contentStatus = "done";
        this.instructions.delete(slide.index);
        this.markDeckStale();
        await this.persist();
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

  // Assets are best-effort for the deck — it ships without them — but never
  // best-effort about the truth: a slot that produced no image is "missing" with
  // the reason, not "done" (docs/29).
  private async runAssets(targets: Targets): Promise<void> {
    if (targets === "none") return;
    for (const slide of this.state.slides) {
      if (this.stopFlag) return;
      if (!slide.assetStatus) continue;
      if (!this.covers(targets, slide.index)) continue;
      if (targets === "all" && slide.assetStatus !== "pending") continue;
      slide.assetStatus = "running";
      slide.assetError = undefined;
      this.setActivity({
        kind: "assets",
        slide: slide.index,
        startedAt: this.deps.now(),
        chars: 0,
        attempt: 1,
        attempts: 1,
      });
      try {
        let outcome: AssetOutcome = { url: null, reason: "No asset slot on this slide." };
        if (slide.figure) {
          outcome = await this.deps.renderFigureAsset(slide.figure);
        } else if (slide.illustration) {
          outcome = await this.deps.generateIllustration(slide, await this.styleReference(), {
            signal: this.stopController!.signal,
          });
          if (outcome.url && !this.styleRef) this.styleRef = outcome.url;
        }
        await this.deps.writeAsset(slide.index, outcome.url);
        if (outcome.url) {
          slide.assetStatus = "done";
        } else {
          slide.assetStatus = "missing";
          slide.assetError = outcome.reason ?? "No image was produced.";
        }
      } catch (e) {
        if (this.stopFlag || (e instanceof DOMException && e.name === "AbortError")) {
          slide.assetStatus = "pending";
          this.markStopped();
          this.setActivity(null);
          return;
        }
        slide.assetStatus = "failed";
        slide.assetError = e instanceof Error ? e.message : String(e);
      } finally {
        this.setActivity(null);
      }
      this.markDeckStale();
      await this.persist();
    }
  }

  // The style reference for illustrations: the first one this run produced, or —
  // on a resumed run — the first one already on disk, so a deck finished across
  // two sessions still reads as one set.
  private async styleReference(): Promise<string | null> {
    if (this.styleRef) return this.styleRef;
    for (const s of this.state.slides) {
      if (!s.illustration || s.assetStatus !== "done") continue;
      const stored = await this.deps.readAsset(s.index);
      if (stored) {
        this.styleRef = stored;
        return stored;
      }
    }
    return null;
  }

  private async runAssemble(): Promise<boolean> {
    const s = this.state;
    // Refuse to build a deck with a hole in it: an unwritten body would assemble
    // as an empty slide that looks like a design choice.
    const unready = s.slides.filter((sl) => sl.contentStatus !== "done");
    if (s.slides.length === 0 || unready.length > 0) {
      s.assembleStatus = "failed";
      s.assembleError =
        s.slides.length === 0
          ? "There are no slides to assemble."
          : `Slide ${unready.map((sl) => sl.index).join(", ")} has no body yet.`;
      this.fail(s.assembleError);
      return false;
    }
    s.assembleStatus = "running";
    s.assembleError = undefined;
    this.setActivity({ kind: "assemble", startedAt: this.deps.now(), chars: 0, attempt: 1, attempts: 1 });
    try {
      const slides: AssembleSlide[] = [];
      for (const slide of s.slides) {
        const fragment = await this.deps.readFragment(slide.index);
        if (fragment === null) {
          throw new Error(`slide ${slide.index}'s body is missing from disk`);
        }
        const asset = slide.assetStatus === "done" ? await this.deps.readAsset(slide.index) : null;
        slides.push({ kind: slide.kind, fragment, asset });
      }
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
