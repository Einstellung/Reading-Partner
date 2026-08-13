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
// Kept here rather than in a .tsx so every chat surface can end a turn the same
// way (App and useTalk both do this in their own words already).

import type { ThreadMessage } from "./types";

// The tool trace a stopped turn keeps: the calls that failed, which explain the
// stop, and none of the ones that ran fine.
function keptTools(previous: ThreadMessage): ThreadMessage["tools"] {
  return (previous.tools ?? []).filter((t) => t.state === "error");
}

// `text` is deliberately left as it stands. In practice it is empty — both
// refusal exits fire after a tool round, and every surface blanks the row when a
// tool starts — so the notice is usually the whole row, and chat.tsx draws it
// alone. Where the model did get words out first, they stay the model's and the
// notice sits under them.
export function refusalRow(previous: ThreadMessage, message: string): Partial<ThreadMessage> {
  return { streaming: false, notice: message, tools: keptTools(previous) };
}

// What of a conversation goes back to the model on the next turn. Only the rows
// that hold words the model or the reader actually produced:
//
//   - a row the app ended carries the app's sentence, not the assistant's. A
//     refusal keeps it in `notice`, which is not read here at all; an error
//     keeps it in `text`, so `failed` is what excludes it.
//   - a card row is persisted with no text of its own (chatParts), and an empty
//     message is one some providers reject outright.
export function replayableHistory(rows: ThreadMessage[]): { role: "user" | "ai"; text: string }[] {
  return rows.filter((m) => !m.failed && m.text.trim() !== "").map(({ role, text }) => ({ role, text }));
}

// Whether a row is one a fresh attempt replaces rather than sits under: it holds
// no answer. The turn still streaming, the one that failed, and the one that
// stopped with nothing but a notice on it — a card row, which also has no text,
// is not one of these and stays.
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
