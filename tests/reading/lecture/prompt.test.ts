// The chapter spine and the statement of what a turn is carrying
// (src/reading/lecture/prompt.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  chapterOutlineSection,
  turnLoadStatement,
  OUTLINE_BUDGET_TOKENS,
  type ChapterOutline,
} from "../../../src/reading/lecture";
import type { TableChapter } from "../../../src/reading/chapters";

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

const CH3: TableChapter = {
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

// docs/09: the prompt states the spine's progress and stops there. Telling the
// reader to wait would be wrong most of the time — teaching the chapter in front
// of them needs none of it, only the links between chapters do — so the sentence
// is a fact and the model decides from the question, the same way it already
// decides how long an answer should be.
test("a spine still being written is stated as a fact, with no instruction to wait", () => {
  const loaded = turnLoadStatement({
    mode: "chapter",
    bookName: "从零构建大语言模型",
    pageCount: 401,
    chapter: CH3,
    outlines: 5,
    hasChapterTable: true,
    spine: { done: 5, total: 12 },
  });
  expect(loaded).toContain("still being written: 5 of its");
  expect(loaded).toContain("12 chapters are in");
  // What is actually missing, named: the links, not the chapters themselves.
  expect(loaded).toContain("links between chapters");
  expect(loaded).toContain("A chapter's own content does not wait on this");
  // The judgement is handed to the model in the words the rest of the prompt
  // already uses for it.
  expect(loaded).toContain("Let the question decide");
  for (const nag of ["wait a", "come back", "try again later", "in a moment", "ask them to wait"]) {
    expect(loaded.toLowerCase()).not.toContain(nag);
  }
});

// No run, or a finished one: the turn says nothing about progress at all. A
// prompt that says "the spine is complete" every turn is noise.
test("no spine progress is no sentence about it", () => {
  const loaded = turnLoadStatement({
    mode: "chapter",
    bookName: "book.pdf",
    pageCount: 401,
    chapter: CH3,
    outlines: 12,
  });
  expect(loaded).not.toContain("still being written");
});

// An aside borrows its parent's stable half verbatim, so this block — last in
// the prompt, nearest the question — is where it is told which of the two it is
// answering (docs/03).
test("an aside says what this turn is, and where the passage came from", () => {
  const load = { mode: "chapter" as const, bookName: "book.pdf", pageCount: 401, chapter: CH3 };
  const chat = turnLoadStatement({ ...load, aside: { from: "chat" } });
  expect(chat).toContain("This turn is a side conversation");
  expect(chat).toContain("pulled one\nsentence out of the lesson");
  expect(chat).toContain("do not restart the lesson");
  // Still a statement of what this turn holds, after saying what it is.
  expect(chat.indexOf("side conversation")).toBeLessThan(chat.indexOf("What you have in this turn's prompt"));

  const drawn = turnLoadStatement({ ...load, aside: { from: "mark" } });
  expect(drawn).toContain("marked a\npassage on the page mid-lesson");
  expect(drawn).not.toContain("pulled one\nsentence out of the lesson");

  // The lesson's own turn is untouched.
  expect(turnLoadStatement(load)).not.toContain("side conversation");
});

// docs/09: the question decides the length, whichever door the reader came in
// by. An aside is the shortest door there is and must not be the one that says
// so. Nor may it examine the reader (docs/09, dropped 2026-08-19).
test("an aside does not fix the length of an answer or quiz the reader", () => {
  const loaded = turnLoadStatement({
    mode: "chapter",
    bookName: "book.pdf",
    pageCount: 401,
    chapter: CH3,
    aside: { from: "chat" },
  });
  for (const phrase of [
    "keep it short",
    "briefly",
    "a few sentences",
    "one question",
    "check whether it landed",
    "in their own words",
  ]) {
    expect(`${phrase}: ${loaded.toLowerCase().includes(phrase)}`).toBe(`${phrase}: false`);
  }
});
