// The book's chapter table (src/reading/chapters/table.ts).
// Every case here is one of the five books measured in docs/09: a bookmark tree
// that is the chapter list plus a cover entry, one with divider pages that hold
// no text, one with a single-page entry, and two with no usable outline at all.
// Run: bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import {
  buildChapterTable,
  chapterByNumber,
  chapterFocusLabel,
  chapterNumber,
  chapterRanges,
  chapterTableSection,
  chapterTableUsable,
  pickChapterTable,
  MIN_CHAPTERS,
} from "../../../src/reading/chapters";

// A book whose every page carries enough text to count as body, unless named in
// `blank`, which stands in for a divider page.
function book(pages: number, blank: number[] = []): Fulltext {
  return {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: Array.from({ length: pages }, (_, i) =>
      blank.includes(i + 1) ? "第 3 部分" : `page ${i + 1} ${"body text ".repeat(40)}`,
    ),
    outline: [],
  };
}

test("the chapter number comes from the title, in either language", () => {
  expect(chapterNumber("第 3 章 编码注意力机制")).toBe(3);
  expect(chapterNumber("第3章 编码注意力机制")).toBe(3);
  expect(chapterNumber("Chapter 5: Building a GPT")).toBe(5);
  expect(chapterNumber("CHAPTER 12")).toBe(12);
  expect(chapterNumber("7. Fine-tuning")).toBe(7);
  expect(chapterNumber("Preface")).toBeNull();
  expect(chapterNumber("Appendix A")).toBeNull();
});

// Rasbt's outline: the first entry is the cover and front matter, p.1-11, and
// the printed chapter 1 is the table's second row. Matching by position picks
// the wrong chapter for every question the reader asks.
test("a chapter is found by its printed number, never by its position", () => {
  const table = buildChapterTable(
    [
      { title: "封面与前言", startPage: 1 },
      { title: "第 1 章 理解大语言模型", startPage: 12 },
      { title: "第 2 章 处理文本数据", startPage: 30 },
      { title: "第 3 章 编码注意力机制", startPage: 64 },
    ],
    book(107),
  );
  expect(table.map((c) => c.number)).toEqual([null, 1, 2, 3]);
  const three = chapterByNumber(table, 3)!;
  expect(three.index).toBe(4);
  expect(three.startPage).toBe(64);
  expect(three.endPage).toBe(107);
  expect(chapterFocusLabel(three)).toBe('chapter 3 ("第 3 章 编码注意力机制"), p.64-107');
});

// 智能简史: 40 top-level entries, six of them divider pages with under twenty
// characters behind them. A chip that offers to teach a blank page is worse
// than no chip.
test("entries with no body behind them are dropped, and the ranges close over them", () => {
  const table = buildChapterTable(
    [
      { title: "第 1 章 起源", startPage: 1 },
      { title: "第二部分", startPage: 20 },
      { title: "第 2 章 符号主义", startPage: 21 },
      { title: "第 3 章 连接主义", startPage: 40 },
    ],
    book(60, [20]),
  );
  expect(table.map((c) => c.title)).toEqual([
    "第 1 章 起源",
    "第 2 章 符号主义",
    "第 3 章 连接主义",
  ]);
  // The divider's page is swallowed by the chapter before it rather than left
  // as a hole nothing covers.
  expect(table[0].endPage).toBe(20);
  expect(table[1].startPage).toBe(21);
});

// Hands-On has an entry spanning p.19-19.
test("a single-page entry with nothing on it goes too", () => {
  const table = buildChapterTable(
    [
      { title: "Chapter 1", startPage: 1 },
      { title: "Part II", startPage: 19 },
      { title: "Chapter 2", startPage: 20 },
      { title: "Chapter 3", startPage: 40 },
    ],
    book(60, [19]),
  );
  expect(table).toHaveLength(3);
  expect(table.every((c) => c.title.startsWith("Chapter"))).toBe(true);
});

// 具身智能综述: one level-0 entry. The English original: none. Two entries is
// still "the chapter I am in is half the book", which is the whole-book
// question wearing a chapter's name.
test("fewer than three surviving chapters is not a chapter table", () => {
  expect(MIN_CHAPTERS).toBe(3);
  expect(chapterTableUsable(buildChapterTable([{ title: "Survey", startPage: 1 }], book(60)))).toBe(
    false,
  );
  expect(
    chapterTableUsable(
      buildChapterTable(
        [
          { title: "One", startPage: 1 },
          { title: "Two", startPage: 30 },
        ],
        book(60),
      ),
    ),
  ).toBe(false);
  expect(buildChapterTable([], book(60))).toEqual([]);
});

// A book that prints no numbers anywhere is numbered by its own order: there is
// nothing for that numbering to disagree with, and without it the reader could
// never name one of its chapters.
test("a book that prints no chapter numbers is numbered by its order", () => {
  const table = buildChapterTable(
    [
      { title: "Attention", startPage: 1 },
      { title: "Scaling", startPage: 20 },
      { title: "Alignment", startPage: 40 },
    ],
    book(60),
  );
  expect(table.map((c) => c.number)).toEqual([1, 2, 3]);
});

test("sources are tried in order and the first usable one wins", () => {
  const ft = book(60);
  const outline = [{ title: "Survey", startPage: 1 }]; // too thin
  const notes = [
    { title: "第 1 章 一", startPage: 1 },
    { title: "第 2 章 二", startPage: 20 },
    { title: "第 3 章 三", startPage: 40 },
  ];
  const prep = [
    { title: "wrong", startPage: 1 },
    { title: "wrong", startPage: 10 },
    { title: "wrong", startPage: 20 },
  ];
  expect(pickChapterTable([outline, notes, prep], ft)!.map((c) => c.number)).toEqual([1, 2, 3]);
  expect(pickChapterTable([outline], ft)).toBeNull();
  expect(pickChapterTable([], ft)).toBeNull();
});

test("the table's prompt block names the number the reader would say", () => {
  const table = buildChapterTable(
    [
      { title: "封面与前言", startPage: 1 },
      { title: "第 1 章 一", startPage: 20 },
      { title: "第 2 章 二", startPage: 40 },
    ],
    book(60),
  );
  const section = chapterTableSection(table);
  expect(section).toContain("- 封面与前言 — p.1-19");
  expect(section).toContain("- [ch.1] 第 1 章 一 — p.20-39");
  expect(chapterTableSection([])).toBe("");
});

// --- ranging, the part both readers of the table share ---

test("ranges are contiguous and cover the whole book", () => {
  const chapters = chapterRanges(
    [
      { title: "Intro", startPage: 3 },
      { title: "Body", startPage: 10 },
      { title: "End", startPage: 20 },
    ],
    30,
    { fromFirstPage: true },
  );
  expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 9], // first pulled back to page 1
    [10, 19],
    [20, 30], // last runs to the final page
  ]);
  expect(chapters.map((c) => c.index)).toEqual([1, 2, 3]);
});

// The one behaviour the two readers of the table want differently: the spine
// pass prepares every page of the book, so the front matter belongs to chapter
// one; a lecture teaches chapters, and the pages before chapter one are not it.
test("front matter is folded in only when the caller asks for it", () => {
  const entries = [
    { title: "One", startPage: 5 },
    { title: "Two", startPage: 20 },
  ];
  expect(chapterRanges(entries, 40, { fromFirstPage: true })[0].startPage).toBe(1);
  expect(chapterRanges(entries, 40)[0].startPage).toBe(5);
});

test("ranging sorts, de-dupes shared start pages, and clamps to the book", () => {
  const chapters = chapterRanges(
    [
      { title: "B", startPage: 10 },
      { title: "A", startPage: 5 },
      { title: "dupe", startPage: 5 },
      { title: "past end", startPage: 999 },
    ],
    40,
    { fromFirstPage: true },
  );
  expect(chapters.map((c) => c.title)).toEqual(["A", "B", "past end"]);
  expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 9],
    [10, 39],
    [40, 40],
  ]);
});

// No entries is no table. The one-chapter-that-is-the-book fallback belongs to
// the caller that wants one (retell/skeleton.ts), not here: a book with no
// divisions has no chapter table, and saying otherwise invents a chapter.
test("no entries ranges to no chapters", () => {
  expect(chapterRanges([], 12)).toEqual([]);
});

// The AI table-of-contents path re-enters the filter with a table that already
// has ranges; a clean one has to come back unchanged.
test("an already-clean table survives the filter untouched", () => {
  const table = buildChapterTable(
    [
      { title: "One", startPage: 1 },
      { title: "Two", startPage: 6 },
      { title: "Three", startPage: 11 },
    ],
    book(20),
    { fromFirstPage: true },
  );
  expect(table.map((c) => [c.index, c.title, c.startPage, c.endPage])).toEqual([
    [1, "One", 1, 5],
    [2, "Two", 6, 10],
    [3, "Three", 11, 20],
  ]);
});
