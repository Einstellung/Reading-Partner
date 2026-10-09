// Which row a streaming turn writes into (src/ui/components/chat/streaming-turn.ts):
// opening the answer row, finding it by timestamp, dropping it. What the turn
// does to that row is applyRowChange, tested in tests/ai/turn-view/turn-rows-change.test.ts.
// Pure — no React. Run: bun test.

import { expect, test } from "bun:test";
import {
  answerRow,
  deliverRows,
  dropAiRow,
  insertAbove,
  openAnswerRow,
  patchAiRow,
  queuedRow,
  splitRows,
} from "../../../../src/ui/components/chat/streaming-turn";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

const ai = (ts: number, text = "", extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  role: "ai",
  text,
  ts,
  ...extra,
});

test("patchAiRow rewrites only the ai row at that timestamp", () => {
  const rows: ThreadMessage[] = [
    { role: "user", text: "q", ts: 1 },
    ai(1, "a"),
    ai(2, "b"),
  ];
  const next = patchAiRow(rows, 1, (m) => ({ ...m, text: "patched" }));
  expect(next.map((m) => m.text)).toEqual(["q", "patched", "b"]);
});

test("openAnswerRow appends an empty streaming row and drops what held no answer", () => {
  const rows: ThreadMessage[] = [
    { role: "user", text: "q", ts: 1 },
    ai(2, "the reply failed", { failed: true }),
  ];
  expect(openAnswerRow(rows, 9)).toEqual([
    { role: "user", text: "q", ts: 1 },
    { role: "ai", text: "", ts: 9, streaming: true },
  ]);
});

test("openAnswerRow keeps an answer that is there", () => {
  const rows: ThreadMessage[] = [ai(2, "an answer")];
  expect(openAnswerRow(rows, 9)).toHaveLength(2);
});

test("dropAiRow removes the ai row at that timestamp and nothing else", () => {
  const rows: ThreadMessage[] = [{ role: "user", text: "q", ts: 5 }, ai(5, "half")];
  expect(dropAiRow(rows, 5)).toEqual([{ role: "user", text: "q", ts: 5 }]);
});

// --- the reader talking into the turn (docs/72) ----------------------------

const user = (ts: number, text: string, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  role: "user",
  text,
  ts,
  ...extra,
});

test("deliverRows takes the queued mark off the lines named, and only theirs", () => {
  const rows = [ai(1, "a", { streaming: true }), queuedRow(2, "b"), queuedRow(3, "c")];
  expect(deliverRows(rows, [2]).map((m) => m.queued)).toEqual([undefined, undefined, true]);
});

test("splitRows finishes the row handed over and opens the reply under the lines it answers", () => {
  const rows = [user(1, "q"), ai(2, "a", { streaming: true, phase: "writing" }), user(3, "b")];
  const next = splitRows(rows, 2, answerRow(4));
  expect(next.map((m) => [m.role, m.text, m.streaming, m.phase])).toEqual([
    ["user", "q", undefined, undefined],
    ["ai", "a", undefined, undefined],
    ["user", "b", undefined, undefined],
    ["ai", "", true, undefined],
  ]);
});

test("insertAbove puts a card above the reply being written, not above a line under it", () => {
  const card = ai(9, "", { card: { kind: "probe" } as never });
  const rows = [user(1, "q"), ai(2, "", { streaming: true }), queuedRow(3, "b")];
  expect(insertAbove(rows, 2, card).map((m) => m.ts)).toEqual([1, 9, 2, 3]);
  // No reply on screen: above the last row, as insertBeforeLast.
  expect(insertAbove(rows, -1, card).map((m) => m.ts)).toEqual([1, 2, 9, 3]);
  expect(insertAbove([], -1, card).map((m) => m.ts)).toEqual([9]);
});
