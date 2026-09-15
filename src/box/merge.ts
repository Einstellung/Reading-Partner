// Two devices wrote the same box item. This is what one item is, afterwards.
//
// The same shape as the run file's merge (src/legion/run/merge.ts) and for the
// same reason: the fields of an item are not independent of each other, so
// there is nothing for a per-field strategy to settle one at a time. The set of
// states an item can hold is a join-semilattice and mergeBoxItem is its join,
// the least state at or above both — commutative, associative and idempotent,
// so two devices merging the same pair in either order, in any grouping, any
// number of times, land on the same bytes.
//
// Nothing here reads a clock of its own. The order is:
//
//   1. an exit beats an open state. The reader dismissed it on the desktop and
//      read it on the iPad: dismissed is the answer, and it is the same answer
//      the store gives on one device, where a state change after an exit is
//      refused.
//   2. `revision`  the casting vote inside a class: more writes, further along.
//   3. `stateAt`   two exits at the same revision — dismissed here, saved there
//      — are settled by which the reader did later. Each device stamped its own
//      action, which is a weaker thing to compare than two clocks' idea of now.
//   4. content order, so the comparator is total and the join associative.
//
// `createdAt` is folded rather than read off the winner — the earlier of the
// two, since an item was born once — and is therefore left out of the content
// comparison in rule 4. That is load-bearing and not tidiness: it makes the
// merged record identical to the winner everywhere rule 4 looks, so a merge of
// a merge never compares a record neither device ever held.

import { canonical, type Json } from "../platform/sync/merge/text";
import { isBoxItemState, isBoxSource, isExit, type BoxItem } from "./types";

const FOLDED = new Set(["createdAt"]);

function decided(item: BoxItem): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined || FOLDED.has(key)) continue;
    out[key] = value as Json;
  }
  return out;
}

/**
 * Which of two copies of one item is kept, as a comparator: negative when `a`
 * is kept, positive when `b` is, zero when the two are indistinguishable — in
 * which case the merge is the same either way. A total order.
 */
export function compareBoxItem(a: BoxItem, b: BoxItem): number {
  const byExit = (isExit(a.state) ? 0 : 1) - (isExit(b.state) ? 0 : 1);
  if (byExit !== 0) return byExit;
  if (a.revision !== b.revision) return b.revision - a.revision;
  if (a.stateAt !== b.stateAt) return b.stateAt - a.stateAt;

  const ca = canonical(decided(a));
  const cb = canonical(decided(b));
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

/** One item out of two copies of it. Commutative, associative and idempotent. */
export function mergeBoxItem(a: BoxItem, b: BoxItem): BoxItem {
  if (a.id !== b.id) {
    throw new Error(`mergeBoxItem: "${a.id}" and "${b.id}" are not the same item`);
  }
  const winner = compareBoxItem(a, b) <= 0 ? a : b;
  return { ...winner, createdAt: Math.min(a.createdAt, b.createdAt) };
}

/**
 * Whether the two sides were two independent writes of the same generation,
 * rather than one side simply being further along than the other. The only case
 * a person might want to know about, and what the merge reports as contested.
 */
export function collided(a: BoxItem, b: BoxItem): boolean {
  if (a.revision !== b.revision) return false;
  return canonical(decided(a)) !== canonical(decided(b));
}

// Whether a parsed file is a box item. Deliberately about shape and not about
// whether the values make sense together: a file that is not one is left to the
// opaque strategy rather than half-understood.
export function asBoxItem(value: unknown): BoxItem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const shaped =
    typeof item.id === "string" &&
    typeof item.boxId === "string" &&
    typeof item.cover === "string" &&
    typeof item.createdAt === "number" &&
    typeof item.stateAt === "number" &&
    typeof item.revision === "number" &&
    typeof item.origin === "object" &&
    item.origin !== null &&
    isBoxSource(item.source) &&
    isBoxItemState(item.state);
  return shaped ? (value as unknown as BoxItem) : null;
}

/**
 * The join as the sync engine takes it: two parsed files in, one out, null when
 * either side is not a box item or the two are not the same item. Registered
 * against the palace kind in box/index.ts; the engine never imports box.
 *
 * `loser` is the copy that was set aside, for the engine's journal, and it is
 * only ever set when the two sides collided: everywhere else the join subsumes
 * both and there is nothing a person could want back.
 */
export function joinBoxItemFiles(a: Json, b: Json): { merged: Json; loser: Json | null } | null {
  const left = asBoxItem(a);
  const right = asBoxItem(b);
  if (!left || !right || left.id !== right.id) return null;
  const merged = mergeBoxItem(left, right) as unknown as Json;
  if (!collided(left, right)) return { merged, loser: null };
  return { merged, loser: compareBoxItem(left, right) <= 0 ? b : a };
}
