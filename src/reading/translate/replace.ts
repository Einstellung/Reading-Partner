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
//   4. Delete the original through the ordinary delete path (reading/delete),
//      which is what takes its topic row, its reading position, its pagination
//      and its prep material with it. Last, because everything that had to be
//      read off the old book has been read by now.
//
// The conversation held on the original goes with it. Threads are filed under a
// book id and this is a different book, so the chat about the article does not
// follow the article — v1 accepts that and the tool's closing line is written
// into the translation's own thread instead (tool-live.ts).
//
// Every side effect is injected, so the order above is what the test pins down
// rather than what a filesystem happens to do.

import type { ImportMeta, LibraryEntry } from "../../platform/app/library";
import { carryMarks, type CarryTarget, type MarkRecord } from "./carry-marks";
import type { TranslatedArticle } from "./translate-article";

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
  loadMarks(bookId: string): Promise<MarkRecord[]>;
  saveMarks(bookId: string, marks: MarkRecord[]): Promise<void>;
  /** The new document, opened far enough for a mark to be relocated in it. */
  targetOf(bytes: Uint8Array): CarryTarget;
  deleteBook(bookId: string): Promise<void>;
}

export interface ReplaceResult {
  entry: LibraryEntry;
  /** The reference the topic lists the translation under. */
  path: string;
  blocks: number;
  moved: number;
  unmatched: number;
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
  topicId: string | null,
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
  if (topicId) await deps.attach(topicId, path, fresh.hash);

  // The marks, by their words. A mark that cannot be found is left where it is
  // and counted: it dies with the original, and the count is what the reader is
  // told instead of a guess at where it belonged.
  const marks = await deps.loadMarks(entry.hash);
  const carried = carryMarks(marks, deps.targetOf(translated.bytes));
  if (carried.moved.length > 0) await deps.saveMarks(fresh.hash, carried.moved);

  await deps.deleteBook(entry.hash);

  return {
    entry: fresh,
    path,
    blocks: translated.blocks,
    moved: carried.moved.length,
    unmatched: carried.unmatched.length,
  };
}
