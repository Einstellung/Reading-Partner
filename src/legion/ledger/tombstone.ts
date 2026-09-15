// Which hot run files the ledger says are over (docs/55).
//
// The ledger is the only thing that may delete a run file. Sync propagates no
// file deletion of its own (pitfall 208), so a device that deleted a run
// unilaterally would simply have it pushed back by the other one; and
// `legion/runs` is on the never-infer list, so a tree comparison is not allowed
// to read the difference between a device that has folded and one that has not
// as a deletion either. Both halves leave one rule: a run goes when there is a
// line for it.
//
// The creation-time half is the whole of the danger. A run id can be derived —
// `hash(kind + batchId + step)` — so the same id comes round again when a batch
// is re-run with the same step names. A new run under a recycled id is live
// work, and a line written about the previous one must not take it with it. So
// the line only speaks for a run created no later than the one it folded.
//
// Pure: both passes of the housekeeping (housekeeping.ts) are this function and
// some IO.

import type { Run } from "../run/types";
import type { LedgerLine } from "./fold";

/** The part of a hot run the rule reads. */
export type HotRun = Pick<Run, "id" | "createdAt">;

/**
 * The ids whose hot files the ledger has already accounted for, in the order
 * they were given. A run with no line, or with a line about an older run of the
 * same id, is not in the answer.
 */
export function tombstonedRunIds(
  hot: readonly HotRun[],
  lines: readonly LedgerLine[],
): string[] {
  // The latest line per id. Two lines under one id are two runs that shared a
  // derived id, one after the other — two devices folding the same run write
  // the same `createdAt`, because it is the field the run merge keeps the
  // earliest of and both of them have converged on it. So the newest line is
  // the one that speaks for whatever is in the hot layer now.
  const folded = new Map<string, number>();
  for (const line of lines) {
    const seen = folded.get(line.id);
    if (seen === undefined || line.createdAt > seen) folded.set(line.id, line.createdAt);
  }

  const dead: string[] = [];
  for (const run of hot) {
    const foldedAt = folded.get(run.id);
    if (foldedAt === undefined) continue;
    // Later than the line: a new run wearing an old id. It stays.
    if (run.createdAt > foldedAt) continue;
    dead.push(run.id);
  }
  return dead;
}
