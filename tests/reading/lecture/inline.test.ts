// Which of the three loads a turn runs with, and what each one puts in the
// prompt (src/reading/lecture/inline.ts). The numbers here are the measured
// books of docs/09, so a threshold moved by accident shows up as one of them
// changing tier. Run: bun test.

import { expect, test } from "bun:test";
import { estimateTextTokens } from "../../../src/budget";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import {
  chapterSection,
  correctEstimate,
  decideInline,
  inlinePages,
  lectureTokens,
  wholeBookSection,
  CHAPTER_MAX_TOKENS,
  LECTURE_TOKEN_SAFETY,
  MAX_CHAPTER_PAGES,
  WHOLE_BOOK_MAX_TOKENS,
} from "../../../src/reading/lecture";
import type { TableChapter } from "../../../src/reading/chapters";

function ft(pages: string[]): Fulltext {
  return { version: FULLTEXT_VERSION, status: "ok", pages, outline: [] };
}

const BOOK = ft(["page one text", "page two text", "page three text"]);

const CH: TableChapter = {
  index: 2,
  number: 3,
  title: "编码注意力机制",
  startPage: 2,
  endPage: 3,
};

// src/budget's estimate came out about a third under what the provider counted
// on the measured translated textbook, so every number the tiers are compared
// against is taken through this first. Being wrong upward costs a turn some
// text it could have afforded; downward costs the answer.
test("the estimate is corrected upward before anything is compared to it", () => {
  expect(LECTURE_TOKEN_SAFETY).toBe(1.5);
  expect(correctEstimate(20_000)).toBe(30_000);
  expect(lectureTokens("书".repeat(1_000))).toBe(1_500);
});

test("a document inside the bar is inlined whole", () => {
  expect(
    decideInline({ hasText: true, bodyEstimate: WHOLE_BOOK_MAX_TOKENS / 2, chapter: null }),
  ).toBe("whole");
  // Exactly at the bar still fits.
  expect(
    decideInline({ hasText: true, bodyEstimate: WHOLE_BOOK_MAX_TOKENS / 1.5, chapter: null }),
  ).toBe("whole");
});

// The measured chapter: 44 pages, 31,509 characters, about 27k corrected.
test("past the bar, a chapter in focus is what gets inlined", () => {
  expect(
    decideInline({
      hasText: true,
      bodyEstimate: 150_000,
      chapter: CH,
      chapterEstimate: 18_000,
    }),
  ).toBe("chapter");
});

test("no focus, or a chapter the size of a book, inlines nothing", () => {
  expect(decideInline({ hasText: true, bodyEstimate: 150_000, chapter: null })).toBe("none");
  expect(
    decideInline({
      hasText: true,
      bodyEstimate: 150_000,
      chapter: CH,
      chapterEstimate: CHAPTER_MAX_TOKENS,
    }),
  ).toBe("none");
  // No text layer, no inlining, whatever the numbers say.
  expect(decideInline({ hasText: false, bodyEstimate: 10, chapter: CH, chapterEstimate: 10 })).toBe(
    "none",
  );
});

// A book that fits entirely has all of its chapters in front of the model
// already; re-inlining one would be the same text twice.
test("the whole book wins over a chapter focus", () => {
  expect(
    decideInline({ hasText: true, bodyEstimate: 1_000, chapter: CH, chapterEstimate: 500 }),
  ).toBe("whole");
});

// The header is the one read_pages uses. An inlined body under a bare header is
// harder for the model to cite than a page it fetched itself.
test("inlined pages carry the same anchors a fetched page does", () => {
  expect(inlinePages(BOOK, 1, 2)).toBe(
    "=== Page 1 === [p.1]\npage one text\n=== Page 2 === [p.2]\npage two text",
  );
});

test("the whole-book block says when the reference list was left off", () => {
  const whole = wholeBookSection("survey.pdf", BOOK, 3);
  expect(whole).toContain('The whole of "survey.pdf", page by page:');
  expect(whole).not.toContain("reference list");

  const trimmed = wholeBookSection("survey.pdf", BOOK, 2);
  expect(trimmed).toContain("minus its closing reference list");
  expect(trimmed).toContain("[Pages 3-3 are this document's numbered reference list and");
  expect(trimmed).toContain("never a paper slug");
  expect(trimmed).not.toContain("page three text");
});

test("the chapter block names the chapter the way the reader would", () => {
  const block = chapterSection("book.pdf", BOOK, CH);
  expect(block).toContain('Chapter 3, "编码注意力机制" of "book.pdf", p.2-3, page by page:');
  expect(block).toContain("=== Page 2 === [p.2]");
  expect(block).not.toContain("page one text");
});

// A guard on a table that is wrong, not a budget: the budget is the tier.
test("a chapter longer than the page guard is cut, and says where it stopped", () => {
  const long = ft(Array.from({ length: MAX_CHAPTER_PAGES + 10 }, (_, i) => `page ${i + 1}`));
  const block = chapterSection("book.pdf", long, {
    ...CH,
    startPage: 1,
    endPage: MAX_CHAPTER_PAGES + 10,
  });
  expect(block).toContain(`=== Page ${MAX_CHAPTER_PAGES} === [p.${MAX_CHAPTER_PAGES}]`);
  expect(block).not.toContain(`=== Page ${MAX_CHAPTER_PAGES + 1} ===`);
  expect(block).toContain("read_pages reaches them");
});

// The five measured documents, by the numbers docs/09 recorded, so a threshold
// change shows up as a book crossing a line.
test("the measured books land in the tiers docs/09 puts them in", () => {
  const cjk = (chars: number) => estimateTextTokens("编译器内联缓存".repeat(Math.ceil(chars / 7)));
  // The 22-page survey's body: 83,252 characters of Latin prose.
  expect(correctEstimate(estimateTextTokens("a".repeat(83_252)))).toBeLessThan(
    WHOLE_BOOK_MAX_TOKENS,
  );
  // The 401-page textbook: 258,829 characters, 43.5% of them CJK.
  const textbook = estimateTextTokens("书".repeat(112_591) + "a".repeat(146_238));
  expect(correctEstimate(textbook)).toBeGreaterThan(WHOLE_BOOK_MAX_TOKENS * 3);
  // Its third chapter: 31,509 characters at the same mix.
  const chapter = cjk(13_706) + estimateTextTokens("a".repeat(17_803));
  expect(correctEstimate(chapter)).toBeLessThan(CHAPTER_MAX_TOKENS);
});
