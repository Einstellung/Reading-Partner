// Which row a streaming turn writes into, as rows: opening it, finding it by
// its timestamp, dropping it. What a turn does to that row once found is
// applyRowChange (ai/turn-view/turn-rows.ts), the reducer the reading call runs too. No
// React, so it can be tested; useStreamingTurn.ts is the wiring that calls it.

import { applyRowChange, holdsNoAnswer } from "../../../ai/turn-view/turn-rows";
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

// --- the reader talking into the turn (docs/72) ----------------------------

// A line said while the turn runs: drawn at once under the reply, marked as not
// yet handed to the model.
export function queuedRow(ts: number, text: string): ThreadMessage {
  return { role: "user", text, ts, queued: true };
}

// The model has these lines now (or the turn ended and they are in the thread
// file as ordinary rows): their marks come off.
export function deliverRows(rows: readonly ThreadMessage[], ts: readonly number[]): ThreadMessage[] {
  const delivered = new Set(ts);
  return rows.map((m) =>
    m.role === "user" && m.queued && delivered.has(m.ts) ? { ...m, queued: undefined } : m,
  );
}

// The reply moved to a row of its own: the one at `was` is finished as it
// stands and `row` opens at the bottom, under the lines it answers.
export function splitRows(
  rows: readonly ThreadMessage[],
  was: number,
  row: ThreadMessage,
): ThreadMessage[] {
  return [...patchAiRow(rows, was, (m) => applyRowChange(m, { kind: "handed-over" })), row];
}

// A card the turn raised goes above the reply being written, not merely above
// the last row: a line the reader said into the turn can sit under the reply.
// With no such row on screen it goes above the last one (insertBeforeLast).
export function insertAbove(
  rows: readonly ThreadMessage[],
  ts: number,
  row: ThreadMessage,
): ThreadMessage[] {
  const at = rows.findIndex((m) => m.ts === ts && m.role === "ai");
  const index = at === -1 ? Math.max(rows.length - 1, 0) : at;
  return [...rows.slice(0, index), row, ...rows.slice(index)];
}
