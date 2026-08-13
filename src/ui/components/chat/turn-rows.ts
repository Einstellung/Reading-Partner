// How a chat row ends when the loop stops without an answer. Two endings, and
// they are not the same thing:
//
//   error   — the model could not be reached. The words are the app's, the row
//             is marked failed, and a retry is worth offering where the surface
//             has one.
//   refusal — the loop declined mid-turn: the call outgrew the context window,
//             or it spent its round cap on tools without answering (agent.ts).
//             Nothing failed and nothing is worth retrying — the same inputs are
//             declined the same way. Where the model had already written
//             something, the sentence goes under it as a notice, which is what a
//             notice is for (common/types: the app talking about the turn, never
//             persisted, never replayed as the model's words). Where the row is
//             still empty, the sentence is all there is, so it takes the row.
//
// Kept here rather than in a .tsx so every chat surface can end a turn the same
// way (App and useTalk both do this in their own words already).

import type { ThreadMessage } from "../common/types";

// The tool trace a stopped turn keeps: the calls that failed, which explain the
// stop, and none of the ones that ran fine.
function keptTools(previous: ThreadMessage): ThreadMessage["tools"] {
  return (previous.tools ?? []).filter((t) => t.state === "error");
}

export function refusalRow(previous: ThreadMessage, message: string): Partial<ThreadMessage> {
  const answered = previous.text.trim().length > 0;
  return answered
    ? { streaming: false, notice: message, tools: keptTools(previous) }
    : { streaming: false, failed: true, text: message, tools: keptTools(previous) };
}
