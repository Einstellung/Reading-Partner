// Which row a reading turn is writing, and what of it is already in the
// thread file (docs/72).
//
// The row moves when something is put into the turn mid-answer: the reader's
// line (reading/steering.ts) or a delegated run coming back (reading/
// delivered.ts). The model is handed it at the end of the round in flight, and
// what it writes after that is an answer to it, so it gets a row of its own.
// The rows above it go into the thread file at that moment, so the file reads
// user / ai / user / ai in the order it all happened.
//
// Pure bookkeeping: the session hook reads the verdicts and does the writing —
// the thread file, the live-turns registry, the reducer.

import { joinRoundTexts } from "../ai/turn-view/turn-rows";

export interface RowOrigin {
  runId: string;
}

/** The row above, to go into the thread file now, keyed by its row. */
export interface RowToPersist {
  text: string;
  ts: number;
  /** Absent on an ordinary row, as on the thread message it becomes. */
  origin?: RowOrigin;
}

/** Where the next thing written lands. `split` is set when that opens a row. */
export interface WritingAt {
  ts: number;
  split?: { was: number; origin: RowOrigin | null };
}

export interface RowSplit {
  /** The row being written. */
  readonly ts: number;
  /** The run the row being written answers; null on an ordinary row. */
  readonly origin: RowOrigin | null;
  /** The turn's first row was made at `ts`. */
  start(ts: number): void;
  /**
   * The model was handed the reader's line(s). `head` is the row's text so
   * far, trimmed. Returns the row above when it is not in the file yet.
   */
  steered(head: string): RowToPersist | null;
  /** The model was handed a delegated run's answer. As `steered`. */
  delivered(head: string, runId: string): RowToPersist | null;
  /**
   * Something is about to be put in the row. Opens the new row first when a
   * split is owed. Called by nothing that ends the turn: an ending writes
   * into the row that is already there. `now` is read only when a row opens.
   */
  writing(now: () => number): WritingAt;
  /**
   * What onDone writes into the last row, from the turn's whole text and what
   * the reader watched arrive in that row. Null when the turn was spoken into
   * and nothing followed: the row above is already down.
   */
  answerTail(full: string, liveText: string): string | null;
}

export function createRowSplit(): RowSplit {
  // Set when the turn's first row is made.
  let rowTs = 0;
  // What of this turn is already in the thread file: every row above a line
  // the reader got in. Empty while nobody has spoken into this turn, which is
  // the ordinary case and the one where onDone persists the whole reply.
  const persisted: string[] = [];
  let steered = false;
  // What of the row being written is already down, so two lines drained at
  // the same boundary do not write it twice.
  let rowPersisted: string | null = null;
  // The model has the line; the next thing written opens the new row.
  // Deferred to that moment rather than done on the spot so a turn that ends
  // right after the injection leaves no empty row behind.
  let splitPending = false;
  // The run whose answer the row being written is a reply to, and the one the
  // next row will be. Set when a delegated run is delivered into this turn.
  let rowOrigin: RowOrigin | null = null;
  let nextOrigin: RowOrigin | null = null;

  const persistHead = (head: string): RowToPersist | null => {
    steered = true;
    if (!head || head === rowPersisted) return null;
    persisted.push(head);
    rowPersisted = head;
    return { text: head, ts: rowTs, ...(rowOrigin ? { origin: rowOrigin } : {}) };
  };

  return {
    get ts() {
      return rowTs;
    },
    get origin() {
      return rowOrigin;
    },
    start(ts) {
      rowTs = ts;
    },
    steered(head) {
      const down = persistHead(head);
      // The reply that follows is a new row — unless there is nothing above
      // to separate it from. A line the model was handed before it had
      // written a word needs no split: an empty row would be the whole of
      // what it left.
      splitPending = head !== "";
      return down;
    },
    delivered(head, runId) {
      const down = persistHead(head);
      // Handed it before a word was written: this row is the answer.
      if (head === "") rowOrigin = { runId };
      else {
        splitPending = true;
        nextOrigin = { runId };
      }
      return down;
    },
    writing(now) {
      if (!splitPending) return { ts: rowTs };
      splitPending = false;
      rowPersisted = null;
      const was = rowTs;
      rowTs = Math.max(now(), was + 1);
      rowOrigin = nextOrigin;
      nextOrigin = null;
      return { ts: rowTs, split: { was, origin: rowOrigin } };
    },
    answerTail(full, liveText) {
      if (!steered) return full;
      const prefix = joinRoundTexts(persisted);
      const tail = full.startsWith(prefix)
        ? full.slice(prefix.length).trimStart()
        : // The canonical join does not continue what was already written
          // down (a row opened after a second line, say). What the reader
          // watched arrive in this row is then the answer.
          liveText.trim();
      return tail || null;
    },
  };
}
