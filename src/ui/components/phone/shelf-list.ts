// The phone's shelf, minus React (docs/70): what each of a topic's files is,
// whether this device has it, and what tapping it does.
//
// The phone draws EPUBs and nothing else, and its books channel is off, so a
// card here answers two questions the desk's shelf never has to ask: is this a
// format this shell can draw, and are the bytes even on this device. Both are
// decided here so the grid only renders the answer.
//
// The first question no longer has "no" for an answer. A PDF is not turned page
// by page on a phone; it is taught, and a tap on one opens the lesson instead of
// the reader. So the two formats part at the destination rather than at the
// door, and everything before it — the bytes, the fetch, the reasons there is
// nothing to fetch — is one path.
//
// Neither question has an answer for a file the library has never described.
// Every door imports the book as it writes the row, so such a row was written
// before that was true, or its library revision has not arrived yet — the two
// files a card is made of (topics.json, library.json) sync apart. Such a card
// says it was not imported rather than guessing PDF, which is what it used to
// do.

import type { Thread } from "../../../platform/app/threads";
import type { TableChapter } from "../../../reading/chapters/table";
import {
  bookFormatOfPath,
  isArticleEntry,
  type LibraryEntry,
} from "../../../platform/app/library";
import { mostRecentlyOpened, type FileRef, type Topic } from "../../../platform/app/topics";
import { articleRowLine } from "../shelf/article-row";
import { displayFileTitle } from "../shelf/file-title";

// What the phone can do with a file. "pdf" is drawn like any other book — its
// cover renders — and opens as a lesson. "unknown" is a file no library entry
// describes and whose name says neither: the shelf says it does not know rather
// than calling it a PDF.
export type MaterialFormat = "epub" | "pdf" | "unknown";

export interface ShelfMaterial {
  file: FileRef;
  bookId: string | null;
  format: MaterialFormat;
  // Whether the library registry on this device describes this file. False for
  // a file the desk added to a topic but has not imported yet, and for one
  // whose topics.json row arrived before the matching library.json revision.
  // The format then comes from the file's name, and there is nothing to fetch.
  filed: boolean;
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
      format: materialFormat(file, entry),
      filed: entry !== undefined,
      title: displayFileTitle(file.name),
      onDevice: file.hash !== undefined && onDevice.has(file.hash),
      article: isArticleEntry(entry),
      line: entry && isArticleEntry(entry) ? articleRowLine(entry) : "",
    };
  });
}

// What is actually known about a file's kind. The entry is the import's own
// answer and wins — an absent `format` there means PDF (platform/app/library.ts).
// Without an entry the name is all there is, and a name that says neither leaves
// the question open.
function materialFormat(file: FileRef, entry: LibraryEntry | undefined): MaterialFormat {
  if (entry) return entry.format === "epub" ? "epub" : "pdf";
  return bookFormatOfPath(file.path) ?? "unknown";
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

// Which door a book opens: the reflow reader, or the lesson.
export type MaterialDoor = "open" | "lesson";

export type MaterialTap =
  // Open it in the phone's reader.
  | { kind: "open" }
  // Teach it instead of drawing it (docs/70): every PDF on this shell.
  | { kind: "lesson"; bookId: string }
  // Pull this one book out of the account, then go through `then`'s door.
  | { kind: "download"; bookId: string; then: MaterialDoor }
  // There is nothing here to open, and no copy this device can go and get.
  | { kind: "unavailable"; why: string };

const NOT_CONFIGURED = "This build has no Google account set up, so it cannot download the book";
const SIGNED_OUT = "Sign in to your account in Settings to download this book";
// No entry and no book id: the desk filed the path and nothing has read the
// file's bytes yet, so no copy of it exists anywhere to be fetched.
export const NOT_IMPORTED = "The desk has not imported this file yet, so there is nothing to get";
// A book id but no entry: the topics row got here before library.json did.
export const NOT_FILED_YET = "This book has not finished syncing to this device yet";

/**
 * What a tap on one card does. A PDF ends at the lesson and an EPUB at the
 * reader; everything in front of that is the same walk, because a lesson needs
 * the bytes on this device exactly as the reader does — it reads the paper here
 * (reading/lesson/open-pdf.ts).
 */
export function materialTap(m: ShelfMaterial, can: FetchAbility): MaterialTap {
  // A file nothing has described, whatever bytes may be beside it: opening it
  // would hand the reflow view something it may not be able to draw, and the
  // lesson a file that may not be a paper.
  if (m.format === "unknown") return { kind: "unavailable", why: NOT_IMPORTED };
  const door: MaterialDoor = m.format === "pdf" ? "lesson" : "open";
  if (m.onDevice) {
    return door === "lesson" ? { kind: "lesson", bookId: m.bookId as string } : { kind: "open" };
  }
  if (!m.bookId) return { kind: "unavailable", why: NOT_IMPORTED };
  if (!m.filed) return { kind: "unavailable", why: NOT_FILED_YET };
  if (!can.configured) return { kind: "unavailable", why: NOT_CONFIGURED };
  if (!can.signedIn) return { kind: "unavailable", why: SIGNED_OUT };
  return { kind: "download", bookId: m.bookId, then: door };
}

/**
 * The line over a card that is not a plain openable book: where the bytes are.
 * Null on a book that is here and openable — that card says what every shelf
 * card says, and for a PDF that is the lesson's own line (lessonNote).
 */
export function materialNote(m: ShelfMaterial, downloading: boolean): string | null {
  if (downloading) return "Downloading…";
  if (m.format === "unknown" || !m.bookId) return "Not imported";
  if (m.onDevice) return null;
  return m.filed ? "In the cloud" : "Not synced yet";
}

/**
 * How far the lesson on this card has got, for the line beside the Lesson mark.
 * Three answers, because that is all a phone can know:
 *
 * - nothing has been said in this book yet;
 * - the lesson is parked on a chapter this device can name;
 * - it is parked on one this device cannot name, or on none at all. The focus
 *   is a chapter number and not a title (platform/app/threads.ts), and the
 *   table that turns one into the other is read out of the full text, which is
 *   local and derived and is not written until the first lesson runs
 *   (palace/kinds.ts). So a book taught on the iPad and not yet here says it is
 *   in a lesson without saying where.
 */
export function lessonNote(
  thread: Pick<Thread, "messages" | "focusChapter"> | null | undefined,
  chapters: readonly TableChapter[] | null,
): string {
  if (!thread || thread.messages.length === 0) return "Not started";
  const title = chapters?.find((c) => c.number === thread.focusChapter)?.title.trim();
  return title ? `On ${title}` : "In a lesson";
}
