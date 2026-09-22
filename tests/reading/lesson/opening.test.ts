import { expect, test } from "bun:test";

import { lessonOpening, takeMeTo } from "../../../src/reading/lesson/opening";
import type { TableChapter } from "../../../src/reading/chapters";

function chapter(over: Partial<TableChapter> = {}): TableChapter {
  return { index: 1, number: 1, title: "Experiments", startPage: 3, endPage: 9, ...over };
}

test("the opening asks for the skeleton, states the figure policy and starts", () => {
  const line = lessonOpening();
  expect(line).toContain("skeleton");
  expect(line).toMatch(/figure/i);
  // No question mark: the whole point is that nothing waits on a yes.
  expect(line).not.toContain("?");
  // The reader's own words, not an instruction about the reader.
  expect(line).toMatch(/\bme\b/);
});

test("the opening is one short paragraph", () => {
  expect(lessonOpening().length).toBeLessThan(400);
  expect(lessonOpening()).not.toContain("\n");
});

test("a chapter tap asks to be taken there by title", () => {
  expect(takeMeTo(chapter())).toBe("Take me to Experiments.");
});

test("a title that already ends in a stop does not get a second one", () => {
  expect(takeMeTo(chapter({ title: "  What now.  " }))).toBe("Take me to What now.");
});

test("a chapter with no title falls back to its printed number", () => {
  expect(takeMeTo(chapter({ title: "   ", number: 4 }))).toBe("Take me to chapter 4.");
});

test("front matter with neither title nor number is asked for by page", () => {
  expect(takeMeTo(chapter({ title: "", number: null, startPage: 2 }))).toBe("Take me to page 2.");
});
