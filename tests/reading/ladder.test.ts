// The reading companion's compression ladder (src/reading/ladder.ts): what a
// turn gives up when it does not fit the window, in what order, and what the
// reader is told for it.
//
// Both halves are a contract. An over-budget request comes back one token long
// with a normal `done` and no error (docs/pitfall/65), so a ladder in the wrong
// order costs the reader the wrong thing and says nothing about it, and a
// reworded clause silently changes what they are told. Pinned byte for byte.
// Run: bun test.

import { expect, test } from "bun:test";
import { PI_CONTEXT_SAFETY_TOKENS } from "../../src/budget/estimate";
import { planReductions } from "../../src/budget";
import { READING_LADDER, type ReadingReductionId } from "../../src/reading/ladder";

const WINDOW = 200_000;
const FITS_AT = WINDOW - PI_CONTEXT_SAFETY_TOKENS - 4096;

// Every rung available and worth 5,000 tokens, so the order is the only thing
// deciding which ones get used.
const EVEN: Record<ReadingReductionId, number> = {
  "figure-catalog": 5_000,
  "reader-profile": 5_000,
  "notes-overview": 5_000,
  "booklist-thin": 5_000,
  "observation-trim": 5_000,
  "page-window": 5_000,
  "tool-result-stubs": 5_000,
  "prep-notes-trim": 5_000,
  "classroom-inline": 5_000,
  "history-trim": 5_000,
};

function plan(used: number) {
  return planReductions<ReadingReductionId>({
    rungs: READING_LADDER,
    contextWindow: WINDOW,
    purpose: "chat",
    used,
    floorTokens: 10_000,
    savings: EVEN,
  });
}

test("the reading ladder's order and its wording are pinned", () => {
  expect(READING_LADDER.map((r) => [r.id, r.notice ?? ""])).toEqual([
    ["figure-catalog", ""],
    ["reader-profile", ""],
    ["notes-overview", ""],
    ["booklist-thin", ""],
    ["observation-trim", ""],
    ["page-window", ""],
    ["tool-result-stubs", ""],
    ["prep-notes-trim", "some of my notes on the reference papers were left out to make room"],
    [
      "classroom-inline",
      "the book didn't fit in context, so I read the pages I needed instead of having all of it in view",
    ],
    ["history-trim", "earlier turns of this conversation were left out to make room"],
  ]);
});

test("redundancy goes first, all of it, and without a word", () => {
  const p = plan(FITS_AT + 22_000);
  expect(p.apply).toEqual([
    "figure-catalog",
    "reader-profile",
    "notes-overview",
    "booklist-thin",
    "observation-trim",
  ]);
  expect(p.outcome).toBe("ok");
  expect(p.notice).toBe("");
});

test("tool-result stubs come after every silent drop and before any evidence", () => {
  const p = plan(FITS_AT + 31_000);
  expect(p.apply[p.apply.length - 1]).toBe("tool-result-stubs");
  // The page images around the highlight are silent too, and go before it.
  expect(p.apply).toContain("page-window");
  expect(p.apply).not.toContain("prep-notes-trim");
  expect(p.apply).not.toContain("classroom-inline");
  expect(p.notice).toBe("");
});

// The prep notes are evidence too, and go before the book: the survey is the
// syllabus every citation is anchored to, while a note left out is still
// reachable whole by read_note. Told to the reader all the same — which notes
// the class was taught from is theirs to know.
test("the prep notes are given up before the book, and are told to the reader", () => {
  const p = plan(FITS_AT + 36_000);
  expect(p.apply[p.apply.length - 1]).toBe("prep-notes-trim");
  expect(p.apply).not.toContain("classroom-inline");
  expect(p.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room.",
  );
});

test("dropping the inlined book is told to the reader", () => {
  const p = plan(FITS_AT + 41_000);
  expect(p.apply[p.apply.length - 1]).toBe("classroom-inline");
  expect(p.apply).not.toContain("history-trim");
  expect(p.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room; " +
      "the book didn't fit in context, so I read the pages I needed instead of having all of it in view.",
  );
});

// history-trim is last on purpose: the fallback distillation that is supposed to
// preserve an older stretch of thread is fired and forgotten, so a trim before
// it lands is a straight loss of the conversation.
test("history is the last thing given up, and it is told to the reader", () => {
  const p = plan(FITS_AT + 46_000);
  expect(p.apply[p.apply.length - 1]).toBe("history-trim");
  expect(p.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room; " +
      "the book didn't fit in context, so I read the pages I needed instead of having all of it in view; " +
      "earlier turns of this conversation were left out to make room.",
  );
});

// Pricing is a property of the rung, not of the caller: the inlined survey and
// the prep notes are an order of magnitude bigger than everything above them, so
// they are measured against the full prompt rather than alongside the small
// rungs, and the tool results are never priced here at all because the agent loop
// applies them mid-turn.
test("the rungs that are not priced like the rest say so on the table", () => {
  const priced = Object.fromEntries(READING_LADDER.map((r) => [r.id, r.price ?? "prompt"]));
  expect(priced).toEqual({
    "figure-catalog": "prompt",
    "reader-profile": "prompt",
    "notes-overview": "prompt",
    "booklist-thin": "prompt",
    "observation-trim": "prompt",
    "page-window": "messages",
    "tool-result-stubs": "none",
    "prep-notes-trim": "bulk",
    "classroom-inline": "bulk",
    "history-trim": "messages",
  });
});
