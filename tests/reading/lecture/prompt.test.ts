// The chapter spine and the statement of what a turn is carrying
// (src/reading/lecture/prompt.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  chapterOutlineSection,
  turnLoadStatement,
  OUTLINE_BUDGET_TOKENS,
  type ChapterOutline,
  type LectureChapter,
} from "../../../src/reading/lecture";

function outline(over: Partial<ChapterOutline> & { index: number }): ChapterOutline {
  return {
    number: over.index,
    title: `Chapter ${over.index}`,
    startPage: over.index * 10,
    endPage: over.index * 10 + 9,
    body: `what chapter ${over.index} covers, and what it builds on`,
    ...over,
  };
}

const CH3: LectureChapter = {
  index: 4,
  number: 3,
  title: "Coding Attention Mechanisms",
  startPage: 64,
  endPage: 107,
};

// By data: the pass that writes it may not have run, and a lecture never waits
// for it (docs/09).
test("no spine written yet is no block at all", () => {
  expect(chapterOutlineSection([])).toBe("");
  expect(chapterOutlineSection([outline({ index: 1, body: "   " })])).toBe("");
});

test("the spine goes in in reading order, one block per chapter", () => {
  const section = chapterOutlineSection([outline({ index: 2 }), outline({ index: 1 })]);
  expect(section.indexOf("Chapter 1:")).toBeLessThan(section.indexOf("Chapter 2:"));
  expect(section).toContain("--- Chapter 1: Chapter 1 (p.10-19) ---");
  expect(section).toContain("what chapter 2 covers");
  // What it is for: route questions, answered from the book's own pages.
  expect(section).toContain("where to start");
  expect(section).toContain("cite the book's own");
});

test("a pass that wrote essays is held to the budget", () => {
  const fat = Array.from({ length: 40 }, (_, i) =>
    outline({ index: i + 1, body: "x".repeat(20_000) }),
  );
  const section = chapterOutlineSection(fat);
  const blocks = section.match(/--- Chapter /g)!;
  expect(blocks.length).toBeLessThan(fat.length);
  expect(section.length / 4).toBeLessThan(OUTLINE_BUDGET_TOKENS * 1.2);
  // One long chapter does not eat the room the others need.
  expect(chapterOutlineSection([outline({ index: 1, body: "x".repeat(20_000) })])).toContain("…");
});

// docs/09's measured failure: a prompt that said the whole book was in context
// still lost to the model's own transcript, because it stated a state and never
// stated that this turn was different.
test("the statement is about this turn, and it names what is actually here", () => {
  const loaded = turnLoadStatement({
    mode: "chapter",
    bookName: "从零构建大语言模型",
    pageCount: 401,
    chapter: CH3,
    outlines: 12,
    prepNotes: 3,
    hasChapterTable: true,
  });
  expect(loaded).toContain("What you have in this turn's prompt");
  expect(loaded).toContain('chapter 3 ("Coding Attention Mechanisms"), p.64-107');
  expect(loaded).toContain("chapter table");
  expect(loaded).toContain("12 chapter(s)");
  expect(loaded).toContain("3 prep note(s)");
  // And what is not here, which is the half that stops it describing p.300.
  expect(loaded).toContain("Any other page has to be read with");
  // Never a claim about an earlier turn: tool results and page images do not
  // survive one, so such a claim would be false.
  expect(loaded).not.toContain("last turn");
  expect(loaded).toContain("are gone");
});

test("a whole-book turn says so, and does not warn about pages it has", () => {
  const loaded = turnLoadStatement({
    mode: "whole",
    bookName: "survey.pdf",
    pageCount: 22,
    chapter: null,
    bodyPages: 15,
  });
  expect(loaded).toContain("15 of its 22 pages");
  expect(loaded).not.toContain("Any other page has to be read");
});

test("a turn carrying no text of the book says that in one line", () => {
  const loaded = turnLoadStatement({
    mode: "none",
    bookName: "book.pdf",
    pageCount: 318,
    chapter: null,
    hasChapterTable: false,
  });
  expect(loaded).toContain('No text from "book.pdf" itself');
  expect(loaded).toContain("read_chapter / read_pages / search_topic");
});
