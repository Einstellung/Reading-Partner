// The book's chapter table (docs/09), pure. One implementation, two readers:
// the chapter-spine pass prepares one spine per chapter of it, and a lecture
// turn teaches a chapter of it. Neither owns it.
//
// "The book's chapters" sounds like something a PDF already knows and does not
// have to be computed. Measured over five books, it is not: only one of them has
// a bookmark tree that can be used as it stands.
//
//   從零構建大語言模型   outline level-0 is the chapter list, plus a cover entry
//                        at p.1-11 that is not a chapter
//   智能簡史             40 level-0 entries, 6 of which are divider pages whose
//                        whole page range holds under 20 characters of text
//   Hands-On             one entry spanning p.19-19
//   具身智能綜述         1 level-0 entry (chaptersFromOutline answers null)
//   the same, English    0 entries
//
// So the table is (a) taken from the best source that has one, (b) filtered of
// entries with no body behind them, and (c) rejected as a whole when what is
// left is too thin to steer a lecture with. And a chapter is found by the number
// printed in its own title, never by its position in the table: two of the five
// tables above are off by one against the printed numbering, in opposite
// directions, so an index is the one key guaranteed to pick the wrong chapter.

import { estimateTextTokens } from "../../budget";
import type { Fulltext } from "../../fulltext/types";

// One chapter of one book: where it is and what it is called. Every later stage
// reads this same division back — the spine pass adds a status to it, the
// retell walks it, the deck plan cites it. Each of those adds its own field
// to this record; none of them redraws it.
//
// Ranges are 1-based inclusive, contiguous, and cover the whole book.
export interface BookChapter {
  index: number; // 1-based reading order
  title: string;
  startPage: number; // 1-based inclusive
  endPage: number; // 1-based inclusive
}

// A row of the chapter table: a chapter plus the number printed in its own
// title (null for front matter, appendices, and anything else that carries
// none). Separate from BookChapter because the number exists to be matched on —
// a reader's "chapter 3" is looked up by it and never by `index`, and two of the
// five tables measured are off by one against their own printed numbering.
// The stages that only walk the division do not carry it.
export interface TableChapter extends BookChapter {
  number: number | null;
}

// What a source of chapters offers before any of this has been applied: a title
// and where it starts. End pages are re-derived here, because a source that
// carries them (the notes state) and a source that does not (a PDF outline) must
// not produce two differently-shaped tables.
export interface ChapterEntry {
  title: string;
  startPage: number;
}

// A chapter table is usable when it still has this many entries after the
// filtering below. Three rather than two: with two entries "the chapter the
// reader is in" is half the book, which is the whole-book question wearing a
// chapter's name. chaptersFromOutline's own floor of two is about a different
// question (is there anything to write notes against) and is left alone.
export const MIN_CHAPTERS = 3;

// The least text a chapter's page range may hold and still be a chapter. The
// divider pages measured ran under 20 characters; a real chapter runs tens of
// thousands. Anything in between is a title page or a part opener, and letting
// one in costs a chip that offers to teach a blank page.
export const MIN_CHAPTER_CHARS = 200;

const CJK_CHAPTER = /第\s*(\d+)\s*[章讲課课]/;
const EN_CHAPTER = /\bchapter\s+(\d+)\b/i;
const LEADING_NUMBER = /^\s*(\d+)\s*[.、:：]?\s+\S/;

// The chapter number printed in a title, or null. Arabic digits only: every
// table measured writes them that way, and a Chinese-numeral fallback would buy
// nothing but a second thing to keep right.
export function chapterNumber(title: string): number | null {
  for (const re of [CJK_CHAPTER, EN_CHAPTER, LEADING_NUMBER]) {
    const m = re.exec(title);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n < 1000) return n;
    }
  }
  return null;
}

// The text of a 1-based inclusive page range, or "" when the range is outside
// the book. Used both to price a chapter and to decide whether it has a body.
export function pageRangeText(ft: Fulltext, from: number, to: number): string {
  if (ft.status !== "ok") return "";
  const lo = Math.max(1, Math.min(from, to));
  const hi = Math.min(ft.pages.length, Math.max(from, to));
  const parts: string[] = [];
  for (let p = lo; p <= hi; p++) parts.push(ft.pages[p - 1] ?? "");
  return parts.join("\n");
}

// The one thing the two readers of this table want differently.
export interface RangeOptions {
  // Pull the first chapter's start back to page 1, so that the cover, the
  // copyright page and the printed table of contents belong to a chapter rather
  // than to nothing. The spine pass wants that — it prepares every page of the
  // book under one heading or another. A lecture does not: the pages before
  // chapter one are not part of chapter one, and a chip offering to teach them
  // as such would be lying about where the chapter starts.
  fromFirstPage?: boolean;
}

// Entries turned into contiguous, whole-book-covering ranges: sorted,
// de-duplicated by start page, clamped into the book, each chapter ending the
// page before the next begins and the last ending at the final page.
//
// Exported rather than kept private to the filtering below because the ranges
// have to be re-derived after entries are dropped — a divider page removed from
// the table must be swallowed by the chapter before it, not left as a hole
// nothing covers — and because the table's other producer (the model reading a
// printed table of contents) needs the same ranging without the filter.
export function chapterRanges(
  entries: readonly ChapterEntry[],
  totalPages: number,
  opts: RangeOptions = {},
): TableChapter[] {
  const total = Math.max(1, Math.round(totalPages));
  const clean = entries
    .map((e) => ({
      title: (e.title ?? "").trim(),
      startPage: Math.max(1, Math.min(total, Math.round(e.startPage))),
    }))
    .filter((e) => Number.isFinite(e.startPage))
    .sort((a, b) => a.startPage - b.startPage);

  const deduped: ChapterEntry[] = [];
  for (const e of clean) {
    if (deduped.length && deduped[deduped.length - 1].startPage === e.startPage) continue;
    deduped.push(e);
  }
  if (deduped.length === 0) return [];
  if (opts.fromFirstPage) deduped[0] = { ...deduped[0], startPage: 1 };

  return deduped.map((e, i) => ({
    index: i + 1,
    number: chapterNumber(e.title),
    title: e.title || "Untitled",
    startPage: e.startPage,
    endPage: Math.max(
      e.startPage,
      i < deduped.length - 1 ? deduped[i + 1].startPage - 1 : total,
    ),
  }));
}

// A source's entries turned into the table this module hands out: ranged,
// filtered of bodiless entries, and ranged again. The result can be empty or
// short; whether that is usable is `chapterTableUsable`, asked separately
// because the caller picking between sources wants to ask it of each.
export function buildChapterTable(
  entries: readonly ChapterEntry[],
  ft: Fulltext,
  opts: RangeOptions = {},
): TableChapter[] {
  const total = ft.status === "ok" ? ft.pages.length : 0;
  if (total === 0) return [];

  const kept = chapterRanges(entries, total, opts).filter(
    (c) => pageRangeText(ft, c.startPage, c.endPage).trim().length >= MIN_CHAPTER_CHARS,
  );
  const table = chapterRanges(kept, total, opts);
  // A book that prints no chapter numbers at all is numbered by its own order:
  // there is nothing for that numbering to disagree with, and without it the
  // reader of such a book could never name a chapter to be taught. A book that
  // prints some keeps its nulls — those entries are front matter and appendices,
  // and giving them numbers is how an off-by-one gets made.
  return table.some((c) => c.number !== null)
    ? table
    : table.map((c) => ({ ...c, number: c.index }));
}

export function chapterTableUsable(chapters: readonly TableChapter[]): boolean {
  return chapters.length >= MIN_CHAPTERS;
}

// The first source that yields a usable table, in the order given (docs/09: the
// PDF outline, then the notes state, then the prep plan). Null when none does,
// which is the answer that takes the chapter chip away and puts read_chapter
// into its page-range form.
export function pickChapterTable(
  sources: readonly (readonly ChapterEntry[])[],
  ft: Fulltext,
  opts: RangeOptions = {},
): TableChapter[] | null {
  for (const entries of sources) {
    if (entries.length === 0) continue;
    const table = buildChapterTable(entries, ft, opts);
    if (chapterTableUsable(table)) return table;
  }
  return null;
}

// The chapter carrying a printed number, or null. This is the only lookup a
// reader's "chapter 3" is allowed to go through.
export function chapterByNumber(
  chapters: readonly TableChapter[],
  n: number,
): TableChapter | null {
  return chapters.find((c) => c.number === n) ?? null;
}

// How the chapter a conversation is parked on is named, in a prompt and in a
// status row: the number the reader would say, its title, and its pages.
export function chapterFocusLabel(chapter: TableChapter): string {
  const name =
    chapter.number === null ? `"${chapter.title}"` : `chapter ${chapter.number} ("${chapter.title}")`;
  return `${name}, p.${chapter.startPage}-${chapter.endPage}`;
}

// The table as the prompt carries it: one line per chapter, with the number the
// reader would say and the pages it spans. Stable per book, so it sits in the
// cacheable half of the prompt.
export function chapterTableSection(chapters: readonly TableChapter[]): string {
  if (chapters.length === 0) return "";
  const lines = ["This book's chapters, with the pages each one spans:"];
  for (const c of chapters) {
    const label = c.number === null ? "" : `[ch.${c.number}] `;
    lines.push(`- ${label}${c.title} — p.${c.startPage}-${c.endPage}`);
  }
  return lines.join("\n");
}

// What one chapter costs, for the loading decision. Estimated, and deliberately
// estimated high — see lecture/inline.ts for why the raw estimate is not enough.
export function chapterTokens(ft: Fulltext, chapter: TableChapter): number {
  return estimateTextTokens(pageRangeText(ft, chapter.startPage, chapter.endPage));
}
