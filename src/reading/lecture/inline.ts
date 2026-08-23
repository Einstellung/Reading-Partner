// Which of the three loads a lecture turn runs with (docs/09), and the body text
// each one puts in the prompt. Pure.
//
//   whole    the book fits: every body page inlined, reference list trimmed.
//            This is the paper case, and its behaviour is the one that was
//            already there.
//   chapter  a chapter is in focus: that chapter inlined, re-inlined every turn.
//   none     neither: the chapter table and the reading tools, no body text.
//
// The judgement is made against an estimate, and the estimate is known to run
// low. src/budget/estimate.ts charges dense scripts one token per character and
// everything else four, which on the measured translated textbook (401 pages,
// 258,829 characters, 43.5% of them CJK) came out about a third under what the
// provider actually counted — the Latin third of a book like that is code,
// identifiers and formulae, none of which tokenize anywhere near four characters
// to the token. So every number here is taken through `correctEstimate`, which
// adds the headroom back, and the thresholds are set against the corrected
// number. Being wrong in this direction costs a turn some inlined text it could
// have afforded; being wrong in the other direction costs the answer.

import { BOOK_PAGE_LABEL } from "../../fulltext/format";
import type { Fulltext } from "../../fulltext/types";
import type { TableChapter } from "../chapters";

// What the prompt was loaded with this turn. Also the telemetry value
// (platform/app/cache-telemetry.ts), so the three names are the axis a later
// reading of the logs is grouped by.
export type InlineMode = "none" | "chapter" | "whole";

// The estimate is short by about a third on the worst measured material; 1.5
// turns that estimate back into the number it was short of.
export const LECTURE_TOKEN_SAFETY = 1.5;

// The whole book goes in below this, corrected. 45k is the measured survey's
// ballpark with room for the notes, the history and an answer beside it.
export const WHOLE_BOOK_MAX_TOKENS = 45_000;

// A chapter above this is not inlined either: a book whose "chapters" are three
// 130-page parts is a book, and inlining a third of it every turn is the cost
// the whole-book threshold exists to refuse. The measured chapter — 44 pages,
// 31,509 characters — comes to about 27k corrected, well inside this.
export const CHAPTER_MAX_TOKENS = 60_000;

// The most pages one inlined chapter prints, whatever the table claims its range
// is. A guard on a table that is wrong rather than a budget: the budget is the
// threshold above.
export const MAX_CHAPTER_PAGES = 60;

export function correctEstimate(estimate: number): number {
  return Math.ceil(estimate * LECTURE_TOKEN_SAFETY);
}

export interface InlineInput {
  // The token estimate (uncorrected) of the book's body pages — the pages that
  // would actually be inlined, i.e. after the reference list is trimmed.
  bodyEstimate: number;
  // The chapter in focus this turn, and its uncorrected estimate.
  chapter: TableChapter | null;
  chapterEstimate?: number;
  // False when there is no usable text layer at all.
  hasText: boolean;
}

// Which load this turn runs with. The whole book wins over a chapter focus: a
// book that fits entirely is a book whose chapters are all in front of the model
// already, and re-inlining one of them would be the same text twice.
export function decideInline(input: InlineInput): InlineMode {
  if (!input.hasText) return "none";
  if (correctEstimate(input.bodyEstimate) <= WHOLE_BOOK_MAX_TOKENS) return "whole";
  if (input.chapter && correctEstimate(input.chapterEstimate ?? 0) <= CHAPTER_MAX_TOKENS) {
    return "chapter";
  }
  return "none";
}

// Pages `from`..`to` of a book under the shared page header. The only renderer
// of inlined body text there is, so what the model is handed carries the same
// anchors as what read_pages hands back.
export function inlinePages(ft: Fulltext, from: number, to: number): string {
  const lo = Math.max(1, from);
  const hi = Math.min(ft.pages.length, to);
  const out: string[] = [];
  for (let p = lo; p <= hi; p++) out.push(BOOK_PAGE_LABEL(p), ft.pages[p - 1] ?? "");
  return out.join("\n");
}

// The whole-book block: every body page, and a line about the pages left out
// when the reference list was trimmed off the end (prep/papers/classroom.ts decides
// where the body ends; this only prints what it was told).
export function wholeBookSection(bookName: string, ft: Fulltext, bodyPages: number): string {
  const kept = Math.max(1, Math.min(ft.pages.length, bodyPages));
  const whole = kept === ft.pages.length;
  const lines = [
    whole
      ? `The whole of "${bookName}", page by page:`
      : `"${bookName}", page by page, minus its closing reference list:`,
    inlinePages(ft, 1, kept),
  ];
  if (!whole) {
    lines.push(
      "",
      `[Pages ${kept + 1}-${ft.pages.length} are this document's numbered reference list and`,
      "are not reproduced here; read_pages still reaches them. A [n] marker in the body",
      "is a citation number, never a paper slug — the slugs are the ones in the prep",
      "list below, and there are no others.]",
    );
  }
  return lines.join("\n");
}

// The chapter block: one chapter, page by page, named by the number the reader
// would say rather than by its position in the table.
export function chapterSection(bookName: string, ft: Fulltext, chapter: TableChapter): string {
  const to = Math.min(chapter.endPage, chapter.startPage + MAX_CHAPTER_PAGES - 1);
  const name = chapter.number === null ? `"${chapter.title}"` : `Chapter ${chapter.number}, "${chapter.title}"`;
  const lines = [
    `${name} of "${bookName}", p.${chapter.startPage}-${chapter.endPage}, page by page:`,
    inlinePages(ft, chapter.startPage, to),
  ];
  if (to < chapter.endPage) {
    lines.push(
      "",
      `[This chapter's remaining pages ${to + 1}-${chapter.endPage} are not reproduced here;`,
      "read_pages reaches them.]",
    );
  }
  return lines.join("\n");
}
