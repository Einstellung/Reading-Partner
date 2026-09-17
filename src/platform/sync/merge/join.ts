// Building a domain's join out of the little it has to say about its record.
//
// lattice.ts is the socket; this is the plug. Two domains fill it — a run
// (src/legion/run/merge.ts) and a box item (src/box/merge.ts) — and the parts
// that differ between them are exactly the parts a domain knows: which fields
// are folded rather than read off the winner, what beats what, and what counts
// as one file of this kind. Everything around those is the same both times and
// lives here, which is also where the semilattice laws are kept honest:
//
//   - a total order decides which copy is kept, so the join is associative;
//   - the last tie-break is the canonical serialisation of the record minus its
//     folded fields, so both devices break a tie the same way and a merged
//     record compares as the larger of its two inputs — without that, a merge of
//     a merge could compare a record neither device ever held;
//   - nothing reads a clock, a device id, or which side the caller called local.
//
// platform may not reach into a domain, so nothing here knows a record beyond
// its `id`: the rules arrive as callbacks.

import type { LatticeJoin, LatticeResult } from "./lattice";
import { canonical, type Json } from "./text";

/** What a domain says about its record. Everything else is the same both times. */
export interface RecordLattice<T extends { id: string }> {
  /**
   * Fields folded out of two copies rather than taken from the winner. Left out
   * of the content comparison too, which is what keeps the join associative.
   */
  folded: readonly string[];
  /**
   * The tie-breaks above content order — the state chain, a revision, whatever
   * the domain ranks by — negative when `a` is kept, zero when they all tie.
   */
  order(a: T, b: T): number;
  /**
   * Whether the two sides are the same generation, so that two different
   * records at that generation are independent writes rather than one side
   * simply being further along.
   */
  sameGeneration(a: T, b: T): boolean;
  /** One record out of two copies of it, given which of them won. */
  fold(winner: T, a: T, b: T): T;
  /** Whether a parsed file is this record. Null when it is not. */
  as(value: unknown): T | null;
  /** The error for a call asked to merge two copies of two different records. */
  mismatch(a: T, b: T): string;
}

export interface RecordJoin<T> {
  compare(a: T, b: T): number;
  merge(a: T, b: T): T;
  collided(a: T, b: T): boolean;
  join: LatticeJoin;
}

/**
 * The comparator, the merge, the collision report and the join the sync engine
 * takes, all four out of one description of the record's lattice.
 */
export function recordJoin<T extends { id: string }>(lattice: RecordLattice<T>): RecordJoin<T> {
  const folded = new Set(lattice.folded);

  // The half of the record the winner is taken from whole, canonicalised: every
  // field but the folded ones. Keys holding undefined are dropped so a record
  // built in memory compares equal to the same record read back from its file.
  function contentKey(record: T): string {
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined || folded.has(key)) continue;
      out[key] = value as Json;
    }
    return canonical(out);
  }

  function compare(a: T, b: T): number {
    const byOrder = lattice.order(a, b);
    if (byOrder !== 0) return byOrder;
    const ca = contentKey(a);
    const cb = contentKey(b);
    if (ca === cb) return 0;
    return ca < cb ? -1 : 1;
  }

  function merge(a: T, b: T): T {
    if (a.id !== b.id) throw new Error(lattice.mismatch(a, b));
    return lattice.fold(compare(a, b) <= 0 ? a : b, a, b);
  }

  function collided(a: T, b: T): boolean {
    if (!lattice.sameGeneration(a, b)) return false;
    return contentKey(a) !== contentKey(b);
  }

  function join(a: Json, b: Json): LatticeResult | null {
    const left = lattice.as(a);
    const right = lattice.as(b);
    if (!left || !right || left.id !== right.id) return null;
    const merged = merge(left, right) as unknown as Json;
    if (!collided(left, right)) return { merged, loser: null };
    return { merged, loser: compare(left, right) <= 0 ? b : a };
  }

  return { compare, merge, collided, join };
}
