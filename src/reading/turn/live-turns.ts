// The assistant turns that are still running, keyed by thread (docs/03).
// Once a turn has been sent nothing but the reader's Stop, and the thread being
// deleted, cuts it off: leaving the view, the page, the book or the reader all
// leave it running, and it lands in its thread file whoever is looking at what.
// This registry owns the half-written row until then — patched as the stream
// arrives, spliced back in when the thread is reopened, kept for the stop button
// to persist.
//
// It is a module, not a hook's ref, for that reason: the reading session is
// mounted with the reader, and a turn that outlives the reader has to outlive
// the React tree that started it (readingTurns below).
//
// Pure bookkeeping: it aborts controllers and holds messages, and never touches
// React state, storage or the network.

import type { Delivered } from "./delivered";
import type { Steering } from "./steering";

// The streaming row a turn owns. Structural, so the shell stores its own display
// message type (trace, images, notice and all) without this module knowing it.
export interface LiveMessage {
  ts: number;
}

export interface LiveTurn<M extends LiveMessage> {
  threadId: string;
  // The session's book: what stopBook ends when the reader leaves it.
  bookId: string;
  // The document whose thread file this conversation is written to — the
  // book's, or a supplement's for a mark drawn on one (docs/67).
  home: string;
  controller: AbortController;
  // The row as last patched. `message.text` is also the partial the stop button
  // keeps, which is why it is tracked here and not only in React state: a closed
  // bubble stops re-rendering, and the turn keeps writing.
  message: M;
  // The reader's lines said into this turn while it ran (reading/steering.ts).
  // Held here for the same reason the row is: the stop button needs to know
  // what the model was never handed, and a closed bubble has stopped
  // re-rendering by then.
  steering?: Steering;
  // The runs delivered back into this turn while it ran (reading/delivered.ts).
  // On the entry rather than in the turn's own closure for the same reason the
  // steering is: the bell reaches a turn it did not start, and this registry is
  // the only handle on it.
  delivered?: Delivered;
  // A turn this session did not start and draws no row for: the soul answering
  // a bell into this conversation (soul/bell.ts). It is registered all the same
  // so the thread is known to be busy — the reader talking into it steers it
  // rather than opening a second turn on the same conversation.
  silent?: boolean;
  // Run once the turn lands. Hanging up mid-stream defers the observation
  // distillation to here, so it reads a whole answer instead of half a sentence.
  onSettled?: () => void;
}

export interface LiveTurns<M extends LiveMessage> {
  start(turn: Omit<LiveTurn<M>, "onSettled">): void;
  // The reader spoke mid-turn and the model has been handed it, so the reply
  // that follows is a new row (docs/72). Only the controller that owns the
  // entry may swap the row, for the same reason only it may settle one.
  openRow(threadId: string, controller: AbortController, message: M): void;
  get(threadId: string): LiveTurn<M> | undefined;
  has(threadId: string): boolean;
  patch(threadId: string, ts: number, fn: (message: M) => M): void;
  settle(threadId: string, controller: AbortController): LiveTurn<M> | undefined;
  stop(threadId: string): LiveTurn<M> | undefined;
  whenSettled(threadId: string, fn: () => void): boolean;
  withLive(threadId: string, messages: M[]): M[];
}

export function createLiveTurns<M extends LiveMessage>(): LiveTurns<M> {
  const turns = new Map<string, LiveTurn<M>>();

  const drop = (threadId: string): LiveTurn<M> | undefined => {
    const turn = turns.get(threadId);
    if (turn) turns.delete(threadId);
    return turn;
  };

  return {
    // A thread runs one turn at a time. Reaching here with one already running
    // is a bug upstream rather than a case to handle: the reader talking into
    // a running turn steers it (docs/72), and nothing else starts a second.
    // The abort is the last resort that keeps two streams from writing the
    // same row, and it says so out loud.
    start(turn) {
      const running = turns.get(turn.threadId);
      if (running) {
        console.error("a second turn started on a thread that was still running", turn.threadId);
        running.controller.abort();
      }
      turns.set(turn.threadId, { ...turn });
    },

    openRow(threadId, controller, message) {
      const turn = turns.get(threadId);
      if (!turn || turn.controller !== controller) return;
      turn.message = message;
    },

    get: (threadId) => turns.get(threadId),
    has: (threadId) => turns.has(threadId),

    // Keep the stored row in step with what the stream wrote. The `ts` guard
    // makes a late callback from a superseded turn a no-op.
    patch(threadId, ts, fn) {
      const turn = turns.get(threadId);
      if (!turn || turn.message.ts !== ts) return;
      turn.message = fn(turn.message);
    },

    // The turn is over (done, failed or refused). Only the controller that owns
    // the entry may settle it, so a superseded turn cannot drop its successor.
    settle(threadId, controller) {
      const turn = turns.get(threadId);
      if (!turn || turn.controller !== controller) return undefined;
      turns.delete(threadId);
      return turn;
    },

    // Cut a turn short. The entry comes back so the caller can decide what to do
    // with the partial: keep it (stop button) or throw it away (thread deleted).
    stop(threadId) {
      const turn = drop(threadId);
      turn?.controller.abort();
      return turn;
    },

    // Hand work to the moment the turn lands. False when nothing is running, so
    // the caller can do it right away instead.
    whenSettled(threadId, fn) {
      const turn = turns.get(threadId);
      if (!turn) return false;
      turn.onSettled = fn;
      return true;
    },

    // Thread history rebuilt from the file, plus the row still being written.
    // Reopening a mark mid-answer picks the stream back up where it is.
    withLive(threadId, messages) {
      const turn = turns.get(threadId);
      if (!turn || turn.silent) return messages;
      if (messages.some((m) => m.ts === turn.message.ts)) return messages;
      return [...messages, turn.message];
    },
  };
}

// The one registry every reading turn runs on. Module-level so a turn outlives
// the session hook that started it: the reader closes, its tree goes, and the
// answer still lands in the thread file (docs/03, docs/68).
//
// One registry for every book at once. `bookId` on an entry says which book a
// turn was asked in, for anything that wants to know; nothing ends a turn for
// being on a book that is no longer open.
let shared: LiveTurns<LiveMessage> | null = null;

export function readingTurns<M extends LiveMessage>(): LiveTurns<M> {
  shared ??= createLiveTurns<LiveMessage>();
  // The row type is the shell's and this module never inspects it; one process
  // has one shell, so the cast is the whole of the generic's cost here.
  return shared as unknown as LiveTurns<M>;
}

/** Throw the registry away. For tests, which are not one process per case. */
export function resetReadingTurns(): void {
  shared = null;
}
