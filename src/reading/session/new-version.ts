// "Replace with a new version…" in the reader's More menu: the reader picks a
// rebuilt copy of the document on screen, and it takes the old one's place with
// the marks, the reading position and the conversations moved across
// (reading/replace/replace.ts, the same pipeline a translation goes through).
//
// A file is a new version only if it is the same kind of file and not the same
// file: an EPUB replaces an EPUB, a PDF a PDF, and bytes that hash to the book
// already open would retire the book in favour of itself. Both are refused
// before anything is written.
//
// The io is an argument so this can be run without a filesystem.

import { contentHash } from "../../platform/app/content-hash";
import { readLibraryBook, type BookFormat, type LibraryEntry } from "../../platform/app/library";
import { basename, normalizeFilePath } from "../../platform/app/path";
import { marksClause, replaceDocument, type DocumentHome, type ReplaceResult, type SuccessorFile } from "../replace/replace";
import { bookRetirer, liveReplaceDeps } from "../replace/live";
import { fileBookIo, importBookIo, sniffBookFormat } from "./import-book";

export interface NewVersionIo {
  /** The path the reader picked, or null when the picker was dismissed. */
  pickBook(formats: readonly BookFormat[]): Promise<string | null>;
  /** The file at the absolute path the reader picked, not an AppData one. */
  readFile(path: string): Promise<Uint8Array>;
  /** The document being replaced, out of the library. */
  readBook(bookId: string): Promise<Uint8Array>;
  hash(bytes: Uint8Array): Promise<string>;
  replace(
    entry: LibraryEntry,
    home: DocumentHome,
    original: Uint8Array,
    successor: SuccessorFile,
  ): Promise<ReplaceResult>;
}

export const liveNewVersionIo: NewVersionIo = {
  pickBook: importBookIo.pickBook,
  readFile: fileBookIo.readFile,
  readBook: readLibraryBook,
  hash: contentHash,
  replace: (entry, home, original, successor) => {
    const retire = bookRetirer();
    if (!retire) throw new Error("the app is not ready to replace a document yet");
    return replaceDocument(entry, home, original, successor, liveReplaceDeps(retire));
  },
};

/** What the reader who had the old document open is moved onto. */
export interface NewVersionReopen {
  hash: string;
  /** The reference the topic lists it under. */
  path: string;
  topicId: string | null;
  /** The book it is a supplement of, when it is one: the session stays that book's. */
  bookId: string | null;
  title: string;
}

export type NewVersionResult =
  | { kind: "cancelled" }
  | { kind: "refused"; why: string }
  | { kind: "replaced"; result: ReplaceResult; reopen: NewVersionReopen; line: string };

export const SAME_FILE = "That file is the version already open, so nothing was replaced";

export function wrongFormat(format: BookFormat): string {
  return `That file is not ${format === "epub" ? "an EPUB" : "a PDF"}, so it cannot replace this one`;
}

/** Pure: the file name without its extension, which is what a supplement row is called. */
export function titleOfFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || fileName;
}

/** Pure: the sentence the reader is left with. */
export function newVersionLine(title: string, result: Pick<ReplaceResult, "moved" | "unmatched">): string {
  return `Replaced "${title}" with the new version: ${marksClause(result)}.`;
}

/**
 * Ask for a file and put it in the place of `entry`, which is filed at `home`.
 * `title` is what the reader knows the document as, for the closing line.
 */
export async function replaceWithNewVersion(
  entry: LibraryEntry,
  home: DocumentHome,
  title: string,
  io: NewVersionIo = liveNewVersionIo,
  // Called once the file is accepted and the replacement begins, so a screen
  // can say so without saying it while the picker is still up.
  onStart: () => void = () => {},
): Promise<NewVersionResult> {
  const original = await io.readBook(entry.hash);
  const format = entry.format ?? sniffBookFormat(original) ?? "pdf";
  const picked = await io.pickBook([format]);
  if (picked === null) return { kind: "cancelled" };
  const path = normalizeFilePath(picked);
  const bytes = await io.readFile(path);
  if (sniffBookFormat(bytes) !== format) return { kind: "refused", why: wrongFormat(format) };
  if ((await io.hash(bytes)) === entry.hash) return { kind: "refused", why: SAME_FILE };

  const fileName = basename(path);
  onStart();
  const result = await io.replace(entry, home, original, {
    bytes,
    fileName,
    meta: {
      kind: entry.kind,
      sourceUrl: entry.sourceUrl,
      byline: entry.byline,
      publishedAt: entry.publishedAt,
    },
    title: titleOfFile(fileName),
  });
  return {
    kind: "replaced",
    result,
    reopen: {
      hash: result.entry.hash,
      path: result.path,
      topicId: home.kind === "topic" ? home.topicId : null,
      bookId: home.kind === "book" ? home.bookId : null,
      title: home.kind === "book" ? titleOfFile(fileName) : fileName,
    },
    line: newVersionLine(title, result),
  };
}
