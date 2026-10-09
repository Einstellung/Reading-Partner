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
// A row counts as produced when it holds words or a settled call (the same
// test the stop button keeps a row by, ai/turn-view/turn-rows.ts: keptOnStop):
// a round that only called a tool leaves its receipt above the reader's line.
// A row holding neither is not kept above the line; the reply moves under it,
// in a row stamped after it (docs/pitfall/510).
//
// Pure bookkeeping: the session hook reads the verdicts and does the writing —
// the thread file, the live-turns registry, the reducer.

import { joinRoundTexts } from "../../ai/turn-view/turn-rows";

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
  /**
   * `drop` is set when the row at `was` holds nothing: it goes rather than
   * stays above the line, and the reply opens under it.
   */
  split?: { was: number; origin: RowOrigin | null; drop?: true };
}

export interface RowSplit {
  /** The row being written. */
  readonly ts: number;
  /** The run the row being written answers; null on an ordinary row. */
  readonly origin: RowOrigin | null;
  /**
   * The row being written is already in the thread file: it was handed over
   * with something in it and nothing has been written since. What ends the
   * turn now (the stop button) has nothing of it left to put down.
   */
  readonly down: boolean;
  /** The turn's first row was made at `ts`. */
  start(ts: number): void;
  /**
   * The model was handed the reader's line(s). `head` is the row's text so
   * far, trimmed; `traced` is whether it holds a settled call worth storing.
   * Returns the row above when it is not in the file yet.
   */
  steered(head: string, traced?: boolean): RowToPersist | null;
  /** The model was handed a delegated run's answer. As `steered`. */
  delivered(head: string, runId: string, traced?: boolean): RowToPersist | null;
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

// The stamp for a row this turn opens: now, or just past the latest row
// already in the thread file. The send path appends the reader's question and
// starts the turn in the same millisecond, and a reply stamped like its
// question is a row that stamp alone cannot find again.
export function rowTsAfter(now: number, messages: readonly { ts: number }[]): number {
  let last = -Infinity;
  for (const m of messages) if (m.ts > last) last = m.ts;
  return Math.max(now, last + 1);
}

export function createRowSplit(): RowSplit {
  // Set when the turn's first row is made.
  let rowTs = 0;
  // What of this turn is already in the thread file: every row above a line
  // the reader got in. Empty while nobody has spoken into this turn, which is
  // the ordinary case and the one where onDone persists the whole reply.
  const persisted: string[] = [];
  let steered = false;
  // The row being written is already down, so two lines drained at the same
  // boundary do not write it twice.
  let rowDown = false;
  // The model has the line; the next thing written opens the new row.
  // Deferred to that moment rather than done on the spot so a turn that ends
  // right after the injection leaves no empty row behind. `dropPending` when
  // the row it leaves holds nothing.
  let splitPending = false;
  let dropPending = false;
  // The run whose answer the row being written is a reply to, and the one the
  // next row will be. Set when a delegated run is delivered into this turn.
  let rowOrigin: RowOrigin | null = null;
  let nextOrigin: RowOrigin | null = null;

  const produced = (head: string, traced: boolean) => head !== "" || traced;
  const persistHead = (head: string, traced: boolean): RowToPersist | null => {
    steered = true;
    if (rowDown || !produced(head, traced)) return null;
    if (head) persisted.push(head);
    rowDown = true;
    return { text: head, ts: rowTs, ...(rowOrigin ? { origin: rowOrigin } : {}) };
  };

  return {
    get ts() {
      return rowTs;
    },
    get origin() {
      return rowOrigin;
    },
    get down() {
      return rowDown;
    },
    start(ts) {
      rowTs = ts;
    },
    steered(head, traced = false) {
      const down = persistHead(head, traced);
      // The reply that follows goes under the reader's line either way. A row
      // with nothing in it is not left above the line: it goes, and the reply
      // opens below.
      splitPending = true;
      dropPending = !rowDown;
      return down;
    },
    delivered(head, runId, traced = false) {
      const down = persistHead(head, traced);
      // Handed it before anything was produced: this row is the answer. No
      // row is drawn for a delivery, so nothing sits between it and its row.
      if (!rowDown) rowOrigin = { runId };
      else {
        splitPending = true;
        nextOrigin = { runId };
      }
      return down;
    },
    writing(now) {
      if (!splitPending) return { ts: rowTs };
      const drop = dropPending;
      splitPending = false;
      dropPending = false;
      rowDown = false;
      const was = rowTs;
      rowTs = Math.max(now(), was + 1);
      // A row that goes takes nothing with it: the run it answered is what the
      // row that replaces it answers, unless another one came since.
      rowOrigin = drop ? (nextOrigin ?? rowOrigin) : nextOrigin;
      nextOrigin = null;
      return { ts: rowTs, split: { was, origin: rowOrigin, ...(drop ? { drop: true as const } : {}) } };
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
