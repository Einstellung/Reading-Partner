// The assistant turns that are still running, keyed by thread (docs/03).
// Once a turn has been sent nothing but the reader's Stop, and the thread being
// deleted, cuts it off: leaving the view, the page, the book or the reader all
// leave it running, and it lands in its thread file whoever is looking at what.
// This registry holds its rows until then — spliced back in when the thread is
// reopened — and is how anything else asks whether a thread is busy: a bell for
// a busy thread waits for it to be free (reading/turn/deliver.ts).
//
// It is a module, not a hook's ref, for that reason: the reading session is
// mounted with the reader, and a turn that outlives the reader has to outlive
// the React tree that started it (readingTurns below).
//
// Pure bookkeeping: it aborts controllers and holds messages, and never touches
// React state, storage or the network.

// The streaming row a turn owns. Structural, so the shell stores its own display
// message type (trace, images, notice and all) without this module knowing it.
// The role is here because a stamp alone does not name a row: the reader's
// question and the reply to it can share one (withLive below).
export interface LiveMessage {
  ts: number;
  role: "user" | "ai";
}

export interface LiveTurn<M extends LiveMessage> {
  threadId: string;
  // The session's book: what stopBook ends when the reader leaves it.
  bookId: string;
  // The document whose thread file this conversation is written to — the
  // book's, or a supplement's for a mark drawn on one (docs/67).
  home: string;
  controller: AbortController;
  // The row being written: the last of `rows` once the runtime projects any,
  // and the placeholder before that.
  message: M;
  // A turn this session did not start: the soul answering a bell in this
  // conversation (reading/turn/deliver.ts). Its rows come after `after`, and
  // the session draws them whenever the registry says they changed.
  visiting?: { after: number };
  // A turn on the durable runtime (reading/turn/book-turn-rows.ts): every row
  // after the reader's line as last projected, and the handle that steers and
  // stops it. `message` is then the last of `rows`.
  rows?: M[];
  durable?: { steer(text: string, ts: number): Promise<boolean>; stop(): void };
  // The reader's lines said into a durable turn that no run has taken yet:
  // drawn queued after `rows`, and filed when the turn ends.
  unsent?: M[];
  // Run once the turn lands. Hanging up mid-stream defers the observation
  // distillation to here, so it reads a whole answer instead of half a sentence.
  onSettled?: () => void;
}

export interface LiveTurns<M extends LiveMessage> {
  start(turn: Omit<LiveTurn<M>, "onSettled">): void;
  get(threadId: string): LiveTurn<M> | undefined;
  has(threadId: string): boolean;
  // Something changed on a thread's turn: it started, settled or stopped, or
  // a visiting turn has new rows. The returned function stops listening.
  listen(fn: (threadId: string) => void): () => void;
  // A visiting turn's rows changed.
  touch(threadId: string): void;
  settle(threadId: string, controller: AbortController): LiveTurn<M> | undefined;
  stop(threadId: string): LiveTurn<M> | undefined;
  whenSettled(threadId: string, fn: () => void): boolean;
  withLive(threadId: string, messages: M[]): M[];
}

export function createLiveTurns<M extends LiveMessage>(): LiveTurns<M> {
  const turns = new Map<string, LiveTurn<M>>();
  const listeners = new Set<(threadId: string) => void>();
  const changed = (threadId: string) => {
    for (const fn of listeners) fn(threadId);
  };

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
      changed(turn.threadId);
    },

    get: (threadId) => turns.get(threadId),
    has: (threadId) => turns.has(threadId),

    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    touch: changed,

    // The turn is over (done, failed or refused). Only the controller that owns
    // the entry may settle it, so a superseded turn cannot drop its successor.
    settle(threadId, controller) {
      const turn = turns.get(threadId);
      if (!turn || turn.controller !== controller) return undefined;
      turns.delete(threadId);
      changed(threadId);
      return turn;
    },

    // Cut a turn short. The entry comes back so the caller can decide what to do
    // with the partial: keep it (stop button) or throw it away (thread deleted).
    stop(threadId) {
      const turn = drop(threadId);
      turn?.controller.abort();
      if (turn) changed(threadId);
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
    //
    // Already there means a row of the live row's role at its stamp. Files
    // written before rows were stamped apart hold the question and its reply
    // in the same millisecond, and matching the question dropped the reply
    // from the screen for the rest of the turn.
    withLive(threadId, messages) {
      const turn = turns.get(threadId);
      if (!turn) return messages;
      if (turn.rows) {
        const have = new Set(messages.map((m) => `${m.role}:${m.ts}`));
        return [...messages, ...turn.rows.filter((m) => !have.has(`${m.role}:${m.ts}`))];
      }
      const { ts, role } = turn.message;
      if (messages.some((m) => m.ts === ts && m.role === role)) return messages;
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
