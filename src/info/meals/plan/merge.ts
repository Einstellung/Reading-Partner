// How sync settles two edits of info-meals.json (palace row "info-meals").
//
// The file is one record (store.ts): the plan, the trip derived from it and the
// deviations applied to it are never mixed across devices. What the merge
// decides is which device's file stands when both changed. A newly confirmed
// plan replaces the old one whole (docs/671), so the copy holding the plan
// confirmed later wins: a device still on the old plan that ticked a line or
// recorded a step must not put the replaced plan back.
//
// Two copies of the same plan (one confirmation stamp) are not decided here:
// the join answers null and sync keeps one whole and parks the other, as it
// did before this file existed.

import { registerLattice, type LatticeJoin } from "../../../platform/sync/merge/lattice";
import type { Json } from "../../../platform/sync/merge/text";

export const MEALS_KIND = "info-meals";

function isRecord(v: Json): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** When the file's plan was confirmed (WeekPlan.createdAt); -1 for a file with no plan. Null when not a meals file. */
function confirmedAt(file: Json): number | null {
  if (!isRecord(file)) return null;
  const plan = file.plan;
  if (plan === null || plan === undefined) return -1;
  if (!isRecord(plan)) return null;
  const at = plan.createdAt;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** The copy whose plan was confirmed later, whole; null when both hold the same plan. */
export const joinMealsFiles: LatticeJoin = (a, b) => {
  const left = confirmedAt(a);
  const right = confirmedAt(b);
  if (left === null || right === null || left === right) return null;
  return left > right ? { merged: a, loser: b } : { merged: b, loser: a };
};

// Importing this registers the join, the way box and legion/run register
// theirs: platform may not import the domain. The store imports it, and so does
// the shell's startup, so it is in place before the first sync pass.
registerLattice(MEALS_KIND, joinMealsFiles);
