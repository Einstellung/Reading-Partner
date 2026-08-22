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

// That span with the reply it came out of.
//
// The text, never a character offset. What the reader dragged over is the
// rendered reply, and linkifyCitations rewrites a message's source before
// react-markdown parses it, so an offset taken off the rendering indexes
// different words in the stored text — or runs past its end.
//
// What is kept is therefore the rendering's words, which are not always a
// substring of the stored text either: Markdown syntax is gone from them, and a
// citation whose visible label drops its quote payload
// (reading/prep/anchors.ts) reads shorter than its source. That costs nothing,
// because nothing looks the span up in the message it came from — it is carried
// to the prompt as the words the reader picked out, and it is those words.
export function asideAnchorAt(messageTs: number, raw: string): AsideAnchor | null {
  const text = asideSpan(raw);
  return text === null ? null : { messageTs, text };
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

// Whether the parent is still there is not asked here and is not this answer's
// to give: the line above an aside says what it is about, which is true of an
// orphan too. Offering a way back is decided where the parent can be looked up
// (asideReturn).
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

// The receipt (docs/09): a footnote row the reader sees under the lesson's last
// message and a sentence the model reads on the next turn of it. Both come from
// the aside's own first question — no second model call, so nothing about
// closing an aside waits on one.

// One aside on a receipt.
export interface AsideReceiptItem {
  // The aside itself, so the row is the door back into it. A chat-span aside
  // has no mark and no page: the lesson's transcript is the only place it can be
  // reached from.
  threadId: string;
  span: string;
  question: string;
  // The page the aside was drawn on, when it was drawn on the book. One pulled
  // out of a reply has no page, and its row shows the words instead.
  page?: number;
}

// What a receipt's card holds: one entry per aside, in the order they were
// left. Several land on one card when nothing was said in the lesson between
// them.
//
// A record written before a receipt could hold more than one aside carries that
// aside's fields at the top level and no `items`. Nothing migrates them —
// asideReceiptItems reads either shape.
export interface AsideReceiptCardData extends Partial<AsideReceiptItem> {
  kind: "aside";
  items?: AsideReceiptItem[];
}

// Every card the aside unit contributes to the chat's payload union.
export type AsideCard = AsideReceiptCardData;

export function asideReceiptItems(card: AsideReceiptCardData): AsideReceiptItem[] {
  if (card.items) return card.items;
  const { threadId, span, question, page } = card;
  if (threadId === undefined) return [];
  return [
    {
      threadId,
      span: span ?? "",
      question: question ?? "",
      ...(page === undefined ? {} : { page }),
    },
  ];
}

// How much of a span a row shows as the place the reader stepped out from.
export const ASIDE_ANCHOR_MAX = 24;

// Where the aside was opened, for its row: the page it was drawn on, or the
// words it was pulled out of. Empty when there is neither.
export function asideAnchorLabel(item: AsideReceiptItem): string {
  if (item.page !== undefined) return `p.${item.page}`;
  return item.span === "" ? "" : `“${oneLine(item.span, ASIDE_ANCHOR_MAX)}”`;
}

// The one line a receipt of several asides is collapsed to.
export function asideReceiptSummary(count: number): string {
  return `${count} questions while you were reading`;
}

// The receipt row at the end of a conversation, if the last thing in it is one:
// a row carrying an aside card and nothing else. That is the row the next aside
// joins; anything said in the lesson since — a question, a reply — starts a new
// one.
export function openAsideReceipt(
  message: Pick<ThreadMessage, "parts"> | null | undefined,
): { cardId: string; card: AsideReceiptCardData } | null {
  const parts = message?.parts;
  if (!parts || parts.length !== 1) return null;
  const part = parts[0];
  if (part.type !== "card" || part.card.kind !== "aside") return null;
  return { cardId: part.id, card: part.card as unknown as AsideReceiptCardData };
}

// Whether this conversation already carries the line for that aside. Leaving an
// aside a second time — the reader reopened it from its row and stepped back —
// must not write the same sentence twice, and the question it summarises is the
// first one either way.
export function carriesAsideReceipt(
  messages: readonly Pick<ThreadMessage, "parts">[],
  threadId: string,
): boolean {
  return messages.some((m) =>
    (m.parts ?? []).some(
      (p) =>
        p.type === "card" &&
        p.card.kind === "aside" &&
        asideReceiptItems(p.card as unknown as AsideReceiptCardData).some(
          (item) => item.threadId === threadId,
        ),
    ),
  );
}

// Where the line goes: onto the receipt row already at the end of the
// conversation, or onto a new row of its own.
export type AsideReceiptWrite =
  | { mode: "new"; text: string; card: AsideReceiptCardData }
  | { mode: "merge"; ts: number; cardId: string; text: string; card: AsideReceiptCardData };

export function asideReceipt(input: {
  // The aside being left.
  threadId: string;
  span: string;
  // The page it hangs on, when it was drawn on the book.
  page?: number | null;
  // Its own messages, as the thread file holds them.
  messages: readonly Pick<ThreadMessage, "role" | "text">[];
  // The parent's, for the line it may already carry and the row that may take
  // this one.
  parent: readonly Pick<ThreadMessage, "text" | "ts" | "parts">[];
}): AsideReceiptWrite | null {
  const { threadId, span, page, messages, parent } = input;
  if (carriesAsideReceipt(parent, threadId)) return null;
  // An aside the reader opened and asked nothing in leaves nothing behind.
  const asked = messages.find((m) => m.role === "user" && m.text.trim() !== "");
  if (!asked) return null;
  const question = oneLine(asked.text, ASIDE_QUESTION_MAX);
  const item: AsideReceiptItem = {
    threadId,
    span: oneLine(span, ASIDE_SPAN_MAX),
    question,
    ...(typeof page === "number" ? { page } : {}),
  };
  // Bracketed, and about the reader rather than to them: the row is written
  // with the assistant's role, so the model reads this back as a note it left
  // itself rather than as something it said out loud.
  //
  // "now closed" and not "and came back": the same line is written when the
  // reader hangs up inside the aside, and then they have not come back. What
  // is true on every way out is that the side conversation is over.
  const text = `[Aside, now closed: the reader stepped out of this conversation to ask "${question}".]`;
  const last = parent.length > 0 ? parent[parent.length - 1] : null;
  const open = last ? openAsideReceipt(last) : null;
  if (last && open) {
    return {
      mode: "merge",
      ts: last.ts,
      cardId: open.cardId,
      // One sentence per aside, oldest first: the model reads the same lines in
      // the same order whether they were written one to a row or several.
      text: `${last.text}\n${text}`,
      card: { kind: "aside", items: [...asideReceiptItems(open.card), item] },
    };
  }
  return { mode: "new", text, card: { kind: "aside", items: [item] } };
}
