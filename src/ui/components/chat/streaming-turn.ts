// The row arithmetic of a streaming turn: what the answer row looks like at
// every step between "the turn started" and "the turn landed". No React, so it
// can be tested; useStreamingTurn.ts is the wiring that calls it.

import { appendRunningTool, resolveToolStatus } from "../../../ai/tool-status";
import type { AgentToolEnd, AgentToolStart } from "../../../legion/execute/contract";
import { appendRoundBreak, holdsNoAnswer, phaseOnToolStart, type TurnPhase } from "../../../ai/turn-rows";
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

// The model is reasoning with nothing written yet: the row has a status line to
// draw and no text to show for it.
export function withPhase(m: ThreadMessage, phase: TurnPhase): ThreadMessage {
  return { ...m, phase };
}

export function withDelta(m: ThreadMessage, chunk: string): ThreadMessage {
  return { ...m, text: m.text + chunk, phase: "writing" };
}

// What the round wrote before calling the tool stays where it is, with a blank
// line opened under it for the next round (docs/pitfall/291). The status line is
// drawn in that gap and comes off when the tool returns — a quiet call draws
// none and leaves the phase where it was (turn-rows.ts).
export function withToolStart(m: ThreadMessage, info: AgentToolStart): ThreadMessage {
  return {
    ...m,
    text: appendRoundBreak(m.text),
    phase: phaseOnToolStart(m.phase, info.quiet),
    tools: appendRunningTool(m.tools, info.name, info.label, info.quiet),
  };
}

export function withToolEnd(m: ThreadMessage, info: AgentToolEnd): ThreadMessage {
  const tools = resolveToolStatus(m.tools, info.name, info.isError, {
    ...(info.receipt ? { receipt: info.receipt } : {}),
    ...(info.error ? { error: info.error } : {}),
  });
  return tools ? { ...m, tools } : m;
}

// The finished answer: the streaming flags go and the tool trace stays, settled
// — a grey line saying what was done, red where something failed.
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
    tools: [...(m.tools ?? [])],
    ...(notice ? { notice } : {}),
  };
}
