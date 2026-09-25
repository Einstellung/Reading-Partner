// Which row a streaming turn writes into, as rows: opening it, finding it by
// its timestamp, dropping it. What a turn does to that row once found is
// applyRowChange (ai/turn-rows.ts), the reducer the reading call runs too. No
// React, so it can be tested; useStreamingTurn.ts is the wiring that calls it.

import { holdsNoAnswer } from "../../../ai/turn-rows";
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
  return [...rows.filter((m) => !holdsNoAnswer(m)), answerRow(ts)];
}

export function answerRow(ts: number): ThreadMessage {
  return { role: "ai", text: "", ts, streaming: true };
}

export function dropAiRow(rows: readonly ThreadMessage[], ts: number): ThreadMessage[] {
  return rows.filter((m) => !(m.ts === ts && m.role === "ai"));
}
