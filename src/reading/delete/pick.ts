// What a deleted book takes with it, decided without touching disk (docs/50).
//
// The split is whether the data is about the book or about the reader. Marks,
// threads, prep, retells and the caches go; statements stay untouched. The three
// decisions that are not obvious are here, one function each, so the
// orchestrator (delete-book.ts) reads as an order of operations and these can be
// pinned on their own.
//
// Pure by construction: the inputs are the records the caller already read.

import { rowOf, type PalaceKind } from "../../palace";
import type { FileRef, Topic } from "../../platform/app/topics";
import type { Observation } from "../../memory/observations/types";
import type { Statement } from "../../memory/statements/types";
import type { Retell } from "../retell/types";

/**
 * The observations of this book that may be tombstoned: every one carrying its
 * bookId, minus the ones a statement points at.
 *
 * An observation a statement names is not this book's to delete any more. It is
 * a link in the evidence chain a statement was drawn from, and dream reads that
 * chain back when it checks a statement or supersedes it — a statement whose
 * evidence resolves to nothing is a claim about the reader with the ground taken
 * out from under it. The kept observations keep their message anchors, which now
 * point at threads that are gone; anchors already degrade rather than fail
 * (observations/anchors.ts), and what dream and recall read is the text and the
 * date.
 *
 * Both lists are read: `contradictedBy` is the same kind of link as `evidence`,
 * signed the other way.
 */
export function observationIdsToDelete(
  observations: readonly Observation[],
  statements: readonly Statement[],
  bookId: string,
): string[] {
  const cited = new Set<string>();
  for (const s of statements) {
    for (const id of s.evidence) cited.add(id);
    for (const id of s.contradictedBy) cited.add(id);
  }
  return observations.filter((o) => o.bookId === bookId && !cited.has(o.id)).map((o) => o.id);
}

/**
 * The retells that die with the book: the ones with nothing else in them.
 *
 * A retell spans one or more materials (retell/types.ts), so a retell that also
 * covers two other books is still a pass the reader made over those two and is
 * left alone — with a material entry naming a book that no longer exists, which
 * is a title and a dangling id in a list, not a broken read. A retell with no
 * materials at all belongs to no book and is not touched here either.
 */
export function retellIdsToDelete(retells: readonly Retell[], bookId: string): string[] {
  return retells
    .filter((r) => r.materials.length > 0 && r.materials.every((m) => m.bookId === bookId))
    .map((r) => r.id);
}

/** One book's supplements list, as the reference counting reads it. */
export interface SupplementList {
  bookId: string;
  items: ReadonlyArray<{ hash: string }>;
}

/**
 * Whether anything still lists this document: a topic's FileRef, or a book's
 * supplements. These are the two places a document is put by the reader, and
 * the same bytes can be put in both — the same URL pasted into two books, an
 * article that is on a shelf and also a supplement of a book (docs/50
 * 「引用计数」). The document's data goes only when neither is left.
 *
 * `ignoreBooks` are the lists that do not count: the document's own (a book
 * that lists itself keeps nothing alive) and those of the books the same sweep
 * is deleting, whose lists are about to go with them.
 */
export function hasOtherReference(
  hash: string,
  topics: readonly Topic[],
  lists: readonly SupplementList[],
  ignoreBooks: ReadonlySet<string> = new Set(),
): boolean {
  for (const topic of topics) {
    if (topic.files.some((f) => f.hash === hash)) return true;
  }
  for (const list of lists) {
    if (list.bookId === hash || ignoreBooks.has(list.bookId)) continue;
    if (list.items.some((s) => s.hash === hash)) return true;
  }
  return false;
}

/**
 * Whether taking this file out of this topic takes the last reference to the
 * book with it — the question that decides whether the reader is unlinking or
 * deleting (LibraryScreen.tsx).
 *
 * The same PDF added to two topics is two FileRefs with one hash, and removing
 * one of them must not delete the book out from under the other; nor may it
 * when a book lists the same document among its supplements. A file with no
 * hash yet (added but never opened) is not a book this can speak for, so it
 * answers no and the caller unlinks.
 */
export function isLastReferenceToBook(
  topics: readonly Topic[],
  topicId: string,
  file: FileRef,
  lists: readonly SupplementList[] = [],
): boolean {
  if (!file.hash) return false;
  const rest = topics.map((t) =>
    t.id === topicId ? { ...t, files: t.files.filter((f) => f.path !== file.path) } : t,
  );
  return !hasOtherReference(file.hash, rest, lists);
}

/**
 * Pure: a retell with one material swapped for another, or null when it does
 * not name the old one. What a translation does to a retell of the original
 * (retire-book.ts): the pass the reader made is over the same work. A retell
 * that already names the new document keeps its own entry and its own
 * decisions, and the old ones are dropped rather than doubled.
 */
export function retellWithMaterialReplaced(retell: Retell, fromId: string, toId: string): Retell | null {
  const names = (id: string) =>
    retell.materials.some((m) => m.bookId === id) || retell.decisions.some((d) => d.bookId === id);
  if (!names(fromId)) return null;
  const hadNew = retell.materials.some((m) => m.bookId === toId);
  const materials = hadNew
    ? retell.materials.filter((m) => m.bookId !== fromId)
    : retell.materials.map((m) => (m.bookId === fromId ? { ...m, bookId: toId } : m));
  const taken = new Set(retell.decisions.filter((d) => d.bookId === toId).map((d) => d.chapter));
  const decisions = retell.decisions
    .filter((d) => d.bookId !== fromId || !taken.has(d.chapter))
    .map((d) => (d.bookId === fromId ? { ...d, bookId: toId } : d));
  return { ...retell, materials, decisions };
}

// Every kind of file named for a book id, in the order deleteBook removes them:
// the marks, threads and prep the engine purges on every device off the
// tombstone, then the caches, the blob and the covers, which only ever existed
// on this one. The paths themselves
// are the table's (palace/kinds.ts) — the shapes are written down once, beside
// the sync range and the merge strategy that read them — and a book-owned kind
// missing from this list fails the guard in tests/palace/derived.test.ts.
const OWNED_BY_A_BOOK: readonly PalaceKind[] = [
  "annotations",
  "supplements",
  "reading-thread",
  "prep-state",
  "prep-note",
  "prep-cache",
  "fulltext",
  "figures",
  "book-pdf",
  "book-epub",
  "pagination",
  "cover-image",
  "cover-meta",
  "cover-failure",
];

/**
 * Everything of this book's that is a file on this device, as AppData-relative
 * paths.
 *
 * The synced half is deleted here as well as by the engine: the tombstone takes
 * those paths off every device on the next pass, and this device deletes its
 * own copies now so the shelf is right before that pass runs. prep-<bookId>/
 * goes as a directory, which is what takes its pdf/ sub-cache with it.
 *
 * The three cover files go too. Leaving them would be a picture of a deleted
 * book on disk, and — because a cover is filed under the book id — the same
 * picture again the day the reader imports the same PDF.
 */
export function deadLocalPathsFor(bookId: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  for (const kind of OWNED_BY_A_BOOK) {
    const path = rowOf(kind).pathFor?.(bookId);
    if (path === undefined) continue;
    if (path.endsWith("/")) {
      // Without the trailing slash the sync range wants: these go to a
      // directory remove, not to a path matcher.
      const dir = path.slice(0, -1);
      if (!dirs.includes(dir)) dirs.push(dir);
    } else if (!files.includes(path)) {
      files.push(path);
    }
  }
  return { files, dirs };
}
