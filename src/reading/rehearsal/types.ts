// Rehearsal data model (docs/31). Two shapes: the skeleton the rehearsal walks
// (a chapter list with page ranges, assembled from whatever structure the book
// already has) and the decisions the rehearsal produces (one per chapter: does
// it go in the talk, what does it contribute, which figure carries it).
//
// The skeleton is derived and never stored — it is rebuilt from the notes plan
// or the PDF outline each turn. The decisions are not derivable from anything,
// so they are the file: rehearsal-<bookId>.json, in sync range.

export const REHEARSAL_VERSION = 1 as const;

// Where the skeleton came from, in descending order of how much it knows.
//   "notes-plan"  the chapter plan the notes pipeline already wrote (docs/14),
//                 which has real titles and real ranges.
//   "outline"     the PDF's own top-level table of contents.
//   "whole-book"  neither existed, so the book is one chapter.
export type SkeletonSource = "notes-plan" | "outline" | "whole-book";

// A chapter of the book as the rehearsal walks it. 1-based inclusive page range,
// contiguous and covering the whole book (see notes/plan.ts toChapters).
export interface RehearsalChapter {
  index: number;
  title: string;
  startPage: number;
  endPage: number;
  // A chapter note exists on disk for this chapter (notes status "done").
  hasNote: boolean;
}

export interface Skeleton {
  source: SkeletonSource;
  chapters: RehearsalChapter[];
}

// One of the reader's marks, flattened for bucketing and for the prompt.
export interface Mark {
  page: number | null;
  text: string;
  comment?: string;
}

// What the rehearsal decided about one chapter. Written by the model through
// record_chapter_decision after that chapter's exchange, never before it.
export interface RehearsalDecision {
  // 1-based index into the skeleton this decision was made against.
  chapter: number;
  // The chapter's title when the decision was made. Kept so the decision still
  // reads as something if the skeleton later shifts (a notes plan replacing an
  // outline renumbers chapters).
  title: string;
  // Whether the chapter goes in the talk.
  include: boolean;
  // What it contributes, in the reader's own framing. Empty for a cut chapter.
  points: string[];
  // The figure that carries it, as a [fig:N] id or a plain description. Absent
  // when the chapter needs no picture.
  figure?: string;
  // One line of why, when the exchange produced one (usually why it is cut).
  note?: string;
  updatedAt: number;
}

// The decision file. Ordered by chapter, one entry per chapter at most.
export interface RehearsalPlan {
  version: typeof REHEARSAL_VERSION;
  bookId: string;
  createdAt: number;
  updatedAt: number;
  decisions: RehearsalDecision[];
}
