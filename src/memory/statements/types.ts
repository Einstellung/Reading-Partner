// Statements: what is held to be true about the reader, on top of the episodic
// observations (memory/observations). An observation is something that happened
// on a day and points at the marks and messages it happened in; a statement is
// a claim that carries no date of its own and points back at the observations
// that are its evidence.
//
// The split is what lets the front of memory shrink. An observation covered by
// a statement has been read and no longer has to be carried into a prompt on
// its own; it stays on disk as the evidence the statement can be traced to.
//
// Only `text` is written by a model. Every other field is computed or appended
// by the program, the dates above all — a model asked for a date fills one in,
// and these two are exactly the span the statement's own evidence covers.

export const STATEMENT_KINDS = ["profile", "concern"] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export function isStatementKind(v: string): v is StatementKind {
  return (STATEMENT_KINDS as readonly string[]).includes(v);
}

// Who wrote the text. "reader" is something the reader said about themselves,
// "dream" is something a background pass concluded. Kept apart because they are
// not equally revisable: a dream's claim may be dropped when the evidence stops
// supporting it, the reader's own words may not.
export const STATEMENT_AUTHORS = ["reader", "dream"] as const;
export type StatementAuthor = (typeof STATEMENT_AUTHORS)[number];

export function isStatementAuthor(v: string): v is StatementAuthor {
  return (STATEMENT_AUTHORS as readonly string[]).includes(v);
}

export interface Statement {
  // "s-" + 16 hex, the same 64-bit width an observation id and a message id
  // have (memory/observations/store.ts, platform/app/threads.ts).
  id: string;
  kind: StatementKind;
  // The claim itself, and the only field a model writes.
  text: string;
  author: StatementAuthor;
  // What this rests on: observation ids (m-…) and message anchors (the three
  // forms anchors.ts resolves). Append-only — evidence accumulates, and a
  // statement whose evidence could be taken away would be a claim with nothing
  // behind it rather than a claim that was never made.
  evidence: string[];
  // Observations that say the opposite. Append-only for the same reason, and a
  // list of its own rather than signed evidence: what a contradiction means is
  // a judgement made later, and merging the two lists destroys the input that
  // judgement needs.
  contradictedBy: string[];
  // The span the evidence covers, both computed from the evidence itself.
  // `established` is its first day and does not move when older evidence is
  // appended later — it answers when this was first held, not when the oldest
  // thing now attached to it happened, the same rule Observation.created
  // follows. `lastSupported` is its last day and never moves backwards.
  established: string; // YYYY-MM-DD
  lastSupported: string; // YYYY-MM-DD
  // The statement that replaced this one. A superseded statement is kept: it is
  // how its evidence was read at the time, and the observations it covered stop
  // being covered the moment it is superseded (links.ts).
  supersededBy?: string;
  // Concern-only, and typed here before anything acts on them: how often a
  // concern expects to see evidence, and whether it has gone that long without.
  // Nothing computes `lapsed` yet.
  expectedIntervalDays?: number;
  lapsed?: boolean;
}

// What a caller supplies to mint one. Everything else is computed.
export interface CreateStatementInput {
  kind: StatementKind;
  text: string;
  author: StatementAuthor;
  evidence: string[];
  expectedIntervalDays?: number;
}
