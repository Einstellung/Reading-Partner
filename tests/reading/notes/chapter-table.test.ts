// Unit tests for the chapter-table filter (src/reading/notes/chapter-table.ts),
// the temporary local stand-in for src/reading/lecture/. Run: bun test.

import { expect, test } from "bun:test";
import {
  filterChapterTable,
  outlineChapterTable,
  MIN_CHAPTER_CHARS,
} from "../../../src/reading/notes/chapter-table";
import type { OutlineItem } from "../../../src/fulltext/types";

// A book of `n` pages, each holding `chars` characters, with the named pages
// nearly empty — the shape a part divider or a cover page has.
function pages(n: number, blanks: number[] = [], chars = 2000): string[] {
  return Array.from({ length: n }, (_, i) => (blanks.includes(i + 1) ? "Part One" : "x".repeat(chars)));
}

function outline(entries: [string, number][]): OutlineItem[] {
  return entries.map(([title, page]) => ({ title, page, level: 0 }));
}

test("a divider page between two chapters is dropped and its pages fall to the next chapter", () => {
  const table = outlineChapterTable(
    outline([
      ["Cover", 1],
      ["1. Setup", 2],
      ["Part Two", 6], // one near-empty page
      ["2. Method", 7],
      ["3. Results", 12],
    ]),
    pages(20, [1, 6]),
  );
  expect(table).not.toBeNull();
  expect(table!.map((c) => c.title)).toEqual(["1. Setup", "2. Method", "3. Results"]);
  // Contiguous, covering the whole book, with the divider's page absorbed.
  expect(table!.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 6],
    [7, 11],
    [12, 20],
  ]);
  expect(table!.map((c) => c.index)).toEqual([1, 2, 3]);
});

test("an outline that is all dividers, or too short, has no usable table", () => {
  expect(outlineChapterTable(outline([["A", 1], ["B", 2]]), pages(10))).toBeNull();
  expect(
    outlineChapterTable(
      outline([
        ["A", 1],
        ["B", 2],
        ["C", 3],
        ["D", 4],
      ]),
      pages(10, [1, 2, 3, 4]),
    ),
  ).toBeNull();
  // A survey with a single top-level entry (the paper's own title) has none either.
  expect(outlineChapterTable(outline([["Embodied AI: a survey", 3]]), pages(67))).toBeNull();
});

test("only sub-page-thin entries are dropped; a short real section survives", () => {
  const text = pages(12);
  text[8] = "y".repeat(MIN_CHAPTER_CHARS + 10); // p.9: short but real
  const table = outlineChapterTable(
    outline([
      ["1. One", 1],
      ["2. Two", 5],
      ["Acknowledgements", 9],
      ["Colophon", 10],
    ]),
    (() => {
      const p = text.slice();
      p[9] = "."; // p.10: the colophon, nearly empty
      p[10] = ".";
      p[11] = ".";
      return p;
    })(),
  );
  expect(table!.map((c) => c.title)).toEqual(["1. One", "2. Two", "Acknowledgements"]);
});

test("filterChapterTable leaves an already-clean table alone", () => {
  const clean = [
    { index: 1, title: "One", startPage: 1, endPage: 5, status: "pending" as const },
    { index: 2, title: "Two", startPage: 6, endPage: 10, status: "pending" as const },
    { index: 3, title: "Three", startPage: 11, endPage: 20, status: "pending" as const },
  ];
  const out = filterChapterTable(clean, pages(20));
  expect(out!.map((c) => [c.index, c.title, c.startPage, c.endPage])).toEqual([
    [1, "One", 1, 5],
    [2, "Two", 6, 10],
    [3, "Three", 11, 20],
  ]);
});
