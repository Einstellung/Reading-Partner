// The phone lesson's two derived lines (docs/70): what the row under the top
// bar says, and where each chapter stands in the sheet. Both are matched on the
// number printed in the book, because that is what read_chapter writes into the
// thread (reading/desk.ts onFocus). Run: bun test.

import { expect, test } from "bun:test";
import type { TableChapter } from "../../../../../src/reading/chapters/table";
import {
  LESSON_CHIPS,
  lessonChapterRows,
  lessonFocusLine,
} from "../../../../../src/ui/components/phone/lesson/lesson-view";

function chapter(over: Partial<TableChapter> & { index: number }): TableChapter {
  return {
    number: over.index,
    title: `Chapter ${over.index}`,
    startPage: over.index,
    endPage: over.index + 1,
    ...over,
  };
}

const PAPER: TableChapter[] = [
  // Front matter: drawn, numbered by nothing, and never the focus.
  chapter({ index: 1, number: null, title: "Abstract", startPage: 1 }),
  chapter({ index: 2, number: 1, title: "Introduction", startPage: 1 }),
  chapter({ index: 3, number: 2, title: "Related Work", startPage: 2 }),
  chapter({ index: 4, number: 3, title: "BERT", startPage: 3 }),
];

test("the focus line names the chapter and the page the lesson is on", () => {
  expect(lessonFocusLine(PAPER, { chapter: 3, page: 4, resumed: false })).toBe("Now: BERT · p.4");
  // Nothing quoted yet: the chapter alone, rather than a page the lesson has
  // not reached.
  expect(lessonFocusLine(PAPER, { chapter: 3, page: null, resumed: false })).toBe("Now: BERT");
});

test("a lesson reopened where it was left says so instead", () => {
  expect(lessonFocusLine(PAPER, { chapter: 2, page: 2, resumed: true })).toBe(
    "Continuing from: Related Work",
  );
});

test("there is no line when there is no chapter to name", () => {
  expect(lessonFocusLine(PAPER, null)).toBeNull();
  // A thread taught elsewhere: the focus synced, the table did not.
  expect(lessonFocusLine(null, { chapter: 3, page: 4, resumed: false })).toBeNull();
  // A focus on a chapter this table does not have.
  expect(lessonFocusLine(PAPER, { chapter: 9, page: null, resumed: false })).toBeNull();
});

test("the sheet marks the chapter in hand, the ones behind it, and nothing else", () => {
  const rows = lessonChapterRows(PAPER, 3, new Set([1, 2, 3]));
  expect(rows.map((r) => r.state)).toEqual(["none", "done", "done", "now"]);
  expect(rows.map((r) => r.title)).toEqual(["Abstract", "Introduction", "Related Work", "BERT"]);
  expect(rows.map((r) => r.startPage)).toEqual([1, 1, 2, 3]);
});

test("a chapter is done because it was taught, not because it comes earlier", () => {
  // Straight to section 3: the two before it were skipped, and the sheet says
  // so rather than counting them as read.
  const rows = lessonChapterRows(PAPER, 3, new Set([3]));
  expect(rows.map((r) => r.state)).toEqual(["none", "none", "none", "now"]);
});

test("a lesson that has not started marks nothing", () => {
  expect(lessonChapterRows(PAPER, null, new Set()).every((r) => r.state === "none")).toBe(true);
  // No table here yet: no rows, which is the sheet saying it has no list rather
  // than offering an empty one.
  expect(lessonChapterRows(null, 3, new Set([3]))).toEqual([]);
});

test("the two standing chips say what a reader would have typed", () => {
  expect(LESSON_CHIPS.map((c) => c.label)).toEqual(["I don't follow", "Skip"]);
  // Each sends a sentence, not a command: the model is being told something.
  for (const chip of LESSON_CHIPS) expect(chip.text.endsWith(".")).toBe(true);
});
