// The lines on the Today screen (src/ui/components/shelf/today.ts). Every one is
// derived from something already on disk, so every one of them is assertable.
// Run: bun test.

import { expect, test } from "bun:test";
import { continueMetaLine, todayDateLine } from "../../../../src/ui/components/shelf/today";

test("the date line names the weekday and the day, and not the year", () => {
  const line = todayDateLine(new Date(2026, 8, 5));
  expect(line).toBe("Saturday, September 5");
  expect(line).not.toContain("2026");
});

test("the continue line is the topic, the page and the marks", () => {
  expect(continueMetaLine("agent loops", { page: 61, pages: 144, marks: 23 })).toBe(
    "agent loops · p. 61 of 144 · 23 marks",
  );
});

// A book that was never opened has no position and nothing marked. The topic is
// still worth saying, and there is no dangling separator after it.
test("a book with nothing read yet is just its topic", () => {
  expect(continueMetaLine("agent loops", undefined)).toBe("agent loops");
  expect(continueMetaLine("agent loops", { marks: 0 })).toBe("agent loops");
});

test("one mark is a mark, one page with no length is just the page", () => {
  expect(continueMetaLine("t", { page: 2, marks: 1 })).toBe("t · p. 2 · 1 mark");
});
