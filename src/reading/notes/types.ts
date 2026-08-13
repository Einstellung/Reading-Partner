// Notes data model (docs/14). One notes run per book, keyed by the book id
// (library.ts content hash). The state file is a derived view — rebuildable from
// the book plus the model — and lives under notes-<bookId>/ next to the chapter
// notes and the overview it indexes. Notes are the intermediate product a future
// PPT is derived from; generation and revision granularity is the chapter.

import { decodeLegacyName } from "../../platform/app/path";

export const NOTES_VERSION = 1 as const;

// Status of a phase that runs one long AI call: pending (not started or
// requeued), running (in flight), done, or failed. Mid-run "running" is
// normalized back to "pending" on load so a restart resumes.
export type PhaseStatus = "pending" | "running" | "done" | "failed";

// A chapter carries one more state than a phase: "skipped" — the reader marked
// nothing in its page range, so highlight-driven auto generation passed it by
// (docs/14). A skipped chapter is not run by the pipeline and does not block the
// overview; the panel offers a per-chapter generate to override.
export type ChapterStatus = PhaseStatus | "skipped";

// The overview adds one more state: "stale" — the whole-book framework was
// written, then a chapter was regenerated, so it may be out of date. It is not
// regenerated automatically (docs/14); the panel offers a button.
export type OverviewStatus = PhaseStatus | "stale";

// One chapter of one book: where it is and what it is called. Declared here
// because the notes pipeline is what decides a book's chapters (plan.ts
// toChapters), and every later stage reads that same division back — the
// rehearsal walks it, the deck plan cites it. Each of those adds its own field
// to this record; none of them redraws it.
//
// Ranges are 1-based inclusive, contiguous, and cover the whole book.
export interface BookChapter {
  index: number; // 1-based reading order
  title: string;
  startPage: number; // 1-based inclusive
  endPage: number; // 1-based inclusive
}

// A chapter as the notes pipeline holds it: plus how far its note has got.
export interface NoteChapter extends BookChapter {
  status: ChapterStatus;
  error?: string;
}

export interface NotesState {
  version: typeof NOTES_VERSION;
  bookId: string;
  bookName: string;
  createdAt: number;
  planStatus: PhaseStatus;
  planError?: string;
  // Where the chapter structure came from: the PDF outline, or the model reading
  // the table of contents. Informational (shown in the panel).
  planSource?: "outline" | "ai";
  chapters: NoteChapter[];
  overviewStatus: OverviewStatus;
  overviewError?: string;
}

export function createNotesState(bookId: string, bookName: string, now: number): NotesState {
  return {
    version: NOTES_VERSION,
    bookId,
    bookName,
    createdAt: now,
    planStatus: "pending",
    chapters: [],
    overviewStatus: "pending",
  };
}

// Recover a persisted state at load: a plan or chapter or overview interrupted
// mid-run ("running") goes back to "pending" so a restart resumes it instead of
// hanging. Done/failed/stale phases are left alone (failed chapters wait for a
// manual retry; a stale overview stays stale until the user regenerates it).
// A book name left percent-encoded by an iOS import is decoded here too — it
// goes into the chapter prompts, so a state written before path normalization
// existed would otherwise keep telling the model the book is "%E5%85%A8...".
// No write of its own: the repaired name reaches disk with the next save.
export function normalizeNotesOnLoad(state: NotesState): NotesState {
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
