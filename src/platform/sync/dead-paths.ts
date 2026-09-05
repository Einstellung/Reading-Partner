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
//   memory-<topicId>/ — observations are stored by topic, not by book, and are
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
// Pure: no IO, no imports. Unit-tested directly
// (tests/platform/sync/dead-paths.test.ts).

/** The paths one deleted book owns, as prefixes and exact names. */
export function deadPathsFor(bookId: string): { files: string[]; dirs: string[] } {
  return {
    files: [`annotations-${bookId}.json`, `threads-${bookId}.json`],
    dirs: [`prep-${bookId}/`],
  };
}

const ANNOTATIONS = /^annotations-(.+)\.json$/;
const THREADS = /^threads-(.+)\.json$/;
const PREP = /^prep-([^/]+)\//;

/**
 * Whether this AppData-relative path is a deleted book's. Called for every path
 * in a pass's plan, so it matches the path against the shapes rather than
 * building a set of paths per deleted book: the tombstone list grows for the
 * life of the install and most of what it names is not on this device.
 */
export function isDeadPath(path: string, deadBooks: ReadonlySet<string>): boolean {
  if (deadBooks.size === 0) return false;
  const owner =
    ANNOTATIONS.exec(path)?.[1] ?? THREADS.exec(path)?.[1] ?? PREP.exec(path)?.[1] ?? null;
  return owner !== null && deadBooks.has(owner);
}
