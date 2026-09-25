// Which row a streaming turn writes into (src/ui/components/chat/streaming-turn.ts):
// opening the answer row, finding it by timestamp, dropping it. What the turn
// does to that row is applyRowChange, tested in tests/ai/turn-rows-change.test.ts.
// Pure — no React. Run: bun test.

import { expect, test } from "bun:test";
import {
  dropAiRow,
  openAnswerRow,
  patchAiRow,
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
