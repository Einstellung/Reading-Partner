// The row arithmetic of a streaming turn: what the answer row looks like at
// every step between "the turn started" and "the turn landed". No React, so it
// can be tested; useStreamingTurn.ts is the wiring that calls it.

import { appendRunningTool, resolveToolStatus } from "../../../ai/tool-status";
import type { AgentToolEnd, AgentToolStart } from "../../../legion/execute/contract";
import { holdsNoAnswer } from "../../../ai/turn-rows";
import { toolStatusLabel } from "../../../reading/context";
import type { ThreadMessage } from "./types";

// Only the AI row at `ts` is rewritten; a user row that happens to share the
// timestamp is left alone.
export function patchAiRow(
  rows: readonly ThreadMessage[],
  ts: number,
  fn: (m: ThreadMessage) => ThreadMessage,
): ThreadMessage[] {
  return rows.map((m) => (m.ts === ts && m.role === "ai" ? fn(m) : m));
}

// The empty row the answer streams into. Rows holding no answer — a previous
// failure, a refusal — are dropped: the turn being started is their retry.
export function openAnswerRow(rows: readonly ThreadMessage[], ts: number): ThreadMessage[] {
  return [...rows.filter((m) => !holdsNoAnswer(m)), { role: "ai", text: "", ts, streaming: true }];
}

export function dropAiRow(rows: readonly ThreadMessage[], ts: number): ThreadMessage[] {
  return rows.filter((m) => !(m.ts === ts && m.role === "ai"));
}

export function withDelta(m: ThreadMessage, chunk: string): ThreadMessage {
  return { ...m, text: m.text + chunk };
}

// A tool starting clears the text: what the round wrote before calling it is
// replaced by the status line.
export function withToolStart(m: ThreadMessage, info: AgentToolStart): ThreadMessage {
  return {
    ...m,
    text: "",
    tools: appendRunningTool(m.tools, info.name, toolStatusLabel(info.name, info.args)),
  };
}

export function withToolEnd(m: ThreadMessage, info: AgentToolEnd): ThreadMessage {
  const tools = resolveToolStatus(m.tools, info.name, info.isError);
  return tools ? { ...m, tools } : m;
}

// The finished answer: the streaming flags go, and of the tool trace only what
// failed stays on screen.
export function answeredRow(
  m: ThreadMessage,
  full: string,
  ts: number,
  notice?: string,
): ThreadMessage {
  return {
    role: "ai",
    text: full,
    ts,
    tools: (m.tools ?? []).filter((t) => t.state === "error"),
    ...(notice ? { notice } : {}),
  };
}
