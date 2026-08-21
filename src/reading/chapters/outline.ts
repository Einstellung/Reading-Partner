// Where a chapter table comes from when the PDF carries one: its outline
// (docs/09, docs/14). Only the top-level entries — descending into sub-sections
// turns a twenty-chapter book into a two-hundred-entry list nothing can be
// prepared or taught against.
//
// Whether the entries that come back are worth having is table.ts's question,
// not this file's: an outline is a source of starts, and every source goes
// through the same filter.

import type { OutlineItem } from "../../fulltext/types";
import { chapterRanges, type ChapterEntry, type TableChapter } from "./table";

// Fewer top-level entries than this and the outline is not a table of contents.
// Two rather than three: this floor answers "is there any structure here at
// all", which is a different question from whether a table can steer a lecture
// (table.ts MIN_CHAPTERS).
export const MIN_OUTLINE_ENTRIES = 2;

// The outline's top-level entries, in reading order, as chapter starts. Entries
// pointing outside the book are dropped rather than clamped: a bookmark at page
// 0 or past the last page is a broken bookmark, not a chapter beginning at the
// nearest legal page.
export function outlineEntries(
  outline: readonly OutlineItem[],
  totalPages: number,
): ChapterEntry[] {
  const total = Math.max(1, Math.round(totalPages));
  return outline
    .filter((o) => o.level === 0 && o.page >= 1 && o.page <= total)
    .map((o) => ({ title: o.title, startPage: o.page }));
}

// The outline's chapters with page ranges, unfiltered, or null when the outline
// holds no structure. The caller that wants the filtered table asks
// pickChapterTable with outlineEntries instead; this one is for the rehearsal,
// which walks whatever divisions the book offers and does not reject a thin
// table — a two-chapter walk is still a walk.
export function chaptersFromOutline(
  outline: readonly OutlineItem[],
  totalPages: number,
): TableChapter[] | null {
  const total = Math.max(1, Math.round(totalPages));
  const tops = outlineEntries(outline, total);
  if (tops.length < MIN_OUTLINE_ENTRIES) return null;
  const chapters = chapterRanges(tops, total, { fromFirstPage: true });
  return chapters.length >= MIN_OUTLINE_ENTRIES ? chapters : null;
}
