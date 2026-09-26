// How a chat row ends when the loop stops without an answer. Two endings, and
// they are not the same thing:
//
//   error   — the model could not be reached. The words stand in for the reply
//             that never came, so they go in `text`, the row is marked failed,
//             and a retry is worth offering where the surface has one.
//   refusal — the loop declined: the call outgrew the context window, or it
//             spent its round cap on tools without answering (agent.ts).
//             Nothing failed and nothing is worth retrying — the same inputs are
//             declined the same way. The sentence is the app talking about the
//             turn, so it goes in `notice` (chat/types) and never in `text`:
//             `text` is the model's words, and every surface replays it as the
//             assistant's own on the next turn.
//
// Kept out of the render layer so every chat surface can end a turn the same way
// (the reading session, useRetell and the info companion all do), and reachable
// from a domain: this is what an agent turn's ending is, not how a row is drawn.
// The rows are taken structurally, so each surface keeps its own row type.

import type { MessageOrigin } from "../platform/app/threads";
import {
  appendRunningTool,
  relabelRunningTool,
  resolveToolStatus,
  type Receipt,
  type ToolStatus,
} from "./tool-status";

// What a turn is doing right now, for the one status line a row draws where the
// reply will appear. Only while the turn runs — every ending clears it:
//
//   thinking — the model is reasoning and nothing is on screen yet. Extended
//              thinking streams for tens of seconds before the first word, and
//              the raw thinking is never shown, so the line is all there is.
//   tool     — a call is running. The tool trace draws that line itself; this
//              only says the status line must not draw a second one.
//   writing  — the reply is arriving, so there is nothing left to stand in for.
export type TurnPhase = "thinking" | "tool" | "writing";

// The phase a row moves to when a tool starts. A quiet tool (docs/72,
// legion/execute/contract.ts) is not named on screen and draws no trace line of
// its own, so naming it here would leave the status line blank for as long as it
// runs: the row keeps the phase it had — still "Thinking…" where it was
// thinking, still writing where the reply had started.
export function phaseOnToolStart(
  current: TurnPhase | null | undefined,
  quiet?: boolean,
): TurnPhase | undefined {
  if (!quiet) return "tool";
  return current ?? undefined;
}

// The one line under a reader's row that the model has not been handed yet
// (docs/72): they said it into a turn already running, and it joins the
// model's view at the end of the round in flight — one round at most. It comes
// off the moment that happens, and is never persisted.
export const QUEUED_NOTE = "after this step";

// The tool trace a stopped turn keeps: all of it. A call that ran is part of
// what the turn did, and the ones that failed are what explain the stop.
function keptTools(previous: { tools?: ToolStatus[] }): ToolStatus[] {
  return [...(previous.tools ?? [])];
}

// `text` is deliberately left as it stands. On the two chat surfaces it can hold
// what the rounds before the stop wrote (a tool start keeps those words and opens
// a blank line, appendRoundBreak below), and then the row is those words with the
// notice under them. It is empty where nothing was written before the stop; the
// notice is then the whole row and MessageList.tsx draws it alone.
//
// `failed` is cleared rather than left alone. Every call site spreads this over
// the row as it stands, so anything the function does not name survives; a row
// that arrived already marked would come back both failed and carrying a notice,
// which is two endings at once and not a state this function should be able to
// produce. Clearing it here is what makes that unrepresentable, and it is what
// lets the readers of the mark below take it at face value.
export function refusalRow(
  previous: { tools?: ToolStatus[] },
  message: string,
): { streaming: false; failed: false; notice: string; tools: ToolStatus[] } {
  return { streaming: false, failed: false, notice: message, tools: keptTools(previous) };
}

// What of a conversation goes back to the model on the next turn. Only the rows
// that hold words the model or the reader actually produced:
//
//   - a row the app ended carries the app's sentence, not the assistant's. A
//     refusal keeps it in `notice`, which is not read here at all; an error
//     keeps it in `text`, so `failed` is what excludes it.
//   - which means a refusal row is judged on its `text` alone. A refusal that
//     carries the model's own words replays them like any other reply: the reader
//     saw them on screen as the assistant's, and the model's view has to match.
//     One with nothing written before the stop drops out on the empty-text
//     clause. Either way nothing the app said about the turn travels with them:
//     that sentence is in `notice`.
//   - a card row is persisted with no text of its own (chatParts), and an empty
//     message is one some providers reject outright.
export function replayableHistory(
  rows: { role: "user" | "ai"; text: string; ts?: number; failed?: boolean }[],
): { role: "user" | "ai"; text: string }[] {
  return rows.filter((m) => !m.failed && m.text.trim() !== "").map(({ role, text }) => ({ role, text }));
}

// Whether a row is one a fresh attempt replaces rather than sits under: it holds
// no answer. The turn still streaming, the one that failed, and the one that
// stopped with nothing but a notice on it — a card row, which also has no text,
// is not one of these and stays.
//
// A refusal reaches this through the notice clause, never through `failed`
// (refusalRow clears it), so a refusal that wrote nothing is replaced. One the
// model got words onto is an answer, however short: it stays, and the next
// attempt sits under it.
export function holdsNoAnswer(m: {
  role: "user" | "ai";
  text: string;
  streaming?: boolean;
  failed?: boolean;
  notice?: string;
}): boolean {
  if (m.role !== "ai") return false;
  return !!m.streaming || !!m.failed || (!m.text.trim() && !!m.notice);
}

// --- what one turn wrote, across its rounds --------------------------------
// A tool round interrupts the reply: the model writes a sentence, calls a tool,
// and writes the rest in the next round. The words already on screen stay where
// they are and the next round's continue under them (docs/pitfall/291), so both
// the streaming row and the text that is persisted are every round's words in
// order, separated by a blank line. The turn (legion/execute/turn.ts) and the surfaces use
// the same two functions, or what the reader watched and what is saved would
// differ by a newline.

// Open the gap the next round writes into. Nothing to open on a row with no
// words yet, and a second tool in the same round finds the gap already there.
export function appendRoundBreak(text: string): string {
  const body = text.replace(/\s+$/, "");
  return body ? `${body}\n\n` : "";
}

// Every round's text in the order it was written. Rounds that wrote nothing
// contribute nothing, not a gap.
export function joinRoundTexts(texts: readonly string[]): string {
  let out = "";
  for (const t of texts) {
    if (!t.trim()) continue;
    out = out ? appendRoundBreak(out) + t : t;
  }
  return out;
}

// --- what a running turn does to its row -----------------------------------
// The one state machine every chat surface streams a turn through: the reading
// call (reading/call-state.ts, which applies it to the live-turns registry's
// copy of the row and to the one on screen) and useStreamingTurn (the coach,
// the retell, the lesson and the info companion). Data rather than a closure so
// the same change can be applied to two mirrors of one row and the two cannot
// drift.

// The part of a chat row a turn writes. Each surface's row type extends it with
// whatever else it draws, and every change below leaves those fields alone.
export interface TurnRow {
  text: string;
  // The row being written, and the one whose turn failed.
  streaming?: boolean;
  failed?: boolean;
  phase?: TurnPhase;
  // The app's remark about the turn (see refusalRow above). Display-only.
  notice?: string;
  tools?: ToolStatus[];
  // The delegated run this row answers (platform/app/threads.ts). Set only by
  // the reading call, which is the only surface a run is delivered into.
  origin?: MessageOrigin;
}

export type RowChange =
  // The model started reasoning: the row has a status line to draw and nothing
  // else. The thinking text itself is never carried — it is not shown.
  | { kind: "phase"; phase: "thinking" }
  // A chunk of the reply arrived.
  | { kind: "delta"; chunk: string }
  // The reader spoke mid-answer and the model has now been handed it, so this
  // row is finished as it stands and the reply that follows is a new one
  // (docs/72). What it wrote stays; only the marks of a turn in flight go.
  | { kind: "handed-over" }
  // A tool started. What the round wrote before calling it stays where it is,
  // with a blank line opened under it for the next round (docs/pitfall/291); the
  // status line is drawn in that gap and comes off when the tool returns. A
  // quiet call (docs/72) draws no line and leaves the phase where it was.
  | { kind: "tool-start"; name: string; label: string; quiet?: true }
  | { kind: "tool-end"; name: string; isError: boolean; receipt?: Receipt; error?: string }
  // A running tool said something new about itself — one line, rewritten in
  // place (docs/25).
  | { kind: "tool-label"; name: string; label: string }
  // The answer landed. The trace stays, settled, and the budget notice rides the
  // displayed row only (never persisted).
  | { kind: "answer"; text: string; notice?: string }
  // The model could not be reached: the words stand in for the reply, and Retry
  // is worth offering.
  | { kind: "error"; text: string }
  // The loop declined. The sentence is the app's, so it goes in `notice` and
  // never in `text`.
  | { kind: "refusal"; text: string }
  // The stop button: the half sentence stays, as a finished row.
  | { kind: "stopped"; text: string }
  // A delegated run was handed to the model before the row had a word in it,
  // so this row is the answer to it (docs/72). The row goes on being written.
  | { kind: "origin"; origin: MessageOrigin };

export function applyRowChange<M extends TurnRow>(row: M, change: RowChange): M {
  switch (change.kind) {
    case "phase":
      return { ...row, phase: change.phase };
    case "delta":
      return { ...row, text: row.text + change.chunk, phase: "writing" };
    case "handed-over":
      return { ...row, streaming: undefined, phase: undefined };
    case "tool-start":
      return {
        ...row,
        text: appendRoundBreak(row.text),
        phase: phaseOnToolStart(row.phase, change.quiet),
        tools: appendRunningTool(row.tools, change.name, change.label, change.quiet),
      };
    case "tool-end": {
      const tools = resolveToolStatus(row.tools, change.name, change.isError, {
        ...(change.receipt ? { receipt: change.receipt } : {}),
        ...(change.error ? { error: change.error } : {}),
      });
      return tools ? { ...row, tools } : row;
    }
    case "tool-label": {
      const tools = relabelRunningTool(row.tools, change.name, change.label);
      return tools ? { ...row, tools } : row;
    }
    case "answer":
      return {
        ...row,
        text: change.text,
        streaming: undefined,
        failed: undefined,
        phase: undefined,
        notice: change.notice,
      };
    case "error":
      return {
        ...row,
        text: change.text,
        failed: true,
        streaming: undefined,
        phase: undefined,
        notice: undefined,
        tools: undefined,
      };
    case "refusal":
      return { ...row, ...refusalRow(row, change.text), phase: undefined };
    case "stopped":
      return {
        ...row,
        text: change.text,
        streaming: undefined,
        failed: undefined,
        phase: undefined,
        notice: undefined,
        tools: undefined,
      };
    case "origin":
      return { ...row, origin: change.origin };
  }
}
