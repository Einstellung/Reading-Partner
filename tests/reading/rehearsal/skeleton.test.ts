// The rehearsal skeleton (src/reading/rehearsal/skeleton.ts): which structure it
// takes the chapters from, how a page maps to a chapter, and how the list reads
// to the model. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSkeleton,
  chapterOfPage,
  formatSkeleton,
} from "../../../src/reading/rehearsal/skeleton";
import type { NoteChapter } from "../../../src/reading/prep/chapters/types";
import type { OutlineItem } from "../../../src/fulltext/types";

const notesPlan: NoteChapter[] = [
  { index: 1, title: "Openings", startPage: 1, endPage: 20, status: "done" },
  { index: 2, title: "Middlegame", startPage: 21, endPage: 60, status: "pending" },
  { index: 3, title: "Endings", startPage: 61, endPage: 90, status: "failed" },
];

const outline: OutlineItem[] = [
  { title: "Part I", page: 5, level: 0 },
  { title: "A section", page: 8, level: 1 },
  { title: "Part II", page: 40, level: 0 },
];

test("the notes plan wins: real titles, real ranges, and note availability", () => {
  const s = buildSkeleton({ notesChapters: notesPlan, outline, pageCount: 90 });
  expect(s.source).toBe("notes-plan");
  expect(s.chapters.map((c) => c.title)).toEqual(["Openings", "Middlegame", "Endings"]);
  // Only a chapter the notes pass finished has a chapter-NN.md to read.
  expect(s.chapters.map((c) => c.hasNote)).toEqual([true, false, false]);
});

test("no notes plan falls back to the book's own top-level outline", () => {
  const s = buildSkeleton({ notesChapters: null, outline, pageCount: 90 });
  expect(s.source).toBe("outline");
  expect(s.chapters.map((c) => c.title)).toEqual(["Part I", "Part II"]);
  // The first chapter is pulled back to page 1 so front matter is covered, and
  // the last runs to the end of the book.
  expect(s.chapters[0].startPage).toBe(1);
  expect(s.chapters[1].endPage).toBe(90);
  expect(s.chapters.every((c) => c.hasNote === false)).toBe(true);
});

test("an empty notes plan is not a plan", () => {
  expect(buildSkeleton({ notesChapters: [], outline, pageCount: 90 }).source).toBe("outline");
});

test("neither: the whole book is one chapter, and the rehearsal still runs", () => {
  const s = buildSkeleton({ notesChapters: null, outline: [], pageCount: 12 });
  expect(s.source).toBe("whole-book");
  expect(s.chapters).toHaveLength(1);
  expect(s.chapters[0]).toMatchObject({ index: 1, startPage: 1, endPage: 12 });
});

test("a book with no text layer at all still produces one chapter", () => {
  const s = buildSkeleton({ notesChapters: null, outline: [], pageCount: 0 });
  expect(s.chapters).toHaveLength(1);
  expect(s.chapters[0].endPage).toBe(1);
});

test("a page maps to the chapter whose range holds it", () => {
  const chapters = buildSkeleton({ notesChapters: notesPlan, outline, pageCount: 90 }).chapters;
  expect(chapterOfPage(chapters, 1)).toBe(1);
  expect(chapterOfPage(chapters, 20)).toBe(1);
  expect(chapterOfPage(chapters, 21)).toBe(2);
  expect(chapterOfPage(chapters, 90)).toBe(3);
});

// A mark on the cover or in the index is still the reader's evidence; dropping
// it because no range claims it would lose it silently.
test("a page outside every range clamps to the nearest end", () => {
  const chapters = buildSkeleton({
    notesChapters: [{ index: 1, title: "Only", startPage: 5, endPage: 9, status: "done" }],
    outline: [],
    pageCount: 20,
  }).chapters;
  expect(chapterOfPage(chapters, 1)).toBe(1);
  expect(chapterOfPage(chapters, 400)).toBe(1);
});

test("the formatted list carries ranges, mark counts and note availability", () => {
  const s = buildSkeleton({ notesChapters: notesPlan, outline, pageCount: 90 });
  const text = formatSkeleton(s, new Map([[1, 12], [2, 0], [3, 1]]));
  expect(text).toContain("1. Openings — pp.1-20, 12 highlights, chapter note on file");
  expect(text).toContain("2. Middlegame — pp.21-60, 0 highlights");
  expect(text).toContain("3. Endings — pp.61-90, 1 highlight");
  expect(text).not.toContain("3. Endings — pp.61-90, 1 highlight, chapter note on file");
});

test("the formatted list says where the structure came from", () => {
  const fromOutline = buildSkeleton({ notesChapters: null, outline, pageCount: 90 });
  expect(formatSkeleton(fromOutline, new Map())).toContain("table of contents");
  const none = buildSkeleton({ notesChapters: null, outline: [], pageCount: 9 });
  expect(formatSkeleton(none, new Map())).toContain("one stretch");
});
