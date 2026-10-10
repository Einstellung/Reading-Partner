// A durable turn's projected view as call rows (reading/turn/book-turn-rows.ts)
// and the reducer action that puts them on screen (reading/turn/call-state.ts
// "turn-rows"): rows after the reader's line are replaced, rows that did not
// change keep their identity so only the streaming row re-renders.

import { expect, test } from "bun:test";
import { viewRows } from "../../../src/reading/turn/book-turn-rows";
import { callReducer, type CallRow, type CallState } from "../../../src/reading/turn/call-state";
import type { TurnView } from "../../../src/reading/turn/durable-view";

const view = (text: string): TurnView => ({
  busy: true,
  phase: "writing",
  rows: [
    {
      role: "ai",
      ts: 2001,
      text: "Pages read.",
      streaming: false,
      tools: [{ callId: "c1", name: "read_pages", label: "Reading pages", state: "done" }],
    },
    { role: "user", ts: 5000, text: "Shorter", queued: false },
    { role: "ai", ts: 5001, text, tools: [], streaming: true },
    { role: "user", ts: 6000, text: "And the sun?", queued: true },
  ],
});

test("a view maps to rows: tools as statuses, the phase on the streaming row, the queued mark", () => {
  expect(viewRows(view("The moon"))).toEqual([
    { role: "ai", ts: 2001, text: "Pages read.", tools: [{ name: "read_pages", label: "Reading pages", state: "done" }] },
    { role: "user", ts: 5000, text: "Shorter" },
    { role: "ai", ts: 5001, text: "The moon", streaming: true, phase: "writing" },
    { role: "user", ts: 6000, text: "And the sun?", queued: true },
  ]);
});

test("turn-rows replaces the rows after the reader's line and keeps the unchanged ones", () => {
  const line: CallRow = { role: "user", text: "Why tides?", ts: 1000 };
  const placeholder: CallRow = { role: "ai", text: "", ts: 1500, streaming: true };
  let state: CallState<CallRow> | null = {
    threadId: "t1",
    annotationId: "a1",
    view: "chat-main",
    anchor: { x: 0, y: 0 },
    messages: [line, placeholder],
  };
  state = callReducer(state, { type: "turn-rows", threadId: "t1", after: 1000, rows: viewRows(view("The")) });
  const first = state!.messages;
  expect(first[0]).toBe(line);
  expect(first.map((m) => m.ts)).toEqual([1000, 2001, 5000, 5001, 6000]);
  state = callReducer(state, { type: "turn-rows", threadId: "t1", after: 1000, rows: viewRows(view("The moon")) });
  const second = state!.messages;
  expect(second[1]).toBe(first[1]!);
  expect(second[2]).toBe(first[2]!);
  expect(second[3]).not.toBe(first[3]!);
  expect(second[3]?.text).toBe("The moon");
  expect(second[4]).toBe(first[4]!);
  expect(callReducer(state, { type: "turn-rows", threadId: "other", after: 1000, rows: [] })).toBe(state);
});
