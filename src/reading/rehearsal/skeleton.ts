// The skeleton the rehearsal walks: the book's chapters with page ranges.
//
// It is assembled from structure the app already has, never from a fresh AI
// call. The reader presses the button and waits, so a plan pass here would be a
// minute of nothing (docs/31: the skeleton is the AI's working sheet, not a
// document to produce). Three sources, best first.

import { chaptersFromOutline, type TableChapter } from "../chapters";
import type { NoteChapter } from "../notes/types";
import type { OutlineItem } from "../../fulltext/types";
import type { RehearsalChapter, Skeleton } from "./types";

export interface SkeletonInput {
  // The notes pipeline's chapter plan (notes-<bookId>/state.json), or null.
  notesChapters: NoteChapter[] | null;
  // The PDF's own table of contents, used when there is no notes plan.
  outline: OutlineItem[];
  pageCount: number;
}

function withNotes(chapters: NoteChapter[]): RehearsalChapter[] {
  return chapters.map((c) => ({
    index: c.index,
    title: c.title,
    startPage: c.startPage,
    endPage: c.endPage,
    // Only a chapter the notes pipeline finished has a chapter-NN.md to read.
    hasNote: c.status === "done",
  }));
}

// The book's own chapters, with no note behind any of them yet.
function unwritten(chapters: TableChapter[]): RehearsalChapter[] {
  return chapters.map((c) => ({
    index: c.index,
    title: c.title,
    startPage: c.startPage,
    endPage: c.endPage,
    hasNote: false,
  }));
}

export function buildSkeleton(input: SkeletonInput): Skeleton {
  const total = Math.max(1, Math.round(input.pageCount) || 1);
  if (input.notesChapters && input.notesChapters.length > 0) {
    return { source: "notes-plan", chapters: withNotes(input.notesChapters) };
  }
  const fromOutline = chaptersFromOutline(input.outline ?? [], total);
  if (fromOutline) return { source: "outline", chapters: unwritten(fromOutline) };
  // Neither: one chapter that is the book. Not a chapter table — there is no
  // division to find here — so it is written out rather than asked for.
  return {
    source: "whole-book",
    chapters: [
      { index: 1, title: "The whole book", startPage: 1, endPage: total, hasNote: false },
    ],
  };
}

// The 1-based chapter a page falls in. Pages outside every range clamp to the
// nearest end rather than vanishing: a mark on the cover or the index belongs
// with the chapter it is closest to, and dropping it would lose evidence.
export function chapterOfPage(chapters: readonly RehearsalChapter[], page: number): number {
  if (chapters.length === 0) return 1;
  for (const c of chapters) {
    if (page >= c.startPage && page <= c.endPage) return c.index;
  }
  return page < chapters[0].startPage ? chapters[0].index : chapters[chapters.length - 1].index;
}

// The skeleton as the model sees it: one line per chapter with its range, how
// many marks the reader left in it, and whether a chapter note exists. The mark
// counts are here rather than only beside the marks themselves because the
// "densely marked and never mentioned" rule is a comparison across chapters.
export function formatSkeleton(
  skeleton: Skeleton,
  markCounts: ReadonlyMap<number, number>,
): string {
  const where =
    skeleton.source === "notes-plan"
      ? "from the chapter plan your notes pass already wrote"
      : skeleton.source === "outline"
        ? "from the book's own table of contents"
        : "the book has no usable table of contents, so it is one stretch";
  const lines = [`The book's chapters (${where}):`];
  for (const c of skeleton.chapters) {
    const marks = markCounts.get(c.index) ?? 0;
    const bits = [`pp.${c.startPage}-${c.endPage}`, `${marks} highlight${marks === 1 ? "" : "s"}`];
    if (c.hasNote) bits.push("chapter note on file");
    lines.push(`${c.index}. ${c.title} — ${bits.join(", ")}`);
  }
  return lines.join("\n");
}
