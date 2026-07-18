// Unit tests for the notes plan (src/notes/plan.ts): outline -> chapters, range
// assignment, and the AI table-of-contents fallback parse. Run: bun test.

import { expect, test } from "bun:test";
import {
  chaptersFromOutline,
  parseNotesPlan,
  toChapters,
} from "../../src/notes/plan";
import type { OutlineItem } from "../../src/fulltext/types";

test("toChapters makes contiguous, whole-book-covering ranges", () => {
  const chapters = toChapters(
    [
      { title: "Intro", startPage: 3 },
      { title: "Body", startPage: 10 },
      { title: "End", startPage: 20 },
    ],
    30,
  );
  expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 9], // first pulled back to page 1
    [10, 19],
    [20, 30], // last runs to the final page
  ]);
  expect(chapters.every((c) => c.status === "pending")).toBe(true);
  expect(chapters.map((c) => c.index)).toEqual([1, 2, 3]);
});

test("toChapters sorts, de-dupes shared start pages, and clamps to the book", () => {
  const chapters = toChapters(
    [
      { title: "B", startPage: 10 },
      { title: "A", startPage: 5 },
      { title: "dupe", startPage: 5 },
      { title: "past end", startPage: 999 },
    ],
    40,
  );
  expect(chapters.map((c) => c.title)).toEqual(["A", "B", "past end"]);
  expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 9],
    [10, 39],
    [40, 40],
  ]);
});

test("toChapters with no items yields a single whole-book chapter", () => {
  const chapters = toChapters([], 12);
  expect(chapters).toEqual([
    { index: 1, title: "The whole book", startPage: 1, endPage: 12, status: "pending" },
  ]);
});

test("chaptersFromOutline uses top-level entries, needs at least two", () => {
  const outline: OutlineItem[] = [
    { title: "One", page: 1, level: 0 },
    { title: "One.a", page: 2, level: 1 },
    { title: "Two", page: 9, level: 0 },
    { title: "Three", page: 15, level: 0 },
  ];
  const chapters = chaptersFromOutline(outline, 20);
  expect(chapters?.map((c) => c.title)).toEqual(["One", "Two", "Three"]);
  expect(chapters?.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 8],
    [9, 14],
    [15, 20],
  ]);
});

test("chaptersFromOutline returns null when there are fewer than two top-level entries", () => {
  expect(chaptersFromOutline([{ title: "Only", page: 1, level: 0 }], 10)).toBeNull();
  expect(
    chaptersFromOutline(
      [
        { title: "sub", page: 1, level: 1 },
        { title: "sub2", page: 2, level: 2 },
      ],
      10,
    ),
  ).toBeNull();
});

test("parseNotesPlan reads the JSON chapters and assigns ranges", () => {
  const text =
    'here you go:\n```json\n{ "chapters": [ { "title": "Preface", "startPage": 1 }, ' +
    '{ "title": "Core", "startPage": 8 } ] }\n```';
  const chapters = parseNotesPlan(text, 25);
  expect(chapters.map((c) => c.title)).toEqual(["Preface", "Core"]);
  expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 7],
    [8, 25],
  ]);
});

test("parseNotesPlan throws with no parseable chapters", () => {
  expect(() => parseNotesPlan('{ "chapters": [] }', 10)).toThrow(/no parseable chapters/);
  expect(() => parseNotesPlan("not json at all", 10)).toThrow(/no JSON object/);
});
