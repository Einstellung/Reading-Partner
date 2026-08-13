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
// (the reading session, useTalk and the info companion all do), and reachable
// from a domain: this is what an agent turn's ending is, not how a row is drawn.
// The rows are taken structurally, so each surface keeps its own row type.

import type { ToolStatus } from "./tool-status";

// The tool trace a stopped turn keeps: the calls that failed, which explain the
// stop, and none of the ones that ran fine.
function keptTools(previous: { tools?: ToolStatus[] }): ToolStatus[] {
  return (previous.tools ?? []).filter((t) => t.state === "error");
}

// `text` is deliberately left as it stands. In practice it is empty — both
// refusal exits fire after a tool round, and every surface blanks the row when a
// tool starts — so the notice is usually the whole row, and chat.tsx draws it
// alone. Where the model did get words out first, they stay the model's and the
// notice sits under them.
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
//   - which means a refusal row is judged on its `text` alone, and its `text` is
//     only ever what the model itself wrote before the loop stopped. Those words
//     go back next turn, the same as any other reply: the reader saw them on
//     screen as the assistant's, and the model's view has to match. Nothing the
//     app said about the turn travels with them — that sentence is in `notice`.
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
// (refusalRow clears it): the empty one is replaced, and the one the model got
// words onto is an answer, however short, so it stays and the next attempt sits
// under it.
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
