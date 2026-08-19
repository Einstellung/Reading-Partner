// A side conversation off a live one (docs/03): the reader pulls a sentence out
// of the lesson, asks about that one thing, and goes back. One level deep — an
// aside never opens an aside — and it replaces the lesson in the single call
// slot rather than sitting beside it.
//
// What is here is the pure half: how much of the parent conversation an aside's
// turn opens on, which selection is worth opening one on, which rows may offer
// it, the line it leaves behind and the way back. The record and its store are
// platform/app/threads.ts; the assembly that uses the tail is reading/turn.ts;
// the surfaces are ui/components/chat and reading/session/use-call.ts.
//
// The parent's messages are read at turn time and never copied into the aside's
// own. Two conversations holding the same text is two places for it to drift,
// and the tail an aside wants is a window on the parent that moves as the parent
// does.

import {
  threadKind,
  type AsideAnchor,
  type Thread,
  type ThreadMessage,
} from "../platform/app/threads";

// How far back the tail reaches, counted in the reader's own questions.
//
// Measured on 13 real cases of this reader quoting the AI back at it: 8 quoted
// the immediately previous reply, 3 the one before that, 2 the one before that,
// none further back. Three rounds is where the evidence stops.
export const ASIDE_PARENT_ROUNDS = 3;

// And a hard ceiling on the messages, because rounds are counted by the reader's
// questions and bound nothing at all when they asked none: an entry that opens
// on the model's turn, or a stretch of nothing but drawn cards, has no user
// message for the walk to stop at and the whole conversation comes back. Twelve
// is three rounds at the widest a round gets — a question, a card row, and the
// text beside it.
export const ASIDE_PARENT_MAX_MESSAGES = 12;

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
  max = ASIDE_PARENT_MAX_MESSAGES,
): T[] {
  if (messages.length === 0 || rounds <= 0 || max <= 0) return [];
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
  if (end + 1 - start > max) {
    start = end + 1 - max;
    // Back onto a question if there is one left in the window, so the ceiling
    // cuts where the walk would have.
    let i = start;
    while (i <= end && messages[i].role !== "user") i++;
    if (i <= end) start = i;
  }
  return messages.slice(start, end + 1);
}

// --- the span an aside is opened on ---------------------------------------

// The shortest selection worth a conversation. A tap that lands between two
// words selects nothing, and one that catches a single letter is not a question
// either.
export const ASIDE_SPAN_MIN = 2;

// The longest one carried on the record. The span rides the slot a marked
// passage goes in, which is tier 0 of the budget and never dropped
// (reading/ladder.ts), so a reader who swept three paragraphs is cut here
// rather than left to push the inlined chapter out of the prompt.
export const ASIDE_SPAN_MAX = 400;

// How much of the reader's first question the receipt repeats.
export const ASIDE_QUESTION_MAX = 140;

// One line, cut to `max`. A selection across a Markdown list or a code block
// brings the newlines with it, and every place a span or a question is shown or
// stated is one line.
function oneLine(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// The reader's selection as the record stores it. Null when there is nothing
// there to ask about.
export function asideSpan(raw: string): string | null {
  const text = oneLine(raw, ASIDE_SPAN_MAX);
  return text.length < ASIDE_SPAN_MIN ? null : text;
}

// That span with the reply it came out of. The text, never a character offset:
// linkifyCitations rewrites a message's source before react-markdown parses it,
// so an offset taken off the rendered reply does not index the stored text
// (platform/app/threads.ts: AsideAnchor).
export function asideAnchorAt(messageTs: number, raw: string): AsideAnchor | null {
  const text = asideSpan(raw);
  return text === null ? null : { messageTs, text };
}

// The part of a chat row this decides on.
export interface AsideRow {
  role: "user" | "ai";
  text: string;
  streaming?: boolean;
  failed?: boolean;
}

// Whether the reader may step out of this row.
//
// `bookLevel` is what keeps an aside one level deep: the affordance is offered
// on the lesson's replies and nowhere else, so inside an aside there is no row
// to open a second one from.
//
// Only a settled reply. While one streams, every delta rebuilds the row and
// re-parses the partial Markdown, so a Range into it is dead within a frame —
// and there is nothing to ask about yet either. A failed row is the app's words
// standing in for a reply, not the model's.
export function mayOpenAside(row: AsideRow, bookLevel: boolean): boolean {
  if (!bookLevel) return false;
  if (row.role !== "ai") return false;
  if (row.streaming || row.failed) return false;
  return row.text.trim() !== "";
}

// --- what an aside's record opens as --------------------------------------

// The framing a surface draws an aside in: which door its span came in by, what
// the span was, and the conversation to go back to.
export interface AsideFraming {
  parentThreadId: string;
  // "chat" is a span pulled out of a reply, "mark" one drawn on the page while
  // the lesson ran. The record says which: only a chat-span aside carries an
  // anchor, only a drawn one carries a mark.
  from: "chat" | "mark";
  // What this conversation is about, for the line above it. A drawn aside's span
  // is the marked passage, which the record does not hold — the mark does, so
  // the caller passes it.
  span: string;
}

export function asideFraming(
  thread: Pick<Thread, "annotationId" | "book" | "parentThreadId" | "asideAnchor">,
  markText: string,
): AsideFraming | null {
  if (threadKind(thread) !== "aside" || !thread.parentThreadId) return null;
  const anchor = thread.asideAnchor;
  return {
    parentThreadId: thread.parentThreadId,
    from: anchor ? "chat" : "mark",
    span: oneLine(anchor ? anchor.text : markText, ASIDE_SPAN_MAX),
  };
}

// Where "back to the lesson" goes: the parent, reopened as itself. Null when
// the record found under the parent link is itself an aside, which one level
// deep says cannot happen and a record claiming it is not followed.
export interface AsideReturn {
  threadId: string;
  annotationId: string;
  isBook: boolean;
}

export function asideReturn(
  parent: Pick<Thread, "id" | "annotationId" | "book" | "parentThreadId" | "asideAnchor">,
): AsideReturn | null {
  const kind = threadKind(parent);
  if (kind === "aside") return null;
  return { threadId: parent.id, annotationId: parent.annotationId, isBook: kind === "book" };
}

// --- the line an aside leaves on the lesson -------------------------------

// The receipt (docs/09): a chip the reader sees in the lesson's transcript and a
// sentence the model reads on the next turn of it. Both come from the aside's
// own first question — no second model call, so nothing about closing an aside
// waits on one.
export interface AsideReceiptCardData {
  kind: "aside";
  // The aside itself, so the chip is the door back into it. A chat-span aside
  // has no mark and no page: the lesson's transcript is the only place it can be
  // reached from.
  threadId: string;
  span: string;
  question: string;
}

// Every card the aside unit contributes to the chat's payload union.
export type AsideCard = AsideReceiptCardData;

// Whether this conversation already carries the line for that aside. Leaving an
// aside a second time — the reader reopened it from the chip and stepped back —
// must not write the same sentence twice, and the question it summarises is the
// first one either way.
export function carriesAsideReceipt(
  messages: readonly Pick<ThreadMessage, "parts">[],
  threadId: string,
): boolean {
  return messages.some((m) =>
    (m.parts ?? []).some(
      (p) => p.type === "card" && p.card.kind === "aside" && p.card.threadId === threadId,
    ),
  );
}

export function asideReceipt(input: {
  // The aside being left.
  threadId: string;
  span: string;
  // Its own messages, as the thread file holds them.
  messages: readonly Pick<ThreadMessage, "role" | "text">[];
  // The parent's, for the line it may already carry.
  parent: readonly Pick<ThreadMessage, "parts">[];
}): { text: string; card: AsideReceiptCardData } | null {
  const { threadId, span, messages, parent } = input;
  if (carriesAsideReceipt(parent, threadId)) return null;
  // An aside the reader opened and asked nothing in leaves nothing behind.
  const asked = messages.find((m) => m.role === "user" && m.text.trim() !== "");
  if (!asked) return null;
  const question = oneLine(asked.text, ASIDE_QUESTION_MAX);
  return {
    // Bracketed, and about the reader rather than to them: the row is written
    // with the assistant's role, so the model reads this back as a note it left
    // itself rather than as something it said out loud.
    text: `[Aside: the reader stepped out of this conversation to ask "${question}", and came back.]`,
    card: { kind: "aside", threadId, span: oneLine(span, ASIDE_SPAN_MAX), question },
  };
}
