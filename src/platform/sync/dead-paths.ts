// Which paths belong to a deleted thing (platform/app/deleted-books.ts).
//
// A deletion in the log names a kind and an id. The files it takes are the ones
// named for that id that die at all: for a book its marks, its AI threads, its
// supplements list, its pagination and its prep material; for a retell its own
// record and its conversation; for an outline its record and the talk's
// conversation; for a rehearsal its record, the index of its passes and every
// transcript under runs/<id>/. Those are the ones a file-level delete cannot
// carry on its own — the device that still holds them republishes them and the
// thing comes back (docs/13, pitfall 208) — so the log has to say, on every
// device, that they must not exist any more.
//
// Deliberately not here:
//   library.json, reading-state.json, topics.json — the book is one record in
//     each, and a record-level delete already travels (merge/records.ts).
//   observations/ — an observation is not one book's, and the ones that are get
//     tombstoned one record at a time by their own store.
//   A book's retells — they ride on the book by a rule about their materials
//     rather than by their name (reading/delete/pick.ts), so deleting the book
//     logs each of them under its own id.
//
// Both answers are folds over the palace (palace/kinds.ts) rather than a list
// of shapes written out here: a row says which id names its file and whether
// the file ever dies, and that is the whole rule. A downloaded paper's fulltext
// is keyed by a synthetic prep path rather than by a book id (fulltext/store.ts),
// the one key nothing can derive from a bookId; prep-<bookId>/ covers it as a
// directory.
//
// Pure: no IO, and the only import is the table. Unit-tested directly
// (tests/platform/sync/dead-paths.test.ts).

import { resolvePalace, rowsWhere, type PalaceRow } from "../../palace";
import { TOMBSTONE_KINDS, type Deletions, type TombstoneKind } from "../app/deleted-books";

// The id field whose value a deletion of this kind names. A topic's deletion
// names no file: everything of a topic's is a record, or is logged under its
// own id by the cascade (reading/delete/delete-topic.ts).
const ID_FIELD: Record<TombstoneKind, PalaceRow["id"] | null> = {
  book: "bookId",
  retell: "retellId",
  outline: "outlineId",
  rehearsal: "rehearsalId",
  topic: null,
};

function ownedBy(row: PalaceRow, kind: TombstoneKind): boolean {
  const field = ID_FIELD[kind];
  return field !== null && row.id === field && row.deleteWith !== "never";
}

/** The paths one deleted thing owns on the rows `channel` accepts, as prefixes and exact names. */
export function ownedPaths(
  kind: TombstoneKind,
  id: string,
  channel: (row: PalaceRow) => boolean,
): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  for (const row of rowsWhere((r) => ownedBy(r, kind) && channel(r))) {
    const path = row.pathFor?.(id);
    if (path === undefined) continue;
    const into = path.endsWith("/") ? dirs : files;
    if (!into.includes(path)) into.push(path);
  }
  return { files, dirs };
}

/**
 * The synced paths one deleted thing owns: what a pass takes off every device.
 * A file the reconcile loop never sees has no business in a plan; the local
 * caches are deleted by the domain side (reading/delete/pick.ts).
 */
export function deadPathsFor(kind: TombstoneKind, id: string): { files: string[]; dirs: string[] } {
  return ownedPaths(kind, id, (r) => r.sync === "data");
}

/**
 * Whether this AppData-relative path is a deleted thing's. Called for every
 * path in a pass's plan, so it resolves the path rather than building a set of
 * paths per deletion: the log grows for the life of the install and most of
 * what it names is not on this device.
 */
export function isDeadPath(path: string, deletions: Deletions): boolean {
  let any = false;
  for (const kind of TOMBSTONE_KINDS) if (deletions[kind].size > 0) any = true;
  if (!any) return false;
  const hit = resolvePalace(path);
  if (!hit || hit.id === null) return false;
  for (const kind of TOMBSTONE_KINDS) {
    if (deletions[kind].size === 0) continue;
    if (ownedBy(hit.row, kind) && deletions[kind].has(hit.id)) return true;
  }
  return false;
}
