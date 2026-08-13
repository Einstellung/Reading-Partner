// The rehearsal's compression ladder (src/reading/talks/ladder.ts): what a talk
// turn gives up when it does not fit the window, in what order, and what the
// reader is told for it. Same contract as the reading ladder, different
// material. Run: bun test.

import { expect, test } from "bun:test";
import { PI_CONTEXT_SAFETY_TOKENS } from "../../../src/budget/estimate";
import { planReductions } from "../../../src/budget";
import { TALK_LADDER, type TalkReductionId } from "../../../src/reading/talks/ladder";

const WINDOW = 200_000;
const FITS_AT = WINDOW - PI_CONTEXT_SAFETY_TOKENS - 4096;

const EVEN: Record<TalkReductionId, number> = {
  "figure-catalog": 5_000,
  "observation-trim": 5_000,
  "rehearsal-notes": 5_000,
  "tool-result-stubs": 5_000,
  "rehearsal-marks": 5_000,
  "history-trim": 5_000,
};

function plan(used: number) {
  return planReductions<TalkReductionId>({
    rungs: TALK_LADDER,
    contextWindow: WINDOW,
    purpose: "chat",
    used,
    floorTokens: 10_000,
    savings: EVEN,
  });
}

test("the talk ladder's order and its wording are pinned", () => {
  expect(TALK_LADDER.map((r) => [r.id, r.notice ?? ""])).toEqual([
    ["figure-catalog", ""],
    ["observation-trim", ""],
    ["rehearsal-notes", ""],
    ["tool-result-stubs", ""],
    [
      "rehearsal-marks",
      "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again",
    ],
    ["history-trim", "earlier turns of this conversation were left out to make room"],
  ]);
});

// The rehearsal's inlined chapter note is tier 2 like the tool results:
// read_chapter_note fetches it straight back, so it goes without a word, and it
// goes before the results the model asked for itself.
test("the chapter note goes silently, ahead of the tool results", () => {
  const p = plan(FITS_AT + 11_000);
  expect(p.apply[p.apply.length - 1]).toBe("rehearsal-notes");
  expect(p.apply).not.toContain("tool-result-stubs");
  expect(p.notice).toBe("");
});

// The reader's own marks are evidence, so shortening them is said out loud — and
// the line says how to get them back, because read_annotations really can.
test("shortening the reader's marks is told to the reader", () => {
  const p = plan(FITS_AT + 21_000);
  expect(p.apply[p.apply.length - 1]).toBe("rehearsal-marks");
  expect(p.apply).not.toContain("history-trim");
  expect(p.notice).toBe(
    "Note: your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again.",
  );
});

test("history is the last thing given up here too", () => {
  const p = plan(FITS_AT + 26_000);
  expect(p.apply[p.apply.length - 1]).toBe("history-trim");
  expect(p.notice).toBe(
    "Note: your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again; " +
      "earlier turns of this conversation were left out to make room.",
  );
});

// Both the marks and the inlined note are large enough to distort the pricing of
// the small rungs above them, so both are held out of the baseline.
test("the rungs that are not priced like the rest say so on the table", () => {
  const priced = Object.fromEntries(TALK_LADDER.map((r) => [r.id, r.price ?? "prompt"]));
  expect(priced).toEqual({
    "figure-catalog": "prompt",
    "observation-trim": "prompt",
    "rehearsal-notes": "bulk",
    "tool-result-stubs": "none",
    "rehearsal-marks": "bulk",
    "history-trim": "messages",
  });
});
