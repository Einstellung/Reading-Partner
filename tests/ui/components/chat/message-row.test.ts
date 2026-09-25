// What an AI row is drawn as (src/ui/components/chat/message-row.ts). The
// rendering of each shape is covered by budget-notice, tool-trace-position and
// card-registry-context; this is which shape a row gets. Run: bun test.

import { expect, test } from "bun:test";
import type { Receipt, ToolStatus } from "../../../../src/ai/tool-status";
import type { ChatPart } from "../../../../src/ui/components/chat/chatParts";
import { messageRowLayout } from "../../../../src/ui/components/chat/message-row";

const running: ToolStatus = { name: "search", label: "Searching", state: "running" };
const quiet: ToolStatus = { name: "note", label: "Noting", state: "done", quiet: true };
const receipt: Receipt = { label: "Added an observation", summary: "x" };

const text = (t: string): ChatPart => ({ type: "text", text: t });
const trace = (...tools: ToolStatus[]): ChatPart => ({ type: "tool-trace", tools });
const ticket: ChatPart = { type: "receipt", receipt, toolName: "note" };
const aside = (id: string): ChatPart => ({
  type: "card",
  id,
  card: { kind: "aside" } as Extract<ChatPart, { type: "card" }>["card"],
});
const other = (id: string): ChatPart => ({
  type: "card",
  id,
  card: { kind: "add-source" } as unknown as Extract<ChatPart, { type: "card" }>["card"],
});

test("a card row stands alone, and is a footnote only when every card is an aside", () => {
  const onlyAside = messageRowLayout([aside("a"), text("hi"), trace(running)], { failed: true });
  expect(onlyAside).toMatchObject({ kind: "cards", footnote: true });
  expect(messageRowLayout([aside("a"), other("b")], {})).toMatchObject({ kind: "cards", footnote: false });
});

test("a failure is drawn as one unless the row carries a notice", () => {
  expect(messageRowLayout([text("boom")], { failed: true })).toEqual({ kind: "failed" });
  expect(messageRowLayout([], { failed: true, notice: "Left out 3 pages" })).toEqual({
    kind: "stack",
    tickets: [],
    tools: null,
    notice: "Left out 3 pages",
  });
});

test("while streaming with no words, the trace is the status line, else the phase", () => {
  expect(messageRowLayout([trace(running)], { streaming: true })).toEqual({
    kind: "trace",
    tools: [running],
  });
  expect(messageRowLayout([], { streaming: true })).toEqual({ kind: "phase" });
  // A trace of nothing but quiet calls is no trace.
  expect(messageRowLayout([trace(quiet)], { streaming: true })).toEqual({ kind: "phase" });
  // Records of the turn stack above the trace; a notice waits for the end.
  expect(messageRowLayout([ticket, trace(running)], { streaming: true, notice: "n" })).toEqual({
    kind: "stack",
    tickets: [ticket],
    tools: [running],
    notice: null,
  });
});

test("a settled turn with no words is its records, its trace and its notice", () => {
  expect(messageRowLayout([], {})).toEqual({ kind: "empty" });
  expect(messageRowLayout([text("")], {})).toEqual({ kind: "empty" });
  expect(messageRowLayout([trace(running)], {})).toEqual({ kind: "trace", tools: [running] });
  expect(messageRowLayout([ticket], {})).toEqual({
    kind: "stack",
    tickets: [ticket],
    tools: null,
    notice: null,
  });
});

test("a reply carries its notice and Copy only once it has settled", () => {
  const parts = [text("answer"), ticket, trace(running, quiet)];
  expect(messageRowLayout(parts, { notice: "n" })).toEqual({
    kind: "reply",
    textPart: { type: "text", text: "answer" },
    tickets: [ticket],
    tools: [running, quiet],
    notice: "n",
    copy: true,
  });
  expect(messageRowLayout(parts, { streaming: true, notice: "n" })).toMatchObject({
    kind: "reply",
    notice: null,
    copy: false,
  });
});
