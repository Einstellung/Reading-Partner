// Which synced paths belong to a deleted book (platform/app/deleted-books.ts).
//
// Only the files whose whole existence is that book's: its marks, its AI
// threads, and its prep material. Those are the ones a file-level delete cannot
// carry on its own — the device that still holds them republishes them and the
// book comes back (docs/13, pitfall 208) — so a tombstone has to say, on every
// device, that they must not exist any more.
//
// Deliberately not here:
//   library.json, reading-state.json, topics.json — the book is one record in
//     each, and a record-level delete already travels (merge/records.ts).
//   observations/ — an observation is not one book's, and the ones that are get
//     tombstoned one record at a time by their own store.
//   retell-*, outline-*, rehearsal-*, runs-rehearsal-*, runs/ — named for their
//     own ids, not for the book, and deleted by the stores that own them.
//   fulltext-<key>.json, figures-<key>.json, prep-<h>/pdf/** — derived caches,
//     out of the sync range entirely (syncFs.ts), so nothing here has to reach
//     them; the domain side deletes the local copies.
//
// A downloaded paper's fulltext is keyed by a synthetic prep path rather than by
// a book id (fulltext/store.ts), which is the one key that cannot be derived
// from a bookId — and it does not have to be, because that cache is not synced.
// The prep directory itself is named for the survey's own content hash
// (reading/prep/papers/store.ts, reading/prep/chapters/store.ts), which is the
// book id, so prep-<bookId>/ covers both kinds of material.
//
// Both answers are folds over the palace (palace/kinds.ts) rather than a list
// of shapes written out here: a row says what a file's deletion rides on, and
// the two that matter are that it rides on the book and that the id in its name
// is the book id. A retell rides on the book too, but by a rule about its
// materials rather than by its name (reading/delete/pick.ts), so it is not a
// path anything can derive from a bookId and the second condition leaves it
// out.
//
// Pure: no IO, and the only import is the table. Unit-tested directly
// (tests/platform/sync/dead-paths.test.ts).

import { resolvePalace, rowsWhere, type PalaceRow } from "../../palace";

function namedForABook(row: PalaceRow): boolean {
  return row.deleteWith === "book" && row.id === "bookId";
}

/** The paths one deleted book owns, as prefixes and exact names. */
export function deadPathsFor(bookId: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  // Only the synced half: this is what a pass takes off every device, and a
  // file the reconcile loop never sees has no business in a plan. The local
  // caches are deleted by the domain side (reading/delete/pick.ts).
  for (const row of rowsWhere((r) => namedForABook(r) && r.sync === "data")) {
    const path = row.pathFor?.(bookId);
    if (path === undefined) continue;
    const into = path.endsWith("/") ? dirs : files;
    if (!into.includes(path)) into.push(path);
  }
  return { files, dirs };
}

/**
 * Whether this AppData-relative path is a deleted book's. Called for every path
 * in a pass's plan, so it resolves the path rather than building a set of paths
 * per deleted book: the tombstone list grows for the life of the install and
 * most of what it names is not on this device.
 */
export function isDeadPath(path: string, deadBooks: ReadonlySet<string>): boolean {
  if (deadBooks.size === 0) return false;
  const hit = resolvePalace(path);
  if (!hit || hit.id === null || !namedForABook(hit.row)) return false;
  return deadBooks.has(hit.id);
}
