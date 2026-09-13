// Reading the catalogue. The table is in kinds.ts; this is the only way anything
// else is meant to ask it a question (docs/61).
//
// Pure: no IO, no imports outside this directory. Everything that used to be a
// hand-written list somewhere else — the sync range, the never-infer-delete set,
// the merge strategies, a deleted book's paths — is a fold over these rows.

import { PALACE as ROWS, type PalaceKind, type PalaceRow, type RefAction } from "./kinds";

// The table, widened to the row interface. kinds.ts keeps the literal types so
// that PalaceKind is the union of the names written there; every reader wants
// the interface, and a reader that saw the literals would have to know which
// fields each individual row happens to carry.
export const PALACE: readonly PalaceRow[] = ROWS;

export type { PalaceKind, PalaceRow };
export type {
  DeleteWith,
  GcRule,
  PalaceDomain,
  PalaceId,
  RefAction,
  SyncChannel,
} from "./kinds";
export type { FieldGroups, MergeStrategy, RecordShape } from "./merge-types";

export interface PalaceMatch {
  row: PalaceRow;
  // The key captured out of the path: a book id, a date, a device id. Null for
  // a fixed name and for a kind whose files carry no id of their own.
  id: string | null;
}

/**
 * Which kind an AppData-relative path (forward-slash separators) belongs to, or
 * null when nothing in the palace claims it.
 *
 * First match wins, so the table's order is its priority: threads-retell-<id>
 * sits above threads-<bookId>, the covers failure markers sit above the plain
 * names that would swallow them.
 */
export function resolvePalace(path: string): PalaceMatch | null {
  for (const row of ROWS) {
    const hit = row.match(path);
    if (hit) return { row, id: hit.id };
  }
  return null;
}

/** Every row satisfying a predicate, in table order. */
export function rowsWhere(pred: (row: PalaceRow) => boolean): PalaceRow[] {
  return ROWS.filter(pred);
}

/** The row a kind name stands for. Throws on a name that is not in the table. */
export function rowOf(kind: PalaceKind): PalaceRow {
  const row = ROWS.find((r) => r.kind === kind);
  if (!row) throw new Error(`palace: no row for kind "${kind}"`);
  return row;
}

/** One kind's part in a cascade: what to do, and to which reference. */
export interface CascadeStep {
  kind: PalaceKind;
  // The field carrying the reference, as the row writes it.
  via: string;
  action: RefAction;
}

/**
 * What deleting a topic does, kind by kind, read off the table (docs/61).
 *
 * Every row that declares a reference to `topics` is here, in table order,
 * carrying the action its row chose. The "keep" steps are in the list rather
 * than filtered out of it: a kind that deliberately outlives the topic it names
 * is a decision, and one nobody can see is one nobody can check.
 *
 * Pure. The cascade itself is reading/delete/delete-topic.ts, which has a
 * handler for every step that is not a "keep" and no handler for anything else.
 */
export function cascadeOfTopic(rows: readonly PalaceRow[] = ROWS): CascadeStep[] {
  const steps: CascadeStep[] = [];
  for (const row of rows) {
    for (const ref of row.refs) {
      if (ref.kind !== "topics" || ref.onDelete === undefined) continue;
      steps.push({ kind: row.kind as PalaceKind, via: ref.via, action: ref.onDelete });
    }
  }
  return steps;
}
