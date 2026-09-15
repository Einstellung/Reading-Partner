// Folding a run into the ledger (docs/55): the cold layer the hot run file
// becomes once nobody is waiting on it any more.
//
// A folded line is a tombstone as well as a record. Sync propagates no file
// deletion of its own (pitfall 208), so the only thing that can authorise
// deleting a run file on the other device is a record that travels — and both
// devices have to be able to write that record without talking to each other.
// Hence the two properties everything here is built for:
//
//   canonical   two devices folding the same run write the same bytes, so the
//               union of the two ledgers is one line and not two. Nothing
//               device-local goes in the line: no claimant, no revision, no
//               progress, no local clock reading. Every field that does is one
//               the run merge converges on (run/merge.ts).
//   pure        the decision is a function of the run, the clock and the
//               thresholds. The disk is the caller's problem.
//
// The brief is in the line by reference and by content hash, never by content.
// A replay re-reads the brief from its reference and checks the hash; a brief
// that has changed or gone is a replay that is refused rather than a replay of
// something else (docs/55).

import type { Delegator, Run, RunState } from "../run/types";
import { isTerminal } from "../run/types";

// How long a delivered run stays in the hot layer before it folds. The grace is
// not about correctness — the bell has been acked, so nothing is waiting on the
// run — it is about a person still being able to find a run in the hot layer on
// the day it happened, and about a device that was asleep for the evening
// arriving at the same conclusion when it wakes rather than having to undo one.
//
// A failed run keeps longer because it is the one somebody comes back to: the
// dead-letter view reads the ledger, but a replay wants the run file's own
// account of how far it got, and a week covers being away from the desk.
export const FOLD_GRACE_MS = 24 * 60 * 60 * 1000;
export const FOLD_FAILED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface FoldThresholds {
  /** After a delivered terminal run may fold. Defaults to FOLD_GRACE_MS. */
  graceMs?: number;
  /** The same for a `failed` run. Defaults to FOLD_FAILED_GRACE_MS. */
  failedGraceMs?: number;
}

export interface FoldOptions extends FoldThresholds {
  /**
   * The content hash of the brief as it reads now, or null when it could not be
   * read. Computed by the caller because hashing is IO and this is not.
   */
  briefHash?: string | null;
}

/** One folded run: a line of `legion/ledger/<YYYY-MM-DD>.jsonl`. */
export interface LedgerLine {
  id: string;
  kind: string;
  /** The terminal state it stopped at. `failed` lines are the dead-letter view. */
  state: RunState;
  /** Who asked for it: "soul", or "run:<id>" for a step a program worker fanned out. */
  delegator: string;
  /** The reference the run carried. Never the brief itself. */
  brief: string;
  /** The brief's content at fold time, or null when it could not be read. */
  briefHash: string | null;
  output?: string;
  batchId?: string;
  step?: string;
  attempts: number;
  createdAt: number;
  endedAt: number;
  /** When the bell was acked. A cancelled run has no bell; see deliveredMoment. */
  deliveredAt: number;
}

/** The part of a run a fold reads. */
export type FoldableRun = Pick<
  Run,
  | "id"
  | "kind"
  | "state"
  | "delegator"
  | "brief"
  | "output"
  | "batchId"
  | "step"
  | "attempts"
  | "createdAt"
  | "endedAt"
  | "deliveredAt"
>;

function delegatorText(delegator: Delegator): string {
  return delegator.kind === "soul" ? "soul" : `run:${delegator.id}`;
}

/**
 * When the run counts as delivered, or undefined while it does not.
 *
 * A cancelled run is never announced — cancellation is not a bell (bell/types.ts)
 * — so waiting for an ack would leave it in the hot layer for good. It counts as
 * delivered the moment it stopped: whoever cancelled it knew then.
 */
export function deliveredMoment(run: FoldableRun): number | undefined {
  if (run.deliveredAt !== undefined) return run.deliveredAt;
  if (run.state === "cancelled") return run.endedAt;
  return undefined;
}

/**
 * The line this run folds into, or null while any of the three conditions is
 * unmet: terminal, delivered, and past the grace (docs/55). All three or
 * nothing — a run that never had its bell acked stays hot however old it is,
 * because an unacked bell is a result nobody has read.
 */
export function foldRun(
  run: FoldableRun,
  now: number,
  options: FoldOptions = {},
): LedgerLine | null {
  if (!isTerminal(run.state)) return null;
  if (run.endedAt === undefined) return null;
  const delivered = deliveredMoment(run);
  if (delivered === undefined) return null;
  const grace =
    run.state === "failed"
      ? (options.failedGraceMs ?? FOLD_FAILED_GRACE_MS)
      : (options.graceMs ?? FOLD_GRACE_MS);
  if (now - delivered < grace) return null;

  const line: LedgerLine = {
    id: run.id,
    kind: run.kind,
    state: run.state,
    delegator: delegatorText(run.delegator),
    brief: run.brief,
    briefHash: options.briefHash ?? null,
    attempts: whole(run.attempts),
    createdAt: whole(run.createdAt),
    endedAt: whole(run.endedAt),
    deliveredAt: whole(delivered),
  };
  if (run.output !== undefined) line.output = run.output;
  if (run.batchId !== undefined) line.batchId = run.batchId;
  if (run.step !== undefined) line.step = run.step;
  return line;
}

// Every number in a line is a whole one, so JSON.stringify has one spelling for
// it. A fractional millisecond from somewhere would otherwise be the one thing
// that makes two devices write different bytes for the same run.
function whole(value: number): number {
  return Math.trunc(value);
}

// The key order a line is written in. Fixed here rather than left to the order
// the object happened to be built in, because that is what canonical means.
const KEYS = [
  "id",
  "kind",
  "state",
  "delegator",
  "brief",
  "briefHash",
  "output",
  "batchId",
  "step",
  "attempts",
  "createdAt",
  "endedAt",
  "deliveredAt",
] as const;

/**
 * The line as it goes on disk. No newline: the store joins them.
 *
 * Two devices that hold the same run write this same string, which is what lets
 * the file merge as a union of lines (palace "records", shape "lines") without
 * anybody de-duplicating anything.
 */
export function ledgerLineText(line: LedgerLine): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = (line as unknown as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }
  return JSON.stringify(ordered);
}

/** One line back off the disk, or null when it is not a line anybody can use. */
export function parseLedgerLine(text: string): LedgerLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const line = value as Partial<LedgerLine>;
  if (typeof line.id !== "string" || typeof line.kind !== "string") return null;
  if (line.state !== "done" && line.state !== "failed" && line.state !== "cancelled") return null;
  if (typeof line.delegator !== "string" || typeof line.brief !== "string") return null;
  if (line.briefHash !== null && typeof line.briefHash !== "string") return null;
  for (const key of ["attempts", "createdAt", "endedAt", "deliveredAt"] as const) {
    if (typeof line[key] !== "number" || !Number.isFinite(line[key])) return null;
  }
  return line as LedgerLine;
}
