// TEMPORARY, to be replaced by src/reading/lecture/ (docs/09: "章表解析与过滤").
//
// The chapter spine needs the same chapter table the lecture entry needs, and
// the lecture module owns that. Until it lands, this is the smallest filter that
// gets the real books right, kept in one file so the swap is one import:
//
//   import { bookChapterTable } from "../lecture";
//
// What the notes pipeline asks of it: a chapter table with contiguous 1-based
// page ranges covering the whole document, or null when the document has no
// usable one. Nothing else — the pipeline does not re-cut ranges or re-index.
//
// Why a filter is needed at all (measured on the author's library, 2026-08-19):
// A Brief History of Intelligence has 40 top-level outline entries, of which 9
// point at a cover, a dedication, a caption page or one of the five part
// dividers — each under 150 characters of text in its own page span. Hands-On
// has one such entry (a part divider at p.19, 33 characters). Preparing those as
// chapters spends a call each on a page that says "Part One".

import type { OutlineItem } from "../../fulltext/types";
import { toChapters } from "./plan";
import type { NoteChapter } from "./types";

// Least text an outline entry's own page span must hold to be a chapter. The
// dividers measured come in under 150 characters; the thinnest real chapter
// measured (a 3-page acknowledgements section) holds 2,900.
export const MIN_CHAPTER_CHARS = 200;

// Fewer chapters than this and the table is not worth having: a "table" of two
// entries says nothing the page count does not.
export const MIN_CHAPTERS = 3;

// Characters of text (whitespace removed) in a 1-based inclusive page range.
function charsIn(pages: readonly string[], from: number, to: number): number {
  let n = 0;
  for (let p = from; p <= to; p++) n += (pages[p - 1] ?? "").replace(/\s/g, "").length;
  return n;
}

// Drop the entries that hold no chapter, then re-stitch the ranges so the
// survivors still cover the whole document (a dropped divider's pages fall to
// the chapter that follows it). Returns null when too few survive.
export function filterChapterTable(
  chapters: NoteChapter[],
  pages: readonly string[],
  minChars: number = MIN_CHAPTER_CHARS,
): NoteChapter[] | null {
  const kept = chapters.filter((c) => charsIn(pages, c.startPage, c.endPage) >= minChars);
  if (kept.length < MIN_CHAPTERS) return null;
  return toChapters(
    kept.map((c) => ({ title: c.title, startPage: c.startPage })),
    pages.length,
  );
}

// The document's chapter table from its PDF outline, filtered, or null when the
// outline has none worth using. The AI table-of-contents fallback (plan.ts) goes
// through the same filter in the pipeline's plan stage.
export function outlineChapterTable(
  outline: OutlineItem[],
  pages: readonly string[],
): NoteChapter[] | null {
  const total = pages.length;
  const tops = outline.filter((o) => o.level === 0 && o.page >= 1 && o.page <= total);
  if (tops.length < MIN_CHAPTERS) return null;
  const provisional = toChapters(
    tops.map((o) => ({ title: o.title, startPage: o.page })),
    total,
  );
  return filterChapterTable(provisional, pages);
}
