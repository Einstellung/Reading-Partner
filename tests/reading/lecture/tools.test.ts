// read_chapter (src/reading/lecture/tools.ts): the tool that answers with a
// whole chapter, in both of its shapes. Run: bun test.

import { expect, test } from "bun:test";
import { MAX_PAGES } from "../../../src/fulltext/format";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import { buildChapterTable, type LectureChapter } from "../../../src/reading/chapters";
import { buildReadChapterTool, READ_CHAPTER_MAX_PAGES } from "../../../src/reading/lecture";

function book(pages: number): Fulltext {
  return {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: Array.from({ length: pages }, (_, i) => `page ${i + 1} ${"body text ".repeat(40)}`),
    outline: [],
  };
}

const BOOK = book(107);
const TABLE: LectureChapter[] = buildChapterTable(
  [
    { title: "封面与前言", startPage: 1 },
    { title: "第 1 章 一", startPage: 12 },
    { title: "第 2 章 二", startPage: 30 },
    { title: "第 3 章 编码注意力机制", startPage: 64 },
  ],
  BOOK,
);

// The whole point: read_pages caps at 10 pages and the measured chapter is 44.
test("a whole chapter comes back in one call, past the read_pages cap", async () => {
  const tool = buildReadChapterTool({ bookName: "book.pdf", fulltext: BOOK, chapters: TABLE });
  const out = (await tool.execute({ chapter: 3 })) as string;
  expect(out).toContain('Chapter 3, "第 3 章 编码注意力机制", of "book.pdf" — p.64-107.');
  expect(out).toContain("=== Page 64 === [p.64]");
  expect(out).toContain("=== Page 107 === [p.107]");
  const pages = out.match(/=== Page \d+ ===/g)!;
  expect(pages.length).toBe(44);
  expect(pages.length).toBeGreaterThan(MAX_PAGES);
});

test("a chapter number the book does not have answers with the ones it does", async () => {
  const tool = buildReadChapterTool({ bookName: "book.pdf", fulltext: BOOK, chapters: TABLE });
  const out = (await tool.execute({ chapter: 9 })) as string;
  expect(out).toContain("no chapter 9");
  expect(out).toContain("3 (第 3 章 编码注意力机制)");
});

// docs/09: only when the reader has named one. A tool description that does not
// say so is one the model reaches for on every question about the book.
test("the description says when not to call it", () => {
  const tool = buildReadChapterTool({ bookName: "book.pdf", fulltext: BOOK, chapters: TABLE });
  expect(tool.description).toContain("Only call this when the reader has explicitly named a chapter");
});

// The focus is what the next turn inlines. Written only where the caller says
// so: a marked passage's conversation may be asked to teach chapter 3 and gets
// it, without becoming a conversation about chapter 3.
test("the chapter it read is handed to the caller, and only if the caller asked", async () => {
  const focused: number[] = [];
  const withFocus = buildReadChapterTool({
    bookName: "book.pdf",
    fulltext: BOOK,
    chapters: TABLE,
    onFocus: (c) => focused.push(c.number!),
  });
  await withFocus.execute({ chapter: 2 });
  expect(focused).toEqual([2]);

  const without = buildReadChapterTool({ bookName: "book.pdf", fulltext: BOOK, chapters: TABLE });
  await without.execute({ chapter: 2 });
  expect(focused).toEqual([2]);
});

// Two of the five measured books have no usable chapter table. Without this the
// only thing left on them is ten pages at a time.
test("with no chapter table it takes a page range, four times read_pages' cap", async () => {
  const tool = buildReadChapterTool({ bookName: "book.pdf", fulltext: BOOK, chapters: null });
  expect(READ_CHAPTER_MAX_PAGES).toBe(40);
  expect(tool.name).toBe("read_chapter");
  expect(tool.description).toContain("no usable chapter table");
  const out = (await tool.execute({ from: 10, to: 100 })) as string;
  const pages = out.match(/=== Page \d+ ===/g)!;
  expect(pages.length).toBe(READ_CHAPTER_MAX_PAGES);
  expect(out).toContain("=== Page 10 === [p.10]");
  expect(out).not.toContain("=== Page 50 ===");
});
