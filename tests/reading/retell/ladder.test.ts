// The retell's compression ladder (src/reading/retell/ladder.ts): what a retell
// turn gives up when it does not fit the window, in what order, and what the
// reader is told for it. Same contract as the reading ladder, different
// material. Run: bun test.

import { expect, test } from "bun:test";
import { PI_CONTEXT_SAFETY_TOKENS } from "../../../src/budget/estimate";
import { planReductions } from "../../../src/budget";
import { RETELL_LADDER, type RetellReductionId } from "../../../src/reading/retell/ladder";

const WINDOW = 200_000;
const FITS_AT = WINDOW - PI_CONTEXT_SAFETY_TOKENS - 4096;

const EVEN: Record<RetellReductionId, number> = {
  "figure-catalog": 5_000,
  "observation-trim": 5_000,
  "prep-notes-trim": 5_000,
  "retell-notes": 5_000,
  "tool-result-stubs": 5_000,
  "retell-marks": 5_000,
  "history-trim": 5_000,
};

function plan(used: number) {
  return planReductions<RetellReductionId>({
    rungs: RETELL_LADDER,
    contextWindow: WINDOW,
    purpose: "chat",
    used,
    floorTokens: 10_000,
    savings: EVEN,
  });
}

test("the retell ladder's order and its wording are pinned", () => {
  expect(RETELL_LADDER.map((r) => [r.id, r.notice ?? ""])).toEqual([
    ["figure-catalog", ""],
    ["observation-trim", ""],
    ["prep-notes-trim", "some of my notes on the reference papers were left out to make room"],
    ["retell-notes", ""],
    ["tool-result-stubs", ""],
    [
      "retell-marks",
      "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again",
    ],
    ["history-trim", "earlier turns of this conversation were left out to make room"],
  ]);
});

// The reference papers' notes are the first of tier 2 and the largest thing on
// it, and they are trimmed rather than dropped — the prep list stays in the
// prompt naming every slug, and read_note hands any of them back whole. Said out
// loud anyway: which papers the retell was run against is the reader's business.
test("the papers' notes go first of tier 2, and the reader is told", () => {
  const p = plan(FITS_AT + 11_000);
  expect(p.apply[p.apply.length - 1]).toBe("prep-notes-trim");
  expect(p.apply).not.toContain("retell-notes");
  expect(p.notice).toBe("Note: some of my notes on the reference papers were left out to make room.");
});

// The retell's inlined chapter note is tier 2 like the tool results:
// read_chapter_note fetches it straight back, so it goes without a word, and it
// goes before the results the model asked for itself.
test("the chapter note goes silently, ahead of the tool results", () => {
  const p = plan(FITS_AT + 16_000);
  expect(p.apply[p.apply.length - 1]).toBe("retell-notes");
  expect(p.apply).not.toContain("tool-result-stubs");
});

// The reader's own marks are evidence, so shortening them is said out loud — and
// the line says how to get them back, because read_annotations really can.
test("shortening the reader's marks is told to the reader", () => {
  const p = plan(FITS_AT + 26_000);
  expect(p.apply[p.apply.length - 1]).toBe("retell-marks");
  expect(p.apply).not.toContain("history-trim");
  expect(p.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room; " +
      "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again.",
  );
});

test("history is the last thing given up here too", () => {
  const p = plan(FITS_AT + 31_000);
  expect(p.apply[p.apply.length - 1]).toBe("history-trim");
  expect(p.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room; " +
      "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again; " +
      "earlier turns of this conversation were left out to make room.",
  );
});

// The marks, the inlined note and the papers' notes are each large enough to
// distort the pricing of the small rungs above them, so all three are held out of
// the baseline.
test("the rungs that are not priced like the rest say so on the table", () => {
  const priced = Object.fromEntries(RETELL_LADDER.map((r) => [r.id, r.price ?? "prompt"]));
  expect(priced).toEqual({
    "figure-catalog": "prompt",
    "observation-trim": "prompt",
    "prep-notes-trim": "bulk",
    "retell-notes": "bulk",
    "tool-result-stubs": "none",
    "retell-marks": "bulk",
    "history-trim": "messages",
  });
});
