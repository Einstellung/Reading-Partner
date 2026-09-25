// Putting the translation where the original was.
//
// The translation is a different file (translate-article.ts says why), so the
// shelf ends up with two documents unless something takes the first one away.
// This is that something, and what it owns is the order — which is the whole of
// it, because every step here can fail and the reader must never be left with
// neither document or with marks that point at one that is gone.
//
//   1. Translate. Nothing is written until this comes back: a run that fails
//      costs the calls and leaves the shelf exactly as it was.
//   2. Import the new bytes and list them in the topic. From here the reader has
//      both documents, which is the only overlap state that is safe to be
//      interrupted in — the original still opens, and so does the translation.
//   3. Move the marks (carry-marks.ts), written under the new book id before the
//      old one is touched. A crash here loses nothing: the originals are still
//      filed under a book that still exists.
//   4. Move the conversations. A thread is filed under a book id, so a new file
//      means a new key and a conversation that is not moved is one the reader
//      loses by having the article translated (docs/03: a thread outlives the
//      material it was opened on). Ids, messages and anchors are kept; only the
//      book the file is for changes.
//   5. Retire the original (reading/delete/retire-book.ts): what is about the
//      work — reading position, supplements, prep notes, retells, observations,
//      every shelf and book that listed it — moves to the translation, and only
//      the original's own bytes and caches go. Last, because everything that had
//      to be read off the old book has been read by now — and it deletes by the
//      old id, which is no longer the key the moved conversations are under.
//
// Every side effect is injected, so the order above is what the test pins down
// rather than what a filesystem happens to do.

import type { ImportMeta, LibraryEntry } from "../../platform/app/library";
import type { Thread } from "../../platform/app/threads";
import { carryMarks, type CarryTarget, type MarkRecord } from "./carry-marks";
import type { TranslatedArticle } from "./translate-article";

/**
 * Where the document being translated is filed, and therefore where the
 * translation goes in its place (docs/67). The same shape the ingest files a new
 * document by (reading/ingest/article.ts: IngestTarget), because it is the same
 * question: a topic's shelf, or one book's supplements.
 */
export type TranslationHome =
  | { kind: "topic"; topicId: string | null }
  | { kind: "book"; bookId: string };

export interface ReplaceDeps {
  readBook(bookId: string): Promise<Uint8Array>;
  translate(
    bytes: Uint8Array,
    onProgress: (done: number, total: number) => void,
  ): Promise<TranslatedArticle>;
  hash(bytes: Uint8Array): Promise<string>;
  importBook(bytes: Uint8Array, path: string, meta: ImportMeta): Promise<LibraryEntry>;
  /** List the new document in the topic the original was filed under. */
  attach(topicId: string, path: string, hash: string): Promise<void>;
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
  /** Every conversation filed under a book, the originals included. */
  loadThreads(bookId: string): Promise<Thread[]>;
  /** File those conversations under another book, ids and all. */
  adoptThreads(bookId: string, threads: readonly Thread[]): Promise<void>;
  /** The new document, opened far enough for a mark to be relocated in it. */
  targetOf(bytes: Uint8Array): CarryTarget;
  /** Move the work onto the successor and delete the original's bytes. */
  retireOriginal(bookId: string, successor: { hash: string; path: string }): Promise<void>;
}

export interface ReplaceResult {
  entry: LibraryEntry;
  /** The reference the topic lists the translation under. */
  path: string;
  blocks: number;
  moved: number;
  unmatched: number;
  /** Conversations moved onto the translation. */
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

/**
 * Pure: what the translation is called on the shelf. The original's name with a
 * suffix, because two rows reading the same words is the one thing a reader
 * cannot tell apart — and the extension is always .epub, whatever the original
 * file was called.
 */
export function translatedFileName(originalFilename: string): string {
  const base = originalFilename.replace(/\.[^./\\]+$/, "") || originalFilename;
  return `${base}-zh.epub`;
}

/**
 * Pure: what the translation is listed as among a book's supplements — the file
 * name without its extension, which is how the ingest names a row
 * (reading/ingest/article.ts) and therefore what a [Title p.N] citation says.
 */
export function translatedTitle(originalFilename: string): string {
  return translatedFileName(originalFilename).replace(/\.[^.]+$/, "");
}

/** Pure: the reference a document is listed under, matching ingest/article.ts. */
export function documentPathOf(hash: string, fileName: string): string {
  return `library/${hash}/${fileName}`;
}

/** Pure: the one line the conversation gets when a translation finishes. */
export function summaryLine(title: string, result: ReplaceResult): string {
  const marks =
    result.moved === 0 && result.unmatched === 0
      ? "no marks to move"
      : `${result.moved} mark${result.moved === 1 ? "" : "s"} moved` +
        (result.unmatched === 0
          ? ""
          : `, ${result.unmatched} could not be moved`);
  return `Translated "${title}": ${result.blocks} blocks, ${marks}.`;
}

/**
 * Translate a document on the shelf and put the result in its place.
 *
 * Throws with a sentence a chat can print. Whatever it throws, the original is
 * still on the shelf: the delete is the last thing that happens.
 */
export async function replaceWithTranslation(
  entry: LibraryEntry,
  home: TranslationHome,
  deps: ReplaceDeps,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ReplaceResult> {
  const original = await deps.readBook(entry.hash);
  const translated = await deps.translate(original, onProgress);

  const fileName = translatedFileName(entry.originalFilename);
  const path = documentPathOf(await deps.hash(translated.bytes), fileName);
  const meta: ImportMeta = {
    kind: entry.kind,
    sourceUrl: entry.sourceUrl,
    byline: entry.byline,
    publishedAt: entry.publishedAt,
    translatedFrom: entry.hash,
  };
  const fresh = await deps.importBook(translated.bytes, path, meta);
  if (home.kind === "book") {
    await deps.replaceSupplement(home.bookId, entry.hash, {
      hash: fresh.hash,
      title: translatedTitle(entry.originalFilename),
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    });
  } else if (home.topicId) {
    await deps.attach(home.topicId, path, fresh.hash);
  }

  // The marks, by their words. A mark that cannot be found is left where it is
  // and counted: it dies with the original, and the count is what the reader is
  // told instead of a guess at where it belonged.
  const marks = await deps.loadMarks(entry.hash);
  const carried = carryMarks(marks, deps.targetOf(translated.bytes));
  if (carried.moved.length > 0) await deps.saveMarks(fresh.hash, carried.moved);

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
    blocks: translated.blocks,
    moved: carried.moved.length,
    unmatched: carried.unmatched.length,
    threads: threads.length,
    orphanedThreads: orphaned.length,
  };
}
