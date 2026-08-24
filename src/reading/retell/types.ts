// Retell data model (docs/31). Two shapes: the skeleton the retell walks
// (a chapter list with page ranges, assembled from whatever structure the book
// already has) and the decisions the retell produces (one per chapter: does
// it go in the talk, what does it contribute, which figure carries it).
//
// Both are derived here and neither is stored here. The skeleton is rebuilt from
// the notes plan or the PDF outline each turn. The decisions are the one thing
// nothing can rebuild, and they belong to the talk rather than to any one book
// (reading/talks): this module only says what one looks like and how a set of
// them reads back to the model.

import type { BookChapter } from "../chapters";

export const RETELL_VERSION = 1 as const;

// Where the skeleton came from, in descending order of how much it knows.
//   "notes-plan"  the chapter plan the notes pipeline already wrote (docs/14),
//                 which has real titles and real ranges.
//   "outline"     the PDF's own top-level table of contents.
//   "whole-book"  neither existed, so the book is one chapter.
export type SkeletonSource = "notes-plan" | "outline" | "whole-book";

// A chapter of the book as the retell walks it: the book's own division
// (reading/chapters BookChapter) plus the one thing a retell asks of it.
export interface RetellChapter extends BookChapter {
  // A chapter note exists on disk for this chapter (notes status "done").
  hasNote: boolean;
}

export interface Skeleton {
  source: SkeletonSource;
  chapters: RetellChapter[];
}

// One of the reader's marks, flattened for bucketing and for the prompt.
export interface Mark {
  page: number | null;
  text: string;
  comment?: string;
}

// What the retell decided about one chapter. Written by the model through
// record_chapter_decision after that chapter's exchange, never before it.
export interface RetellDecision {
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

// The record of a retell so far, as the prompt reads it: one entry per
// chapter at most, in the order the talk will be given. It carries no id of its
// own — it is a projection of the talk that owns it (reading/talks/outline.ts).
export interface RetellPlan {
  version: typeof RETELL_VERSION;
  createdAt: number;
  updatedAt: number;
  decisions: RetellDecision[];
}
