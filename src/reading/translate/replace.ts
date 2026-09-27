// Putting the translation where the original was.
//
// The translation is a different file (translate-article.ts says why), so the
// shelf ends up with two documents unless something takes the first one away.
// That is reading/replace/replace.ts, which a new version of a book goes
// through too; what is the translation's own is the step in front of it and
// what the new file is called.
//
// Translate first. Nothing is written until this comes back: a run that fails
// costs the calls and leaves the shelf exactly as it was.

import type { ImportMeta, LibraryEntry } from "../../platform/app/library";
import {
  marksClause,
  replaceDocument,
  type DocumentHome,
  type ReplaceDeps as DocumentReplaceDeps,
  type ReplaceResult as DocumentReplaceResult,
} from "../replace/replace";
import type { TranslatedArticle } from "./translate-article";

export { documentPathOf, orphanedThreadIds } from "../replace/replace";

/**
 * Where the document being translated is filed, and therefore where the
 * translation goes in its place (docs/67).
 */
export type TranslationHome = DocumentHome;

export interface ReplaceDeps extends DocumentReplaceDeps {
  readBook(bookId: string): Promise<Uint8Array>;
  translate(
    bytes: Uint8Array,
    onProgress: (done: number, total: number) => void,
  ): Promise<TranslatedArticle>;
}

export interface ReplaceResult extends DocumentReplaceResult {
  blocks: number;
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

/** Pure: the one line the conversation gets when a translation finishes. */
export function summaryLine(title: string, result: ReplaceResult): string {
  return `Translated "${title}": ${result.blocks} blocks, ${marksClause(result)}.`;
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
  const meta: ImportMeta = {
    kind: entry.kind,
    sourceUrl: entry.sourceUrl,
    byline: entry.byline,
    publishedAt: entry.publishedAt,
    translatedFrom: entry.hash,
  };
  const result = await replaceDocument(
    entry,
    home,
    original,
    {
      bytes: translated.bytes,
      fileName: translatedFileName(entry.originalFilename),
      meta,
      title: translatedTitle(entry.originalFilename),
    },
    deps,
  );
  return { ...result, blocks: translated.blocks };
}
