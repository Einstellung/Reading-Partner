// How the record of a rehearsal reads to the model at the top of a turn
// (src/reading/rehearsal/plan.ts). Where the record is kept and in what order is
// the talk's (tests/reading/talks/outline.test.ts); this is the read-back.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  decisionFor,
  formatOutline,
  formatPlan,
  nextChapter,
} from "../../../src/reading/rehearsal/plan";
import type {
  RehearsalChapter,
  RehearsalDecision,
  RehearsalPlan,
} from "../../../src/reading/rehearsal/types";

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

function plan(...decisions: RehearsalDecision[]): RehearsalPlan {
  return { version: 1, createdAt: 1, updatedAt: 100, decisions };
}

test("a chapter's decision is found by its number", () => {
  const p = plan(decision(), decision({ chapter: 3, title: "Endings" }));
  expect(decisionFor(p, 3)?.title).toBe("Endings");
  expect(decisionFor(p, 2)).toBeUndefined();
  expect(decisionFor(null, 1)).toBeUndefined();
});

// Not "the last one plus one": the reader may jump around, and the gap is what
// is actually left to do.
test("the next chapter is the lowest one with no decision", () => {
  expect(nextChapter(chapters, null)).toBe(1);
  expect(nextChapter(chapters, plan(decision({ chapter: 2, title: "Middlegame" })))).toBe(1);
  expect(
    nextChapter(chapters, plan(decision({ chapter: 2, title: "Middlegame" }), decision())),
  ).toBe(3);
  expect(
    nextChapter(
      chapters,
      plan(
        decision(),
        decision({ chapter: 2, title: "Middlegame" }),
        decision({ chapter: 3, title: "Endings" }),
      ),
    ),
  ).toBeNull();
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
  const text = formatPlan(
    chapters,
    plan(
      decision({ figure: "[fig:3]", note: "thin on evidence" }),
      decision({ chapter: 2, title: "Middlegame", include: false, points: [] }),
    ),
  );
  expect(text).toContain("Chapter 1. Openings — in the talk");
  expect(text).toContain("the argument rests on the 1962 data");
  expect(text).toContain("figure: [fig:3]");
  expect(text).toContain("note: thin on evidence");
  expect(text).toContain("Chapter 2. Middlegame — cut");
  expect(text).toContain("Next up: chapter 3");
});

// The record is read in the order the talk holds it, not sorted back into
// chapter order: the reader may have moved an entry, and the model has to see
// the talk as it now stands.
test("the record keeps the order it was given in", () => {
  const text = formatPlan(
    chapters,
    plan(decision({ chapter: 3, title: "Endings" }), decision({ chapter: 1 })),
  );
  expect(text.indexOf("Chapter 3.")).toBeLessThan(text.indexOf("Chapter 1."));
});

test("a finished rehearsal is told not to walk the chapters again", () => {
  const text = formatPlan(chapters, plan(...chapters.map((c) => decision({ chapter: c.index, title: c.title }))));
  expect(text).toContain("Every chapter has a decision");
  expect(text).not.toContain("Next up");
});

// formatOutline is what read_talk_outline reads back to the reader, so unlike
// formatPlan it carries no instruction about what the model should do next.
test("formatOutline lists what is in, what was cut, and what is not settled", () => {
  const text = formatOutline(
    chapters,
    plan(
      decision({ chapter: 1, points: ["p one", "p two"], figure: "fig:3" }),
      decision({ chapter: 2, title: "Middlegame", include: false, points: [], note: "thin" }),
    ),
  );
  expect(text).toContain("1 chapter(s), 2 point(s)");
  expect(text).toContain("p one");
  expect(text).toContain("figure: fig:3");
  expect(text).toContain("2. Middlegame — thin");
  expect(text).toContain("Not settled yet: 3. Endings.");
  expect(text).not.toContain("Next up");
});

test("formatOutline says there is no outline before the first decision", () => {
  expect(formatOutline(chapters, null)).toContain("No chapter has been settled yet");
  expect(formatOutline(chapters, plan())).toContain("No chapter has been settled yet");
});

test("formatOutline does not claim a talk when every settled chapter was cut", () => {
  const text = formatOutline(chapters, plan(decision({ chapter: 1, include: false, points: [] })));
  expect(text).toContain("Nothing is in the talk yet");
  expect(text).toContain("Cut:");
});

// The outline is read in the order the talk holds it, like formatPlan: a reader
// who moved an entry has to hear their talk in the order it will be given.
test("formatOutline keeps the order the talk holds", () => {
  const text = formatOutline(
    chapters,
    plan(decision({ chapter: 3, title: "Endings" }), decision({ chapter: 1 })),
  );
  expect(text.indexOf("3. Endings")).toBeLessThan(text.indexOf("1. Openings"));
});
