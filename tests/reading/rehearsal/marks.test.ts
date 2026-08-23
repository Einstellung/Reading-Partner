// Bucketing the reader's marks under the skeleton and laying them out for the
// prompt (src/reading/rehearsal/marks.ts). Pure. Run: bun test.

import { expect, test } from "bun:test";
import { bucketMarks, formatMarks } from "../../../src/reading/rehearsal/marks";
import type { Mark, RehearsalChapter } from "../../../src/reading/rehearsal/types";

const chapters: RehearsalChapter[] = [
  { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: true },
  { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
];

const marks: Mark[] = [
  { page: 12, text: "second chapter, later page" },
  { page: 3, text: "first chapter", comment: "check this" },
  { page: 1, text: "first chapter, first page" },
  { page: null, text: "no page at all" },
  { page: 7, text: "   ", comment: "   " },
];

test("marks land in the chapter whose range holds their page, in page order", () => {
  const buckets = bucketMarks(chapters, marks);
  expect(buckets.get(1)?.map((m) => m.page)).toEqual([1, 3]);
  expect(buckets.get(2)?.map((m) => m.page)).toEqual([12]);
});

// Neither can be pointed at, so neither is evidence.
test("a mark with no page and a mark with no content are dropped", () => {
  const buckets = bucketMarks(chapters, marks);
  expect([...buckets.values()].flat()).toHaveLength(3);
});

test("every chapter gets a bucket, empty ones included", () => {
  const buckets = bucketMarks(chapters, [{ page: 2, text: "only one" }]);
  expect([...buckets.keys()]).toEqual([1, 2]);
});

test("the full form carries the page, the passage and the reader's own note", () => {
  const text = formatMarks(chapters, bucketMarks(chapters, marks));
  expect(text).toContain('- [p.3] "first chapter" — their note: "check this"');
  expect(text).toContain('- [p.12] "second chapter, later page"');
  expect(text).toContain("--- 1. Openings (pp.1-10) ---");
});

// "This chapter has nothing marked in it" is itself something the rehearsal can
// ask about, so an empty chapter is listed rather than skipped.
test("a chapter with nothing marked says so", () => {
  const text = formatMarks(chapters, bucketMarks(chapters, [{ page: 2, text: "one" }]));
  expect(text).toContain("--- 2. Middlegame (pp.11-20) ---\n(nothing marked in this chapter)");
});

test("the tight form caps the marks per chapter and counts what it left out", () => {
  const many: Mark[] = Array.from({ length: 9 }, (_, i) => ({
    page: i + 1,
    text: `mark ${i + 1}`,
  }));
  const buckets = bucketMarks(chapters, many);
  const tight = formatMarks(chapters, buckets, { tight: true });
  expect(tight).toContain("(+3 more highlights in this chapter)");
  expect(tight).toContain("read_annotations");
  // The full form leaves everything in place.
  expect(formatMarks(chapters, buckets)).not.toContain("more highlights in this chapter");
});

test("the tight form shortens each passage, the full form keeps it", () => {
  const long = "word ".repeat(200).trim();
  const buckets = bucketMarks(chapters, [{ page: 2, text: long }]);
  const full = formatMarks(chapters, buckets);
  const tight = formatMarks(chapters, buckets, { tight: true });
  expect(tight.length).toBeLessThan(full.length);
  expect(tight).toContain("…");
});
