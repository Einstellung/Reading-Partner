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

// `text` is deliberately left as it stands, and as the app is wired today it is
// always empty when this runs. REFUSE_MIDTURN fires at the top of a round,
// before that round's stream; REFUSE_ROUNDS fires only after a round that called
// tools (agent.ts). And a tool start blanks the row's text on all three surfaces
// (App.tsx, useTalk.ts, InfoCall.tsx). So the notice is the whole row and
// chat.tsx draws it alone. A refusal that still carries the model's words is
// unreachable from the loop — the function leaves them alone if one is ever
// built, but nothing downstream needs to be kept working for that case.
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
//   - which means a refusal row is judged on its `text` alone, and today that
//     text is always empty (see refusalRow): a refusal drops out here on the
//     empty-text clause, not on the mark. A refusal that did carry the model's
//     own words would replay them like any other reply — the reader saw them on
//     screen as the assistant's, and the model's view has to match — but the loop
//     cannot produce one. Either way nothing the app said about the turn travels
//     with them: that sentence is in `notice`.
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
// (refusalRow clears it), and its `text` is always empty as the app is wired
// today, so every refusal row is replaced. The other branch — a refusal the
// model got words onto is an answer, however short, so it stays and the next
// attempt sits under it — is unreachable from the loop; only the unit tests
// build such a row.
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
