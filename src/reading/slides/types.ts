// Slides data model (docs/14, "PPT（slides）共识"; docs/31). The unit is a talk,
// not a book: a deck synthesized across one or more books that already have
// notes, plus a free-text talk instruction.
//
// The state is persisted the same way the notes pipeline persists its own
// (docs/29 asked for it): one directory per talk holding state.json, one file
// per slide body and one per resolved asset. That is what makes a single page
// re-runnable and a half-finished run resumable across a restart — before this
// the whole talk lived in memory, so any change meant re-running everything.

export const SLIDES_VERSION = 1 as const;

// A slide's role in the deck. "title" opens, "section" is a divider, "content"
// carries the argument, "closing" wraps up.
export type SlideKind = "title" | "section" | "content" | "closing";

// Status of one unit of work: not started / requeued, in flight, done, or failed.
export type SlideStatus = "pending" | "running" | "done" | "failed";

// An asset slot carries one status more than a phase: "missing" — nothing threw,
// but no image was produced (no illustration key configured, a figure with no
// usable bbox, a crop that came back empty). It used to be reported as "done",
// which put a green badge in the dialog next to a deck with no image on that
// slide; a slot that produced nothing has to say so.
export type AssetStatus = SlideStatus | "missing";

// Assembly carries one status more: "stale" — the deck on disk was built from
// slide bodies that have since been re-run. Same posture as the notes overview:
// not rebuilt automatically, the dialog offers a button.
export type AssembleStatus = SlideStatus | "stale";

// Overall run lifecycle. "idle" is "nothing in flight and nothing failed, but
// the deck is not assembled" (a fresh talk, or one whose pages were re-run).
// "stopped" is a user Stop (distinct from a failure).
export type RunStatus = "idle" | "running" | "done" | "failed" | "stopped";

// An AI-illustration slot: a per-slide prompt the image client turns into an
// editorial illustration (a deck-wide style prefix is added at generation time).
export interface SlideIllustration {
  prompt: string;
}

// A figure slot: an existing book figure (by book id + figure id) cropped in via
// the in-app figure path.
export interface SlideFigureRef {
  bookId: string;
  figId: string;
}

// One planned slide (the plan stage's output). Assets and body are filled later.
export interface SlideOutline {
  title: string;
  kind: SlideKind;
  // Which book this slide draws on, when it is book-specific (content stage feeds
  // that book's chapter notes). Absent for cross-book synthesis / title / closing.
  bookId?: string;
  // 1-based chapter indices in that book whose notes feed this slide's body.
  // Validated against the book's real chapter list right after planning
  // (validateDeckPlan), so a made-up number is caught there instead of silently
  // turning into "distil the overview again" at content time.
  sourceChapters?: number[];
  illustration?: SlideIllustration;
  figure?: SlideFigureRef;
  // What plan validation had to change about this slide (a chapter that does not
  // exist or has no note, a figure id that is not in the book's index). Shown in
  // the dialog: a repaired plan must not look like a clean one.
  planNotice?: string;
}

// A slide with its per-stage progress. The generated HTML body and the resolved
// asset live on disk (one file each, see store.ts), not here, so the snapshot
// stays light and a restart can pick them up.
export interface SlideRun extends SlideOutline {
  index: number; // 1-based deck order
  contentStatus: SlideStatus;
  // Present only for a slide that has an illustration or figure slot.
  assetStatus?: AssetStatus;
  // Why the asset slot is missing or failed (shown next to the badge).
  assetError?: string;
  // What material actually fed this slide's body, when it was not what the plan
  // asked for — the fallback to a book overview used to be silent (docs/29).
  sourceNotice?: string;
  // A generation-time estimate that the body will not fit the 16:9 stage. The
  // deck shell clips overflow, so an unflagged overflow stays invisible until
  // the talk (overflow.ts; the shell flags it at playback too).
  overflow?: string;
  error?: string;
}

export interface SlidesState {
  version: typeof SLIDES_VERSION;
  // Talk id, and the directory name under slides/. Fixed at creation (the
  // creation timestamp) so the on-disk home exists before the title is known.
  id: string;
  title: string;
  createdAt: number;
  instruction: string;
  bookIds: string[];
  runStatus: RunStatus;
  runError?: string;
  planStatus: SlideStatus;
  planError?: string;
  slides: SlideRun[];
  assembleStatus: AssembleStatus;
  assembleError?: string;
  // AppData-relative path of the written deck once assembled.
  outputFile?: string;
}

export interface SlidesInit {
  talkId: string;
  createdAt: number;
  instruction: string;
  bookIds: string[];
}

export function createSlidesState(init: SlidesInit): SlidesState {
  return {
    version: SLIDES_VERSION,
    id: init.talkId,
    title: "Untitled talk",
    createdAt: init.createdAt,
    instruction: init.instruction,
    bookIds: init.bookIds,
    runStatus: "idle",
    planStatus: "pending",
    slides: [],
    assembleStatus: "pending",
  };
}

// Recover a persisted state at load: anything interrupted mid-flight ("running")
// goes back to "pending" so a restart resumes it instead of hanging, and a run
// that was in flight when the app died is no longer claimed to be running. Done,
// failed, missing and stale are left alone — they are decisions, not accidents.
// (Same rule as normalizeChapterSpineOnLoad in ../notes/types.ts.)
export function normalizeSlidesOnLoad(state: SlidesState): SlidesState {
  return {
    ...state,
    runStatus: state.runStatus === "running" ? "idle" : state.runStatus,
    planStatus: state.planStatus === "running" ? "pending" : state.planStatus,
    assembleStatus: state.assembleStatus === "running" ? "pending" : state.assembleStatus,
    slides: state.slides.map((s) => ({
      ...s,
      contentStatus: s.contentStatus === "running" ? "pending" : s.contentStatus,
      assetStatus: s.assetStatus === "running" ? "pending" : s.assetStatus,
    })),
  };
}

// Whether this talk still needs an AI call: a plan, a slide body, or an asset.
// (Assembly is not an AI call, which is why it is asked about separately — one
// button per kind of work, so neither of them lies about what it will spend.)
export function hasUnrunSlides(state: SlidesState): boolean {
  if (state.planStatus !== "done") return true;
  return state.slides.some((s) => s.contentStatus === "pending" || s.assetStatus === "pending");
}

// One row in slides/talks.json: a generated deck, newest appended last.
export interface TalkEntry {
  // The talk id (its directory under slides/). Absent on rows written before the
  // state was persisted per talk; those decks still open, but cannot be re-run.
  talkId?: string;
  title: string;
  file: string; // AppData-relative path, e.g. "slides/1737000000000-my-talk.html"
  createdAt: number;
  bookIds: string[];
  instruction: string;
}

// Record a talk in the registry (pure). Newest last; caller reverses for display.
// Re-assembling the same talk replaces its row instead of adding a second one —
// a deck can now be rebuilt any number of times.
export function upsertTalk(talks: TalkEntry[], entry: TalkEntry): TalkEntry[] {
  const at = entry.talkId ? talks.findIndex((t) => t.talkId === entry.talkId) : -1;
  if (at < 0) return [...talks, entry];
  const next = talks.slice();
  next[at] = entry;
  return next;
}
