// Receipts and dispatch tickets are derived, not stored (docs/72): the thread
// file keeps the trace, and these parts are read back off it every time the row
// is drawn. What this holds down is that derivation — which calls produce a
// part, which kind of part, and where it lands in the row.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { messageToParts } from "../../../../src/ui/components/chat/chatParts";
import { deliveredRunIds } from "../../../../src/ui/components/chat/deliveredRuns";
import type { ToolStatus } from "../../../../src/ai/tool-status";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

function row(tools: ToolStatus[], text = "Noted."): ThreadMessage {
  return { role: "ai", text, ts: 1, tools };
}

const wrote: ToolStatus = {
  name: "observation_update",
  label: "Writing it down",
  state: "done",
  receipt: { label: "Added an observation", summary: "They read the epilogue first." },
};

const sent: ToolStatus = {
  name: "delegate",
  label: "Handing this to a literature worker",
  state: "done",
  receipt: {
    label: "Sent off literature work",
    summary: "Find what has been published on inline caches.",
    link: { kind: "run", id: "run-7" },
  },
};

test("a done call that reported a receipt becomes a receipt part", () => {
  const parts = messageToParts(row([wrote]));
  expect(parts.map((p) => p.type)).toEqual(["text", "receipt", "tool-trace"]);
  const receipt = parts[1];
  expect(receipt.type === "receipt" && receipt.receipt.label).toBe("Added an observation");
  expect(receipt.type === "receipt" && receipt.toolName).toBe("observation_update");
});

test("a receipt pointing at a run becomes a dispatch part instead", () => {
  const parts = messageToParts(row([sent]));
  const ticket = parts[1];
  expect(ticket.type).toBe("dispatch");
  expect(ticket.type === "dispatch" && ticket.runId).toBe("run-7");
  // The receipt rides along: it is what was written at the moment of sending,
  // and the run file has no copy of it.
  expect(ticket.type === "dispatch" && ticket.receipt.summary).toStartWith("Find what");
});

test("only settled calls that reported something are derived", () => {
  const running: ToolStatus = { name: "read_chapter", label: "Reading", state: "running" };
  const read: ToolStatus = { name: "recall", label: "Remembering", state: "done" };
  const broke: ToolStatus = {
    name: "statement_write",
    label: "Writing it down",
    state: "error",
    error: "the disk is full",
    receipt: { label: "Wrote a statement", summary: "never got there" },
  };
  const parts = messageToParts(row([running, read, broke]));
  expect(parts.map((p) => p.type)).toEqual(["text", "tool-trace"]);
});

test("several receipts keep the order the calls finished in", () => {
  const parts = messageToParts(row([sent, wrote]));
  expect(parts.map((p) => p.type)).toEqual(["text", "dispatch", "receipt", "tool-trace"]);
});

test("the parts come back untouched when a row derives nothing", () => {
  const m: ThreadMessage = {
    role: "ai",
    text: "Here.",
    ts: 1,
    parts: [{ type: "text", text: "Here." }],
  };
  expect(messageToParts(m)).toBe(m.parts!);
});

test("a stored trace derives its receipts the same way a live one does", () => {
  const m: ThreadMessage = {
    role: "ai",
    text: "Noted.",
    ts: 1,
    parts: [
      { type: "text", text: "Noted." },
      { type: "tool-trace", tools: [wrote] },
    ],
  };
  expect(messageToParts(m).map((p) => p.type)).toEqual(["text", "receipt", "tool-trace"]);
});

test("the answers a thread already holds are the rows that carry an origin", () => {
  const messages: ThreadMessage[] = [
    { role: "user", text: "look this up", ts: 1 },
    { role: "ai", text: "Sent it off.", ts: 2 },
    { role: "ai", text: "Back with an answer.", ts: 3, origin: { runId: "run-7" } },
  ];
  expect([...deliveredRunIds(messages)]).toEqual(["run-7"]);
  expect(deliveredRunIds(messages).has("run-9")).toBe(false);
});
