// The row arithmetic a streaming turn does (src/ui/components/chat/streaming-turn.ts):
// opening the answer row, the deltas and the tool trace, the finished reply.
// Pure — no React. Run: bun test.

import { expect, test } from "bun:test";
import {
  answeredRow,
  dropAiRow,
  openAnswerRow,
  patchAiRow,
  withDelta,
  withPhase,
  withToolEnd,
  withToolStart,
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

test("withDelta appends to the text already streamed", () => {
  expect(withDelta(ai(1, "he"), "llo").text).toBe("hello");
});

test("the phase follows the turn: thinking, then the tool, then the reply", () => {
  const thinking = withPhase(ai(1), "thinking");
  expect(thinking.phase).toBe("thinking");
  const calling = withToolStart(thinking, { name: "read_talk_outline", args: {} });
  expect(calling.phase).toBe("tool");
  expect(withDelta(calling, "so").phase).toBe("writing");
});

test("the answer clears the phase", () => {
  const row = withPhase(ai(1, "", { streaming: true }), "thinking");
  expect(answeredRow(row, "done", 1).phase).toBeUndefined();
});

test("withToolStart keeps what the round wrote and puts the tool on the trace as running", () => {
  const next = withToolStart(ai(1, "let me look"), { name: "read_talk_outline", args: {} });
  expect(next.text).toBe("let me look\n\n");
  expect(next.tools).toEqual([
    { name: "read_talk_outline", label: expect.any(String), state: "running" },
  ]);
});

test("withToolStart opens no gap on a round that wrote nothing", () => {
  expect(withToolStart(ai(1), { name: "read_talk_outline", args: {} }).text).toBe("");
});

test("withToolEnd takes a finished tool off the trace and marks a failed one", () => {
  const started = withToolStart(ai(1), { name: "read_talk_outline", args: {} });
  expect(withToolEnd(started, { name: "read_talk_outline", resultPreview: "", isError: false }).tools)
    .toEqual([]);
  expect(
    withToolEnd(started, { name: "read_talk_outline", resultPreview: "", isError: true }).tools,
  ).toEqual([{ name: "read_talk_outline", label: expect.any(String), state: "error" }]);
});

test("withToolEnd leaves the row alone when nothing of that name is running", () => {
  const row = ai(1, "text");
  expect(withToolEnd(row, { name: "absent", resultPreview: "", isError: false })).toBe(row);
});

test("answeredRow keeps only the failed tools and carries the notice when there is one", () => {
  const row = ai(1, "partial", {
    streaming: true,
    tools: [
      { name: "a", label: "A", state: "running" },
      { name: "b", label: "B", state: "error" },
    ],
  });
  expect(answeredRow(row, "the whole answer", 1)).toEqual({
    role: "ai",
    text: "the whole answer",
    ts: 1,
    tools: [{ name: "b", label: "B", state: "error" }],
  });
  expect(answeredRow(row, "x", 1, "left out chapter 3").notice).toBe("left out chapter 3");
});
