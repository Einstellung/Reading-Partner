// A side conversation off a live one (docs/03): the reader pulls a sentence out
// of the lesson, asks about that one thing, and goes back. One level deep — an
// aside never opens an aside — and it replaces the lesson in the single call
// slot rather than sitting beside it.
//
// What is here is the pure half: how much of the parent conversation an aside's
// turn opens on. The record and its store are platform/app/threads.ts; the
// assembly that uses this is reading/turn.ts.
//
// The parent's messages are read at turn time and never copied into the aside's
// own. Two conversations holding the same text is two places for it to drift,
// and the tail an aside wants is a window on the parent that moves as the parent
// does.

// How far back the tail reaches, counted in the reader's own questions.
//
// Measured on 13 real cases of this reader quoting the AI back at it: 8 quoted
// the immediately previous reply, 3 the one before that, 2 the one before that,
// none further back. Three rounds is where the evidence stops.
export const ASIDE_PARENT_ROUNDS = 3;

// The stand-in first user message when an aside's replayed history opens on a
// reply — the question that reply answered fell outside the tail, or off the
// end of the budget's tight rung. Every provider wants the exchange to open on a
// user turn, so something has to go there.
//
// Not EXPLAIN_KICKOFF: nothing was marked on the page here, and a stand-in that
// says there was sends the model looking for a passage the prompt does not
// carry. Not an instruction either — the reader's real question is two messages
// down, and an ask put in their mouth here is one the model may answer instead.
// A statement introducing the stretch that follows is all this slot needs.
export const ASIDE_KICKOFF = "Here is where we had got to in this book.";

export interface AsideTailMessage {
  role: "user" | "ai";
  ts: number;
}

// The stretch of the parent conversation an aside's turn replays: the message
// the span was pulled out of, back through `rounds` of the reader's questions.
//
// `anchorTs` is the parent message named by the aside's anchor. A mark-anchored
// aside has none — it was drawn on the page while the lesson ran — and takes the
// live end of the lesson instead, which is what the reader was looking at. So
// does a chat-span aside whose anchor no longer resolves.
//
// Rounds are counted by the reader's messages rather than by pairs, so a stretch
// where the model answered twice, or where a turn produced no reply at all, cuts
// in the same place a well-formed one does. The cut lands on a question, never
// on the reply to one the tail no longer carries.
export function asideParentTail<T extends AsideTailMessage>(
  messages: readonly T[],
  anchorTs: number | null,
  rounds = ASIDE_PARENT_ROUNDS,
): T[] {
  if (messages.length === 0 || rounds <= 0) return [];
  const at = anchorTs === null ? -1 : messages.findIndex((m) => m.ts === anchorTs);
  const end = at >= 0 ? at : messages.length - 1;
  let start = 0;
  let asks = 0;
  for (let i = end; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    asks++;
    start = i;
    if (asks === rounds) break;
  }
  return messages.slice(start, end + 1);
}
