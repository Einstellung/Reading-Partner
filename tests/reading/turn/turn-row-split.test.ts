// Which row a reading turn is writing when something is put into it mid-answer
// (src/reading/turn-row-split). Pure: the hook's reads of the live row are the
// `head` and `liveText` arguments, and the clock is passed in. Run: bun test.

import { expect, test } from "bun:test";
import { createRowSplit } from "../../../src/reading/turn/turn-row-split";

const at = (ms: number) => () => ms;

test("a turn nobody spoke into stays on its first row and answers with the whole text", () => {
  const rows = createRowSplit();
  rows.start(1000);
  expect(rows.writing(at(2000))).toEqual({ ts: 1000 });
  expect(rows.writing(at(3000))).toEqual({ ts: 1000 });
  expect(rows.origin).toBeNull();
  expect(rows.answerTail("The whole answer.", "The whole answer.")).toBe("The whole answer.");
  // Written even when empty: an unsteered turn always settles its row.
  expect(rows.answerTail("", "")).toBe("");
});

test("a steer mid-answer puts the row above in the file and opens a new row on the next write", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.writing(at(1500));
  expect(rows.steered("First part.")).toEqual({ text: "First part.", ts: 1000 });
  // Not split yet: nothing has been written since the model took the line.
  expect(rows.ts).toBe(1000);
  expect(rows.writing(at(2000))).toEqual({ ts: 2000, split: { was: 1000, origin: null } });
  expect(rows.writing(at(2500))).toEqual({ ts: 2000 });
  expect(rows.answerTail("First part.\n\nThe answer.", "The answer.")).toBe("The answer.");
});

test("a steer before the model wrote a word leaves the row where it is", () => {
  const rows = createRowSplit();
  rows.start(1000);
  expect(rows.steered("")).toBeNull();
  expect(rows.writing(at(2000))).toEqual({ ts: 1000 });
  expect(rows.answerTail("  The answer.", "The answer.")).toBe("The answer.");
});

test("a split row is keyed after the row it follows even when the clock is behind", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.steered("Above.");
  expect(rows.writing(at(900))).toEqual({ ts: 1001, split: { was: 1000, origin: null } });
});

test("a delivered run mid-answer opens a row marked with the run", () => {
  const rows = createRowSplit();
  rows.start(1000);
  expect(rows.delivered("Looking into it.", "run-1")).toEqual({ text: "Looking into it.", ts: 1000 });
  expect(rows.origin).toBeNull();
  expect(rows.writing(at(2000))).toEqual({ ts: 2000, split: { was: 1000, origin: { runId: "run-1" } } });
  expect(rows.origin).toEqual({ runId: "run-1" });
  expect(rows.answerTail("Looking into it.\n\nHere is what came back.", "Here is what came back.")).toBe(
    "Here is what came back.",
  );
  // The next split is an ordinary row again.
  rows.steered("Here is what came back.");
  expect(rows.writing(at(3000))).toEqual({ ts: 3000, split: { was: 2000, origin: null } });
  expect(rows.origin).toBeNull();
});

test("a delivered run before a word was written marks the row in place", () => {
  const rows = createRowSplit();
  rows.start(1000);
  expect(rows.delivered("", "run-1")).toBeNull();
  expect(rows.origin).toEqual({ runId: "run-1" });
  expect(rows.writing(at(2000))).toEqual({ ts: 1000 });
});

test("a row marked with a run keeps its mark when a steer puts it in the file", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.delivered("", "run-1");
  rows.writing(at(1500));
  expect(rows.steered("The translation is in.")).toEqual({
    text: "The translation is in.",
    ts: 1000,
    origin: { runId: "run-1" },
  });
  expect(rows.writing(at(2000))).toEqual({ ts: 2000, split: { was: 1000, origin: null } });
});

test("a row marked with a run keeps its mark when a second delivery puts it in the file", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.delivered("", "run-1");
  rows.writing(at(1500));
  expect(rows.delivered("The translation is in.", "run-2")).toEqual({
    text: "The translation is in.",
    ts: 1000,
    origin: { runId: "run-1" },
  });
  expect(rows.writing(at(2000))).toEqual({ ts: 2000, split: { was: 1000, origin: { runId: "run-2" } } });
});

test("two steers drained at the same boundary write the row above once and split once", () => {
  const rows = createRowSplit();
  rows.start(1000);
  expect(rows.steered("Above.")).toEqual({ text: "Above.", ts: 1000 });
  expect(rows.steered("Above.")).toBeNull();
  expect(rows.writing(at(2000))).toEqual({ ts: 2000, split: { was: 1000, origin: null } });
  expect(rows.writing(at(2100))).toEqual({ ts: 2000 });
  expect(rows.answerTail("Above.\n\nAnswer.", "Answer.")).toBe("Answer.");
});

test("two steers a round apart split twice and leave the last row's text as the tail", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.steered("One.");
  rows.writing(at(2000));
  expect(rows.steered("Two.")).toEqual({ text: "Two.", ts: 2000 });
  expect(rows.writing(at(3000))).toEqual({ ts: 3000, split: { was: 2000, origin: null } });
  expect(rows.answerTail("One.\n\nTwo.\n\nThree.", "Three.")).toBe("Three.");
});

test("a second steer right after a split, before the new row has text, does not split again", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.steered("One.");
  rows.writing(at(2000));
  expect(rows.steered("")).toBeNull();
  expect(rows.writing(at(3000))).toEqual({ ts: 2000 });
});

test("a turn that ends after a steer with nothing written after it leaves no new row and hands over", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.steered("Above.");
  // Stopped or finished here: nothing called writing, so the pending split
  // never opened a row and every ending lands on the row that exists.
  expect(rows.ts).toBe(1000);
  expect(rows.answerTail("Above.", "Above.")).toBeNull();
});

test("a turn stopped after a split ends on the new row", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.steered("Above.");
  rows.writing(at(2000));
  expect(rows.ts).toBe(2000);
  expect(rows.answerTail("Above.\n\nPartial", "Partial")).toBe("Partial");
});

test("a tail the joined rows do not prefix falls back to what arrived in the row", () => {
  const rows = createRowSplit();
  rows.start(1000);
  rows.steered("Above.");
  rows.writing(at(2000));
  expect(rows.answerTail("Something else entirely.", "  What arrived.  ")).toBe("What arrived.");
  expect(rows.answerTail("Something else entirely.", "   ")).toBeNull();
});
