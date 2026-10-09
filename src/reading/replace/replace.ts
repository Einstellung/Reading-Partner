// Putting one document in another's place on the shelf: a translation where the
// article was (reading/translate/replace.ts), or a new version of a book. What
// the two share is everything after the new bytes exist, and what this owns is
// the order — which is the whole of it, because every step can fail and the
// reader must never be left with neither document or with marks that point at
// one that is gone.
//
//   1. Import the new bytes and list them where the original was filed. From
//      here the reader has both documents, which is the only overlap state that
//      is safe to be interrupted in — the original still opens, and so does
//      the new one.
//   2. Move the marks (carry-marks.ts), written under the new book id before the
//      old one is touched. A crash here loses nothing: the originals are still
//      filed under a book that still exists.
//   3. Move the reading position, rewritten onto the new file's words.
//   4. Move the conversations. A thread is filed under a book id, so a new file
//      means a new key and a conversation that is not moved is one the reader
//      loses by replacing the document (docs/03: a thread outlives the material
//      it was opened on). Ids, messages and anchors are kept; only the book the
//      file is for changes.
//   5. Retire the original (reading/delete/retire-book.ts): what is about the
//      work — supplements, prep notes, retells, observations, every shelf and
//      book that listed it — moves to the new document, and only the original's
//      own bytes and caches go. Last, because everything that had to be read off
//      the old book has been read by now — and it deletes by the old id, which is
//      no longer the key the moved conversations are under.
//
// Every side effect is injected, so the order above is what the test pins down
// rather than what a filesystem happens to do.

import type { ImportMeta, LibraryEntry } from "../../platform/app/library";
import type { ViewState } from "../../platform/app/reader-contract";
import type { Thread } from "../../platform/app/threads";
import { t } from "../../i18n";
import type { CarryResult, MarkRecord } from "./carry-marks";

/**
 * Where the document being replaced is filed, and therefore where its successor
 * goes (docs/67). The same shape the ingest files a new document by
 * (reading/ingest/article.ts: IngestTarget), because it is the same question: a
 * topic's shelf, or one book's supplements.
 */
export type DocumentHome =
  | { kind: "topic"; topicId: string | null }
  | { kind: "book"; bookId: string };

/** The document taking the original's place, before it is on the shelf. */
export interface SuccessorFile {
  bytes: Uint8Array;
  /** The file name the topic lists it under. */
  fileName: string;
  meta: ImportMeta;
  /** What it is called among a book's supplements, when it is one. */
  title: string;
}

export interface ReplaceDeps {
  hash(bytes: Uint8Array): Promise<string>;
  importBook(bytes: Uint8Array, path: string, meta: ImportMeta): Promise<LibraryEntry>;
  /** List the new document in the topic the original was filed under. */
  attach(topicId: string, path: string, hash: string): Promise<unknown>;
  /**
   * Put the new document in the original's place among a book's supplements:
   * the row is one row before and after, under the new document's id.
   */
  replaceSupplement(
    bookId: string,
    oldHash: string,
    ref: { hash: string; title: string; sourceUrl?: string },
  ): Promise<void>;
  loadMarks(bookId: string): Promise<MarkRecord[]>;
  saveMarks(bookId: string, marks: MarkRecord[]): Promise<void>;
  /** Relocate the original's marks onto the new file (carry-marks.ts for EPUB). */
  carryMarks(marks: MarkRecord[], original: Uint8Array, successor: Uint8Array): Promise<CarryResult>;
  getViewState(bookId: string): Promise<ViewState | null>;
  saveViewState(bookId: string, state: ViewState): Promise<void>;
  /** The saved position, moved onto the new file (carry-marks.ts: carryPosition). */
  carryPosition(state: ViewState, original: Uint8Array, successor: Uint8Array): Promise<ViewState>;
  /** Every conversation filed under a book, the originals included. */
  loadThreads(bookId: string): Promise<Thread[]>;
  /** File those conversations under another book, ids and all. */
  adoptThreads(bookId: string, threads: readonly Thread[]): Promise<void>;
  /** Move the work onto the successor and delete the original's bytes. */
  retireOriginal(bookId: string, successor: { hash: string; path: string }): Promise<void>;
}

export interface ReplaceResult {
  entry: LibraryEntry;
  /** The reference the topic lists the new document under. */
  path: string;
  moved: number;
  unmatched: number;
  /** Conversations moved onto the new document. */
  threads: number;
  /** Of those, the ones whose mark did not come across. */
  orphanedThreads: number;
}

/**
 * Pure: which of a book's conversations is left pointing at a mark that is not
 * in the new document.
 *
 * The dangling id is not blanked. A mark thread is told from the book-level one
 * by having an annotation id at all (platform/app/threads.ts: threadKind), so
 * clearing it would turn a side conversation into a second lesson — and a thread
 * whose mark is gone is a state the reader can already produce by deleting the
 * mark, which every reader of these is written for. What is owed is the count.
 */
export function orphanedThreadIds(
  threads: readonly Thread[],
  movedMarkIds: ReadonlySet<string>,
): string[] {
  return threads
    .filter((t) => t.annotationId !== "" && !movedMarkIds.has(t.annotationId))
    .map((t) => t.id);
}

/** Pure: the reference a document is listed under, matching ingest/article.ts. */
export function documentPathOf(hash: string, fileName: string): string {
  return `library/${hash}/${fileName}`;
}

/**
 * Pure: the marks the new document ends up with. The carried ones join what it
 * already had — a file the reader had put on the shelf before is the same book
 * id, marks and all — and a carried mark whose id it already holds is not
 * written twice.
 */
export function mergedMarks(existing: readonly MarkRecord[], carried: readonly MarkRecord[]): MarkRecord[] {
  const held = new Set(existing.map((m) => String(m.id)));
  return [...existing, ...carried.filter((m) => !held.has(String(m.id)))];
}

/** Pure: how the marks came across, as the half sentence both callers end on. */
export function marksClause(result: Pick<ReplaceResult, "moved" | "unmatched">): string {
  if (result.moved === 0 && result.unmatched === 0) return t("reader.translate.marksNone");
  const moved = t("reader.translate.marksMoved", { count: result.moved });
  return result.unmatched === 0
    ? moved
    : t("reader.translate.marksPartial", { moved, unmatched: result.unmatched });
}

/**
 * Put `successor` where `entry` was and retire `entry`.
 *
 * Whatever it throws, the original is still on the shelf: the delete is the
 * last thing that happens.
 */
export async function replaceDocument(
  entry: LibraryEntry,
  home: DocumentHome,
  original: Uint8Array,
  successor: SuccessorFile,
  deps: ReplaceDeps,
): Promise<ReplaceResult> {
  const path = documentPathOf(await deps.hash(successor.bytes), successor.fileName);
  const fresh = await deps.importBook(successor.bytes, path, successor.meta);
  if (fresh.hash === entry.hash) throw new Error("the new file is the same as the one it replaces");
  if (home.kind === "book") {
    await deps.replaceSupplement(home.bookId, entry.hash, {
      hash: fresh.hash,
      title: successor.title,
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    });
  } else if (home.topicId) {
    await deps.attach(home.topicId, path, fresh.hash);
  }

  // The marks, by their words. A mark that cannot be found is left where it is
  // and counted: it dies with the original, and the count is what the reader is
  // told instead of a guess at where it belonged.
  const marks = await deps.loadMarks(entry.hash);
  const carried = await deps.carryMarks(marks, original, successor.bytes);
  if (carried.moved.length > 0) {
    const existing = await deps.loadMarks(fresh.hash);
    await deps.saveMarks(fresh.hash, mergedMarks(existing, carried.moved));
  }

  // Where the reader was. Over whatever the new document had: the reader is
  // replacing the one they were reading, so that is the place to come back to.
  const position = await deps.getViewState(entry.hash);
  if (position) {
    await deps.saveViewState(fresh.hash, await deps.carryPosition(position, original, successor.bytes));
  }

  // The conversations, whole. Moved before the delete and under the new key, so
  // the delete — which works by the old id — cannot reach them.
  const threads = await deps.loadThreads(entry.hash);
  const movedMarkIds = new Set(carried.moved.map((mark) => String(mark.id)));
  const orphaned = orphanedThreadIds(threads, movedMarkIds);
  if (threads.length > 0) await deps.adoptThreads(fresh.hash, threads);

  await deps.retireOriginal(entry.hash, { hash: fresh.hash, path });

  return {
    entry: fresh,
    path,
    moved: carried.moved.length,
    unmatched: carried.unmatched.length,
    threads: threads.length,
    orphanedThreads: orphaned.length,
  };
}
