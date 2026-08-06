// The assistant turns that are still running, keyed by thread (docs/03).
// Closing a bubble does not stop the reply any more: the turn runs on and lands
// in its thread file, so it outlives the view that started it and two threads
// can be in flight at once. This registry owns the half-written row until then —
// patched as the stream arrives, spliced back in when the thread is reopened,
// kept for the stop button to persist.
//
// Pure bookkeeping: it aborts controllers and holds messages, and never touches
// React state, storage or the network.

// The streaming row a turn owns. Structural, so the shell stores its own display
// message type (trace, images, notice and all) without this module knowing it.
export interface LiveMessage {
  ts: number;
}

export interface LiveTurn<M extends LiveMessage> {
  threadId: string;
  bookId: string;
  controller: AbortController;
  // The row as last patched. `message.text` is also the partial the stop button
  // keeps, which is why it is tracked here and not only in React state: a closed
  // bubble stops re-rendering, and the turn keeps writing.
  message: M;
  // Run once the turn lands. Hanging up mid-stream defers the observation
  // distillation to here, so it reads a whole answer instead of half a sentence.
  onSettled?: () => void;
}

export interface LiveTurns<M extends LiveMessage> {
  start(turn: Omit<LiveTurn<M>, "onSettled">): void;
  get(threadId: string): LiveTurn<M> | undefined;
  has(threadId: string): boolean;
  patch(threadId: string, ts: number, fn: (message: M) => M): void;
  settle(threadId: string, controller: AbortController): LiveTurn<M> | undefined;
  stop(threadId: string): LiveTurn<M> | undefined;
  stopBook(bookId: string): LiveTurn<M>[];
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
    // A thread runs one turn at a time: a follow-up question or a retry replaces
    // the turn already on it, and nothing else is touched.
    start(turn) {
      turns.get(turn.threadId)?.controller.abort();
      turns.set(turn.threadId, { ...turn });
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

    // Every turn belonging to one book, cut short. Turns on other books keep
    // running — they write to their own thread files and closing this book says
    // nothing about them.
    stopBook(bookId) {
      const stopped = [...turns.values()].filter((t) => t.bookId === bookId);
      for (const turn of stopped) {
        turns.delete(turn.threadId);
        turn.controller.abort();
      }
      return stopped;
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
      if (!turn) return messages;
      if (messages.some((m) => m.ts === turn.message.ts)) return messages;
      return [...messages, turn.message];
    },
  };
}
