// Two devices wrote the same run file. This is what one run is, afterwards.
//
// The run file is a state-based CRDT: the set of states a run can hold is a
// join-semilattice and mergeRun is its join, the least state at or above both.
// That buys the three properties the sync engine needs and nothing else here
// provides — the two devices merge the same pair in either order, in any
// grouping, any number of times, and land on the same bytes. The tests are
// named after them: commutative, associative, idempotent. What is below is only
// the run's own rules; the machinery they are handed to is the shared factory
// in platform/sync/merge/join.ts, which a box item fills in the same way.
//
// Nothing here reads a clock. "Whose copy is newer" is unanswerable across two
// devices, and every rule below is written to avoid ever asking it. The order
// is:
//
//   1. the state chain      pending < running < cancelled < failed < done
//   2. `revision`           the casting vote when both sides are at the same
//                           state: one device gave the run up, another finished
//                           it, and then the first came back with its own answer
//   3. the claimant         a claimed side beats an unclaimed one, and two
//                           claimants are settled by the lexicographically
//                           smaller deviceId — the same tie-break the collector
//                           election uses (info/briefer/handoff.ts)
//   4. content order        neither side was ever claimed and everything above
//                           ties, so the smaller canonical serialisation wins.
//                           Not the run id: both sides carry the same id, the
//                           file's own name.
//
// The winner is taken whole, except for five fields that are folded instead,
// because each of them is monotone on its own and reading it off the winner
// would walk it backwards:
//
//   attempts         max — a try that happened, happened
//   createdAt        the earlier of the two
//   startedAt        the earlier non-null: a run that started, started
//   deliveredAt      likewise; folding a run into the ledger waits on it
//   cancelRequested  once asked for, never unasked. A cancellation written on
//                    the iPad must not be lost to a progress report the desktop
//                    wrote at the same revision.
//
// Those five are also left out of the content comparison in rule 4, which is
// what keeps the join associative — see join.ts for why.

import { recordJoin } from "../../platform/sync/merge/join";
import { runRank, type Run, type RunState } from "./types";

const FOLDED = ["attempts", "createdAt", "startedAt", "deliveredAt", "cancelRequested"];

// Rules 1 to 3. Zero when they all tie and content order has the last word.
function order(a: Run, b: Run): number {
  const byState = runRank(b.state) - runRank(a.state);
  if (byState !== 0) return byState;
  if (a.revision !== b.revision) return b.revision - a.revision;

  const claimed = (a.claimant ? 0 : 1) - (b.claimant ? 0 : 1);
  if (claimed !== 0) return claimed;
  const da = a.claimant?.deviceId ?? "";
  const db = b.claimant?.deviceId ?? "";
  if (da !== db) return da < db ? -1 : 1;
  return 0;
}

function earliest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function fold(winner: Run, a: Run, b: Run): Run {
  const merged: Run = {
    ...winner,
    attempts: Math.max(a.attempts, b.attempts),
    createdAt: Math.min(a.createdAt, b.createdAt),
  };
  const startedAt = earliest(a.startedAt, b.startedAt);
  if (startedAt !== undefined) merged.startedAt = startedAt;
  const deliveredAt = earliest(a.deliveredAt, b.deliveredAt);
  if (deliveredAt !== undefined) merged.deliveredAt = deliveredAt;
  if (a.cancelRequested || b.cancelRequested) merged.cancelRequested = true;
  return merged;
}

// Whether a parsed file is a run. A file that is not is left to the opaque
// strategy rather than half-understood, so this is deliberately about shape and
// not about whether the values make sense together.
export function asRun(value: unknown): Run | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  const shaped =
    typeof run.id === "string" &&
    typeof run.kind === "string" &&
    typeof run.revision === "number" &&
    typeof run.attempts === "number" &&
    typeof run.createdAt === "number" &&
    typeof run.state === "string" &&
    runRank(run.state as RunState) >= 0;
  return shaped ? (value as unknown as Run) : null;
}

const lattice = recordJoin<Run>({
  folded: FOLDED,
  order,
  // The same state at the same revision: two independent writes of one
  // generation, rather than one side simply being further along.
  sameGeneration: (a, b) => a.state === b.state && a.revision === b.revision,
  fold,
  as: asRun,
  mismatch: (a, b) => `mergeRun: "${a.id}" and "${b.id}" are not the same run`,
});

/**
 * Which of two copies of one run is kept, as a comparator: negative when `a` is
 * kept, positive when `b` is, zero when the two are indistinguishable — in which
 * case the merge is the same either way.
 *
 * A total order, which is what makes the join associative.
 */
export const compareRun = lattice.compare;

/** One run out of two copies of it. Commutative, associative and idempotent. */
export const mergeRun = lattice.merge;

/**
 * Whether the two sides were two independent writes of the same generation —
 * the same state at the same revision — rather than one side simply being
 * further along than the other. The only case a person might want to know
 * about, and what the merge reports as contested.
 */
export const collided = lattice.collided;

/**
 * The join as the sync engine takes it: two parsed files in, one out, null when
 * either side is not a run file or the two are not the same run. Registered
 * against the palace kind in legion/run/index.ts; the engine never imports
 * legion.
 *
 * `loser` is the copy that was set aside, for the engine's journal, and it is
 * only ever set when the two sides collided: everywhere else the join subsumes
 * both and there is nothing a person could want back.
 */
export const joinRunFiles = lattice.join;
