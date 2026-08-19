// What starts preparation and which kind starts (src/reading/prep/trigger.ts).
// This is the decision about when money is spent, so every branch is pinned:
// a regression here is either a book that prepares nothing when the reader asks
// for a lecture, or a book flipped through once that quietly prepares itself.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  prepTriggerDecision,
  type PrepTriggerInput,
} from "../../../src/reading/prep/trigger";

const NOTHING = { papers: false, chapters: false } as const;

function decide(over: Partial<PrepTriggerInput> = {}) {
  return prepTriggerDecision({
    trigger: "mark",
    textReady: true,
    marked: true,
    presence: { ...NOTHING, shape: "book" },
    ...over,
  });
}

test("no readable text starts nothing, whichever trigger fired", () => {
  expect(decide({ textReady: false })).toEqual({ start: false, why: "no-text" });
  expect(decide({ trigger: "entry", textReady: false })).toEqual({ start: false, why: "no-text" });
});

// The mark gate: a mark is what says the document is being read rather than
// glanced at. Without it the trigger would fire on nothing.
test("a mark trigger with no marks in the document starts nothing", () => {
  expect(decide({ marked: false })).toEqual({ start: false, why: "unmarked" });
});

test("a mark trigger with a mark starts the run", () => {
  expect(decide({ marked: true })).toEqual({ start: true, kind: "chapters" });
});

// The hole this closes: a book nobody had ever marked answered the lecture
// entry with nothing prepared, because the only trigger was the mark gate.
test("the entry starts the run on a document with no marks at all", () => {
  expect(decide({ trigger: "entry", marked: false })).toEqual({ start: true, kind: "chapters" });
});

// A run already going is picked up by the mark trigger even with the marks
// deleted since: the spend was agreed to once, and half a document's material is
// worth less than all of it.
test("an existing run is picked up by the mark trigger despite no marks", () => {
  expect(decide({ marked: false, presence: { papers: false, chapters: true, shape: "book" } })).toEqual(
    { start: true, kind: "chapters" },
  );
  expect(decide({ marked: false, presence: { papers: true, chapters: false, shape: "paper" } })).toEqual(
    { start: true, kind: "papers" },
  );
});

// The split neither trigger gets to argue with: the document decides which kind
// of material it gets, the trigger only decides whether to start it.
test("both triggers route a paper to papers and a book to chapters", () => {
  for (const trigger of ["mark", "entry"] as const) {
    expect(decide({ trigger, presence: { ...NOTHING, shape: "paper" } })).toEqual({
      start: true,
      kind: "papers",
    });
    expect(decide({ trigger, presence: { ...NOTHING, shape: "book" } })).toEqual({
      start: true,
      kind: "chapters",
    });
    // Too little text to measure: chapters, the dead end that costs a plan call
    // and finds no chapters, rather than a round of paper downloads.
    expect(decide({ trigger, presence: { ...NOTHING, shape: "unknown" } })).toEqual({
      start: true,
      kind: "chapters",
    });
  }
});

// Both triggers land on the same answer for the same document, which is what
// lets the caller reach for one idempotent ensureStarted and never start twice.
test("the two triggers never disagree about which kind runs", () => {
  for (const shape of ["paper", "book", "unknown"] as const) {
    for (const papers of [false, true]) {
      for (const chapters of [false, true]) {
        const presence = { papers, chapters, shape };
        const mark = prepTriggerDecision({ trigger: "mark", textReady: true, marked: true, presence });
        const entry = prepTriggerDecision({ trigger: "entry", textReady: true, marked: true, presence });
        expect(entry).toEqual(mark);
      }
    }
  }
});
