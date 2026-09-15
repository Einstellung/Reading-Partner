// The lattice strategy: a file that is one record, whose merge the domain owns.
//
// The other four strategies know the shape of what they merge — records, fields,
// watermarks, lines of prose — and can decide a file on their own. A run file
// (docs/55) cannot be decided that way: its fields are not independent, and
// which copy of `progress` to keep depends on a state chain and a revision that
// only legion knows the meaning of. So the rule comes from the domain, and this
// is the socket it plugs into.
//
// It is a registry rather than an import because of the direction of the
// layering: platform/sync may not reach into legion, and legion imports platform
// freely. The domain registers its join at import time, the way pull-routes.ts
// registers the routes it owns; a file whose kind has nobody registered falls
// through to opaque, which keeps both copies rather than guessing at one.
//
// What a join has to be is the whole of the contract: the least state at or
// above both inputs, in some ordering of the domain's choosing. Commutative,
// associative and idempotent, so that two devices merging the same pair in
// either order, in any grouping, any number of times, land on the same bytes.
// Three-way degenerates to two-way here — the base does not participate at all,
// because a join has no need of it: it cannot tell an addition from a deletion,
// and neither is expressible in a record that only moves up.

import { resolvePalace } from "../../../palace";
import type { Json } from "./text";

export interface LatticeResult {
  /** The least record at or above both sides. */
  merged: Json;
  // The copy that was set aside, for the engine's journal, or null when the
  // join subsumed both sides and nothing was given up.
  loser: Json | null;
}

/** Null when either side is not the shape this join merges. */
export type LatticeJoin = (a: Json, b: Json) => LatticeResult | null;

const joins = new Map<string, LatticeJoin>();

/** Register the join for one palace kind. Returns the undo. */
export function registerLattice(kind: string, join: LatticeJoin): () => void {
  joins.set(kind, join);
  return () => {
    if (joins.get(kind) === join) joins.delete(kind);
  };
}

/**
 * Whether a kind has a join registered right now. For the registrations made at
 * import time, which have nothing else to show that they ran: a registration
 * that is deleted takes its file's merge down to opaque and nothing throws.
 */
export function isLatticeRegistered(kind: string): boolean {
  return joins.has(kind);
}

/** The join for whatever kind of file this path is, or null. */
export function latticeFor(path: string): LatticeJoin | null {
  const kind = resolvePalace(path)?.row.kind;
  return kind === undefined ? null : (joins.get(kind) ?? null);
}
