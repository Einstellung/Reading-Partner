// The decision file's pure operations (src/reading/rehearsal/plan.ts): merging a
// chapter's decision in, where the rehearsal is up to, and how the record reads
// to the model at the top of a turn. Run: bun test.

import { expect, test } from "bun:test";
import {
  createPlan,
  decisionFor,
  formatPlan,
  nextChapter,
  normalizePlan,
  upsertDecision,
} from "../../../src/reading/rehearsal/plan";
import type { RehearsalChapter, RehearsalDecision } from "../../../src/reading/rehearsal/types";

const chapters: RehearsalChapter[] = [
  { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: false },
  { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
  { index: 3, title: "Endings", startPage: 21, endPage: 30, hasNote: false },
];

function decision(over: Partial<RehearsalDecision> = {}): RehearsalDecision {
  return {
    chapter: 1,
    title: "Openings",
    include: true,
    points: ["the argument rests on the 1962 data"],
    updatedAt: 100,
    ...over,
  };
}

test("a decision is added and the list stays in chapter order", () => {
  let plan = createPlan("book", 1);
  plan = upsertDecision(plan, decision({ chapter: 3, title: "Endings" }));
  plan = upsertDecision(plan, decision({ chapter: 1 }));
  expect(plan.decisions.map((d) => d.chapter)).toEqual([1, 3]);
});

// The reader comes back to a chapter and changes their mind; the file has to end
// up saying the new thing, not both things.
test("recording a chapter again replaces its decision", () => {
  let plan = createPlan("book", 1);
  plan = upsertDecision(plan, decision({ points: ["first take"] }));
  plan = upsertDecision(plan, decision({ points: ["second take"], updatedAt: 200 }));
  expect(plan.decisions).toHaveLength(1);
  expect(decisionFor(plan, 1)?.points).toEqual(["second take"]);
  expect(plan.updatedAt).toBe(200);
});

// Not "the last one plus one": the reader may jump around, and the gap is what
// is actually left to do.
test("the next chapter is the lowest one with no decision", () => {
  let plan = createPlan("book", 1);
  expect(nextChapter(chapters, plan)).toBe(1);
  plan = upsertDecision(plan, decision({ chapter: 2, title: "Middlegame" }));
  expect(nextChapter(chapters, plan)).toBe(1);
  plan = upsertDecision(plan, decision({ chapter: 1 }));
  expect(nextChapter(chapters, plan)).toBe(3);
  plan = upsertDecision(plan, decision({ chapter: 3, title: "Endings" }));
  expect(nextChapter(chapters, plan)).toBeNull();
});

test("an empty record tells the model this is the opening, not chapter one", () => {
  const text = formatPlan(chapters, null);
  expect(text).toContain("nothing recorded yet");
  expect(text).toContain("skeleton");
  expect(text).toContain("thread they want the talk to follow");
});

// The record only knows about recorded chapters, so the turn right after the
// opening still reads as empty; without this the skeleton is laid out twice.
test("an empty record also says not to redo an opening that already happened", () => {
  expect(formatPlan(chapters, null)).toContain("do not do it");
});

test("the record names what was settled and where to pick up", () => {
  let plan = createPlan("book", 1);
  plan = upsertDecision(plan, decision({ figure: "[fig:3]", note: "thin on evidence" }));
  plan = upsertDecision(plan, decision({ chapter: 2, title: "Middlegame", include: false, points: [] }));
  const text = formatPlan(chapters, plan);
  expect(text).toContain("Chapter 1. Openings — in the talk");
  expect(text).toContain("the argument rests on the 1962 data");
  expect(text).toContain("figure: [fig:3]");
  expect(text).toContain("note: thin on evidence");
  expect(text).toContain("Chapter 2. Middlegame — cut");
  expect(text).toContain("Next up: chapter 3");
});

test("a finished rehearsal is told not to walk the chapters again", () => {
  let plan = createPlan("book", 1);
  for (const c of chapters) plan = upsertDecision(plan, decision({ chapter: c.index, title: c.title }));
  const text = formatPlan(chapters, plan);
  expect(text).toContain("Every chapter has a decision");
  expect(text).not.toContain("Next up");
});

test("a decision the file cannot use is dropped, not thrown", () => {
  const raw = {
    version: 1 as const,
    bookId: "book",
    createdAt: 1,
    updatedAt: 5,
    decisions: [
      { chapter: 2, title: "Two", include: true, points: ["a", 3], updatedAt: 5 },
      { chapter: "nope", title: "x", include: true, points: [], updatedAt: 5 },
      { chapter: 2, title: "duplicate", include: false, points: [], updatedAt: 6 },
      { chapter: 1, title: "One", include: false, points: [], updatedAt: 4 },
    ],
  } as never;
  const plan = normalizePlan(raw);
  expect(plan.decisions.map((d) => d.chapter)).toEqual([1, 2]);
  expect(decisionFor(plan, 2)?.points).toEqual(["a"]);
  expect(decisionFor(plan, 2)?.title).toBe("Two");
});
