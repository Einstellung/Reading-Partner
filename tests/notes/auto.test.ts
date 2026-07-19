// Unit tests for the highlight-frontier logic (src/notes/auto.ts), pure — no
// pipeline, no IO. Run: bun test.

import { expect, test } from "bun:test";
import { highlightFrontier, planAutoNotes, type AutoChapter } from "../../src/notes/auto";

// Four contiguous chapters, all pending unless overridden.
function chapters(overrides: Partial<Record<number, AutoChapter["status"]>> = {}): AutoChapter[] {
  return [
    { index: 1, startPage: 1, endPage: 10, status: overrides[1] ?? "pending" },
    { index: 2, startPage: 11, endPage: 20, status: overrides[2] ?? "pending" },
    { index: 3, startPage: 21, endPage: 30, status: overrides[3] ?? "pending" },
    { index: 4, startPage: 31, endPage: 40, status: overrides[4] ?? "pending" },
  ];
}

const marks = (...pages: number[]) => pages.map((page) => ({ page }));

test("no marks: nothing to do", () => {
  expect(planAutoNotes(chapters(), [])).toEqual({ generate: [], skip: [] });
  expect(highlightFrontier(chapters(), [])).toBe(0);
});

test("frontier is the furthest chapter with a mark", () => {
  expect(highlightFrontier(chapters(), marks(5, 25))).toBe(3);
  expect(highlightFrontier(chapters(), marks(35))).toBe(4);
});

test("behind the frontier: marked chapters generate, unmarked chapters skip", () => {
  // Marks in ch1 and ch3; ch3 is the frontier. ch1 (marked) generates, ch2
  // (unmarked, behind frontier) skips, ch3 (frontier) and ch4 stay untouched.
  const plan = planAutoNotes(chapters(), marks(3, 25));
  expect(plan.generate).toEqual([1]);
  expect(plan.skip).toEqual([2]);
});

test("the frontier chapter itself is never generated (reader still in it)", () => {
  const plan = planAutoNotes(chapters(), marks(25));
  // ch3 is the frontier; ch1 and ch2 have no marks so they skip; ch3/ch4 untouched.
  expect(plan.generate).toEqual([]);
  expect(plan.skip).toEqual([1, 2]);
});

test("already-settled chapters are left alone", () => {
  const plan = planAutoNotes(chapters({ 1: "done", 2: "skipped" }), marks(5, 15, 35));
  // Frontier is ch4. ch1 done, ch2 skipped → untouched; ch3 unmarked → skip.
  expect(plan.generate).toEqual([]);
  expect(plan.skip).toEqual([3]);
});

test("a failed chapter behind the frontier is not re-queued by the frontier", () => {
  const plan = planAutoNotes(chapters({ 1: "failed" }), marks(5, 35));
  expect(plan.generate).toEqual([]); // ch1 failed, waits for manual retry
  expect(plan.skip).toEqual([2, 3]);
});

test("final pass includes the last chapter when reader and a mark are both in it", () => {
  const plan = planAutoNotes(chapters(), marks(5, 35), { readingPage: 38 });
  // Frontier rises past ch4: ch4 marked → generate; ch2, ch3 unmarked → skip.
  expect(plan.generate).toEqual([1, 4]);
  expect(plan.skip).toEqual([2, 3]);
});

test("final pass does not include the last chapter when the reader is not in it", () => {
  const plan = planAutoNotes(chapters(), marks(5, 35), { readingPage: 15 });
  // Reader still in ch2, so ch4 stays open even though it has a mark.
  expect(plan.generate).toEqual([1]);
  expect(plan.skip).toEqual([2, 3]);
});

test("final pass with no mark in the last chapter leaves it open", () => {
  const plan = planAutoNotes(chapters(), marks(5, 25), { readingPage: 35 });
  // Reader is in ch4 but marked nothing there; ch4 stays open (nothing to note).
  expect(plan.generate).toEqual([1]);
  expect(plan.skip).toEqual([2]);
});
