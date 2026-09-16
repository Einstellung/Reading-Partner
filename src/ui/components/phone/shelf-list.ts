// The phone's shelf, minus React (docs/70): what each of a topic's files is,
// whether this device has it, and what tapping it does.
//
// The phone opens EPUBs and nothing else, and its books channel is off, so a
// card here answers two questions the desk's shelf never has to ask: is this a
// format this shell can draw, and are the bytes even on this device. Both are
// decided here so the grid only renders the answer.

import { isArticleEntry, type LibraryEntry } from "../../../platform/app/library";
import { mostRecentlyOpened, type FileRef, type Topic } from "../../../platform/app/topics";
import { articleRowLine } from "../shelf/article-row";
import { displayFileTitle } from "../shelf/file-title";

// What the phone can do with a file. "pdf" is drawn like any other book — its
// cover renders — and says so only when it is tapped.
export type MaterialFormat = "epub" | "pdf";

export interface ShelfMaterial {
  file: FileRef;
  bookId: string | null;
  format: MaterialFormat;
  title: string;
  // Whether the blob is on this device. A phone mirrors no books, so an EPUB
  // read on the desk is in the account and not here until it is asked for.
  onDevice: boolean;
  // An EPUB the app built out of a web article (library kind "article"). It is
  // an EPUB and opens as one; it is drawn as a row rather than a cover, the way
  // the desk's Materials section draws one.
  article: boolean;
  // Where an article came from and when, already joined (shelf/article-row.ts).
  // Empty on a book, which has its cover to say what it is.
  line: string;
}

/**
 * One topic's files, as the phone draws them.
 *
 * `onDevice` is the set of book ids whose blob is in the library directory; a
 * file with no book id has never been imported, so it is not on the device
 * either. Order is the order the files arrive in (topics.sortedFiles: most
 * recently opened first), the same order the desk's shelf uses.
 */
export function shelfMaterials(
  files: readonly FileRef[],
  entries: Record<string, LibraryEntry>,
  onDevice: ReadonlySet<string>,
): ShelfMaterial[] {
  return files.map((file) => {
    const entry = file.hash ? entries[file.hash] : undefined;
    return {
      file,
      bookId: file.hash ?? null,
      format: entry?.format === "epub" ? "epub" : "pdf",
      title: displayFileTitle(file.name),
      onDevice: file.hash !== undefined && onDevice.has(file.hash),
      article: isArticleEntry(entry),
      line: entry && isArticleEntry(entry) ? articleRowLine(entry) : "",
    };
  });
}

/**
 * The book the home screen offers to continue (docs/70). The most recently
 * opened one across every topic, as the vestibule picks it — with the files
 * that are not EPUBs taken out first, because the phone cannot open those and
 * an entry point that leads nowhere is worse than none.
 */
export interface ContinueBook {
  topicId: string;
  topicName: string;
  bookId: string;
  path: string;
  title: string;
}

export function continueReading(
  topics: readonly Topic[],
  entries: Record<string, LibraryEntry>,
): ContinueBook | null {
  const readable = topics.map((topic) => ({
    ...topic,
    files: topic.files.filter((f) => f.hash !== undefined && entries[f.hash]?.format === "epub"),
  }));
  const recent = mostRecentlyOpened(readable);
  if (!recent || !recent.file.hash) return null;
  return {
    topicId: recent.topic.id,
    topicName: recent.topic.name,
    bookId: recent.file.hash,
    path: recent.file.path,
    title: displayFileTitle(recent.file.name),
  };
}

// Whether the account can be asked for a book right now. Both halves are the
// sync module's own words (platform/sync): a device that was never configured
// and one that is signed out cannot fetch, and the shelf says which.
export interface FetchAbility {
  configured: boolean;
  signedIn: boolean;
}

export type MaterialTap =
  // Open it in the phone's reader.
  | { kind: "open" }
  // Say that PDFs are read elsewhere.
  | { kind: "pdf" }
  // Pull this one book out of the account, then open it.
  | { kind: "download"; bookId: string }
  // The bytes are elsewhere and this device cannot go and get them.
  | { kind: "unavailable"; why: string };

export const PDF_ELSEWHERE = "PDFs open on iPad and desktop";
const NOT_CONFIGURED = "This build has no Google account set up, so it cannot download the book";
const SIGNED_OUT = "Sign in to your account in Settings to download this book";
const NO_BOOK_ID = "This file has never been imported, so there is nothing to download";

/** What a tap on one card does. */
export function materialTap(m: ShelfMaterial, can: FetchAbility): MaterialTap {
  if (m.format === "pdf") return { kind: "pdf" };
  if (m.onDevice) return { kind: "open" };
  if (!m.bookId) return { kind: "unavailable", why: NO_BOOK_ID };
  if (!can.configured) return { kind: "unavailable", why: NOT_CONFIGURED };
  if (!can.signedIn) return { kind: "unavailable", why: SIGNED_OUT };
  return { kind: "download", bookId: m.bookId };
}

/**
 * The line over a card that is not a plain openable book: where the bytes are,
 * or which format it is. Null on a book that is here and openable — that card
 * says what every shelf card says.
 */
export function materialNote(m: ShelfMaterial, downloading: boolean): string | null {
  if (m.format === "pdf") return "PDF";
  if (downloading) return "Downloading…";
  return m.onDevice ? null : "In the cloud";
}
