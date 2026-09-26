// A reading turn that finished with nobody looking at it (docs/68).
//
// The turn is never cut by leaving — the view, the page, the book and the
// reader all let it run (docs/03) — so an answer can land in a conversation
// that is not on screen. When it does, Lumen's case is how the reader hears
// about it: one item, whose cover is the first sentence of the reply and whose
// origin points back at the thread it was written into.
//
// The rule is here, the side effects are the caller's. `unseenTurnItem` decides
// what goes in the box and `boxUnseenTurn` puts it there, after the reply is on
// disk — the same order the bell's own delivery keeps, so an item can never
// point at a conversation that is not there yet.

import { appBox, type BoxOrigin, type BoxStore, type PutBoxItemInput } from "../../box";
import { flushThreads } from "../../platform/app/threads";
import { coverOf } from "../../soul/bell";

/** How a turn ended, for the two cards the box has for it. */
export type TurnOutcome =
  | { kind: "answer"; text: string }
  | { kind: "error"; message: string };

export interface UnseenTurn {
  threadId: string;
  /** The reply row's timestamp: with the thread id, what names this delivery. */
  ts: number;
  bookId: string;
  annotationId?: string;
  /** 1-based, the way every other book origin counts (docs/60). */
  page?: number | null;
  outcome: TurnOutcome;
}

/**
 * Whether the reader is watching a conversation: this thread's, in this book,
 * with a call open on it. The call view being closed, a call on another thread
 * and the reader having left the book are the three ways the answer to this is
 * no, and they are one answer because they are one situation — nobody saw it.
 */
export function watching(
  open: { threadId: string } | null | undefined,
  openBookId: string | null | undefined,
  turn: { threadId: string; bookId: string },
): boolean {
  return open?.threadId === turn.threadId && openBookId === turn.bookId;
}

/** How the rule reads what is on screen: the open call and the open book. */
export type OpenCallPeek = () => {
  open: { threadId: string } | null;
  bookId: string | null;
};

// What the reader has on screen lives in the session hook's refs, and a delivery
// that settles outside React has no way to reach them. The hook leaves this
// behind instead — one function, registered on mount, read whenever an answer
// lands. Null with no reader mounted, which is itself an answer: nobody saw it.
let peek: OpenCallPeek | null = null;

/** The session says how to read what is on screen. Returns the undo. */
export function setOpenCallPeek(read: OpenCallPeek): () => void {
  peek = read;
  return () => {
    if (peek === read) peek = null;
  };
}

/** The rule above, against what is on screen now. False when no reader is up. */
export function watchingNow(turn: { threadId: string; bookId: string }): boolean {
  const open = peek?.();
  return open ? watching(open.open, open.bookId, turn) : false;
}

/**
 * What names this delivery. A reading turn has no run behind it, so the box id
 * is the thread and the moment: asking twice on one thread is two deliveries,
 * and one turn reported twice is one.
 */
export function turnBoxId(threadId: string, ts: number): string {
  return `${threadId}:${ts}`;
}

/** Where the card jumps back to. */
export function turnOrigin(turn: UnseenTurn): BoxOrigin {
  return {
    place: "book",
    bookId: turn.bookId,
    threadId: turn.threadId,
    ...(turn.annotationId ? { annotationId: turn.annotationId } : {}),
    ...(typeof turn.page === "number" ? { page: turn.page } : {}),
  };
}

/**
 * The item for a turn that finished unseen. An answer is a card the reader may
 * read or dismiss; a turn that failed is one they have to decide about, because
 * nothing was said and nothing was written down.
 */
export function unseenTurnItem(turn: UnseenTurn): PutBoxItemInput {
  const failed = turn.outcome.kind === "error";
  return {
    boxId: turnBoxId(turn.threadId, turn.ts),
    source: "turn",
    cover: coverOf(turn.outcome.kind === "answer" ? turn.outcome.text : turn.outcome.message),
    origin: turnOrigin(turn),
    needsDecision: failed,
    at: turn.ts,
  };
}

export interface BoxUnseenDeps {
  box?: BoxStore;
  flush?: () => Promise<void>;
}

/**
 * Put it in the box. The thread file is flushed first: the store coalesces its
 * writes, and a card that arrived before the reply it points at would open a
 * conversation with nothing new in it.
 *
 * Never throws — the answer is already written, and a card that would not write
 * is no reason to fail the turn.
 */
export async function boxUnseenTurn(turn: UnseenTurn, deps: BoxUnseenDeps = {}): Promise<void> {
  const box = deps.box ?? appBox();
  const flush = deps.flush ?? flushThreads;
  try {
    await flush();
    await box.put(unseenTurnItem(turn));
  } catch (e) {
    console.warn("a turn finished unseen but its box item would not write", e);
  }
}
