// A PDF outline turned into a chapter table (src/reading/chapters/outline.ts),
// and the filtering it goes through on the way (table.ts). The cases are the
// author's library measured on 2026-08-19: 智能简史 has 40 top-level entries of
// which 9 point at a cover, a dedication, a caption page or one of the five part
// dividers; Hands-On has one such entry at p.19; 具身智能综述 has a single entry
// and the English original none. Run: bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import type { OutlineItem } from "../../../src/fulltext/types";
import {
  chaptersFromOutline,
  outlineEntries,
  pickChapterTable,
} from "../../../src/reading/chapters";

// A book of `n` pages, each holding `chars` characters, with the named pages
// nearly empty — the shape a part divider or a cover page has.
function pages(n: number, blanks: number[] = [], chars = 2000): string[] {
  return Array.from({ length: n }, (_, i) =>
    blanks.includes(i + 1) ? "Part One" : "x".repeat(chars),
  );
}

function outline(entries: [string, number][]): OutlineItem[] {
  return entries.map(([title, page]) => ({ title, page, level: 0 }));
}

function book(entries: [string, number][], text: string[]): Fulltext {
  return { version: FULLTEXT_VERSION, status: "ok", pages: text, outline: outline(entries) };
}

// What the chapter-spine pass and a lecture turn both ask for: the outline's
// entries, filtered, with front matter folded into the first chapter.
function outlineTable(ft: Fulltext) {
  return pickChapterTable([outlineEntries(ft.outline, ft.pages.length)], ft, {
    fromFirstPage: true,
  });
}

test("a divider page between two chapters is dropped and its pages fall to the next chapter", () => {
  const table = outlineTable(
    book(
      [
        ["Cover", 1],
        ["1. Setup", 2],
        ["Part Two", 6], // one near-empty page
        ["2. Method", 7],
        ["3. Results", 12],
      ],
      pages(20, [1, 6]),
    ),
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
  expect(outlineTable(book([["A", 1], ["B", 2]], pages(10)))).toBeNull();
  expect(
    outlineTable(
      book(
        [
          ["A", 1],
          ["B", 2],
          ["C", 3],
          ["D", 4],
        ],
        pages(10, [1, 2, 3, 4]),
      ),
    ),
  ).toBeNull();
  // A survey with a single top-level entry (the paper's own title) has none either.
  expect(outlineTable(book([["Embodied AI: a survey", 3]], pages(67)))).toBeNull();
});

test("only sub-page-thin entries are dropped; a short real section survives", () => {
  const text = pages(12);
  text[8] = "y".repeat(210); // p.9: short but real, just over MIN_CHAPTER_CHARS
  text[9] = "."; // p.10-12: the colophon, nearly empty
  text[10] = ".";
  text[11] = ".";
  const table = outlineTable(
    book(
      [
        ["1. One", 1],
        ["2. Two", 5],
        ["Acknowledgements", 9],
        ["Colophon", 10],
      ],
      text,
    ),
  );
  expect(table!.map((c) => c.title)).toEqual(["1. One", "2. Two", "Acknowledgements"]);
});

test("only the outline's top level is read, and entries off the end are not", () => {
  const entries = outlineEntries(
    [
      { title: "One", page: 1, level: 0 },
      { title: "One.a", page: 2, level: 1 },
      { title: "Two", page: 9, level: 0 },
      { title: "past the end", page: 900, level: 0 },
      { title: "before the start", page: 0, level: 0 },
    ],
    20,
  );
  expect(entries).toEqual([
    { title: "One", startPage: 1 },
    { title: "Two", startPage: 9 },
  ]);
});

// The unfiltered path, for the rehearsal: it walks whatever divisions the book
// offers and a thin table is still a table to walk.
test("chaptersFromOutline uses top-level entries, needs at least two", () => {
  const chapters = chaptersFromOutline(
    [
      { title: "One", page: 1, level: 0 },
      { title: "One.a", page: 2, level: 1 },
      { title: "Two", page: 9, level: 0 },
      { title: "Three", page: 15, level: 0 },
    ],
    20,
  );
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
