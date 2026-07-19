// Slides data model (docs/14, "PPT（slides）共识"). The unit is a talk, not a
// book: a deck synthesized across one or more books that already have notes,
// plus a free-text talk instruction. State lives in memory for the duration of a
// run (no resume-across-restart in v1); the persistent record is the generated
// HTML file under slides/ and the slides/talks.json index. This mirrors the
// notes pipeline's posture (docs/14) but is keyed by a talk, not a book id.

export const SLIDES_VERSION = 1 as const;

// A slide's role in the deck. "title" opens, "section" is a divider, "content"
// carries the argument, "closing" wraps up.
export type SlideKind = "title" | "section" | "content" | "closing";

// Status of one unit of work: not started / requeued, in flight, done, or failed.
export type SlideStatus = "pending" | "running" | "done" | "failed";

// Overall run lifecycle. "stopped" is a user Stop (distinct from a failure).
export type RunStatus = "idle" | "running" | "done" | "failed" | "stopped";

// An AI-illustration slot: a per-slide prompt the image client turns into an
// editorial illustration (a deck-wide style prefix is added at generation time).
export interface SlideIllustration {
  prompt: string;
}

// A figure slot: an existing book figure (by book id + figure id) cropped in via
// the in-app figure path. Dropped silently when the crop can't be produced.
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
  sourceChapters?: number[];
  illustration?: SlideIllustration;
  figure?: SlideFigureRef;
}

// A slide with its per-stage progress. The generated HTML fragment and the
// resolved asset data URL live in the pipeline's side maps, not here, so the
// snapshot stays light (mirrors notes keeping chapter bodies on disk).
export interface SlideRun extends SlideOutline {
  index: number; // 1-based deck order
  contentStatus: SlideStatus;
  // Present only for a slide that has an illustration or figure slot.
  assetStatus?: SlideStatus;
  error?: string;
}

export interface SlidesState {
  version: typeof SLIDES_VERSION;
  // Talk id: "<timestamp>-<slug>", also the deck's filename stem.
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
  assembleStatus: SlideStatus;
  assembleError?: string;
  // AppData-relative path of the written deck once assembled.
  outputFile?: string;
}

// One row in slides/talks.json: a generated deck, newest appended last.
export interface TalkEntry {
  title: string;
  file: string; // AppData-relative path, e.g. "slides/1737000000000-my-talk.html"
  createdAt: number;
  bookIds: string[];
  instruction: string;
}

// Append a talk to the registry (pure). Newest last; caller reverses for display.
export function addTalk(talks: TalkEntry[], entry: TalkEntry): TalkEntry[] {
  return [...talks, entry];
}
