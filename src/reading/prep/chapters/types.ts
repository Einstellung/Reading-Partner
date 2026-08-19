// Chapter-spine data model (docs/09, docs/14). One run per book, keyed by the
// book id (library.ts content hash). The state file is a derived view —
// rebuildable from the book plus the model — and lives under prep-<bookId>/chapters/
// next to the per-chapter spines and the chapter graph it indexes.
//
// What the run produces changed on 2026-08-19: the chapter files are no longer
// notes a person reads, they are what the lecture entry reads before it teaches
// a chapter — what the chapter does, what it builds on, what later chapters take
// from it. The file layout is unchanged; the version is bumped because the
// contents of a v1 run are the old human-facing form, and feeding those to the
// model as if they were spines would be worse than regenerating them.
//
// Generation and revision granularity is still the chapter.

import type { BookChapter } from "../../chapters";
import { decodeLegacyName } from "../../../platform/app/path";

export const CHAPTER_SPINE_VERSION = 2 as const;

// Status of a phase that runs one long AI call: pending (not started or
// requeued), running (in flight), done, or failed. Mid-run "running" is
// normalized back to "pending" on load so a restart resumes.
export type PhaseStatus = "pending" | "running" | "done" | "failed";

// A chapter has no state of its own beyond the phase it is in. There used to be
// a "skipped" — the reader had marked nothing in the chapter's page range, back
// when preparation followed the highlight frontier — and preparation is
// whole-book now (docs/09, 2026-08-19): the questions a spine answers ("should I
// start at chapter 3?") are about the chapters the reader has not reached, so
// there is nothing to skip.
export type ChapterStatus = PhaseStatus;

// The second pass adds one more state: "stale" — the chapter graph was written,
// then a chapter was regenerated, so its edges may be out of date. It is not
// regenerated automatically; the panel offers a button.
export type OverviewStatus = PhaseStatus | "stale";

// A chapter as the spine pipeline holds it: the book's own chapter
// (reading/chapters BookChapter) plus how far its note has got. Ranges are
// 1-based inclusive, contiguous, and cover the whole book.
export interface SpineChapter extends BookChapter {
  status: ChapterStatus;
  error?: string;
}

export interface ChapterSpineState {
  version: typeof CHAPTER_SPINE_VERSION;
  bookId: string;
  bookName: string;
  createdAt: number;
  planStatus: PhaseStatus;
  planError?: string;
  // Where the chapter structure came from: the PDF outline, or the model reading
  // the table of contents. Informational (shown in the panel).
  planSource?: "outline" | "ai";
  chapters: SpineChapter[];
  overviewStatus: OverviewStatus;
  overviewError?: string;
}

export function createChapterSpineState(bookId: string, bookName: string, now: number): ChapterSpineState {
  return {
    version: CHAPTER_SPINE_VERSION,
    bookId,
    bookName,
    createdAt: now,
    planStatus: "pending",
    chapters: [],
    overviewStatus: "pending",
  };
}

// Recover a persisted state at load: a plan or chapter or graph pass interrupted
// mid-run ("running") goes back to "pending" so a restart resumes it instead of
// hanging. Done/failed/stale phases are left alone (failed chapters wait for a
// manual retry; a stale graph stays stale until the user regenerates it).
// A book name left percent-encoded by an iOS import is decoded here too — it
// goes into the chapter prompts, so a state written before path normalization
// existed would otherwise keep telling the model the book is "%E5%85%A8...".
// No write of its own: the repaired name reaches disk with the next save.
export function normalizeChapterSpineOnLoad(state: ChapterSpineState): ChapterSpineState {
  return {
    ...state,
    bookName: decodeLegacyName(state.bookName),
    planStatus: state.planStatus === "running" ? "pending" : state.planStatus,
    overviewStatus: state.overviewStatus === "running" ? "pending" : state.overviewStatus,
    chapters: state.chapters.map((c) =>
      c.status === "running" ? { ...c, status: "pending" as const } : c,
    ),
  };
}
