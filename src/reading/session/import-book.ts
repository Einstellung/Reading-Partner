// How a book becomes a row on a shelf, whichever door it came in by: the
// phone's Import button (docs/70), the desk's file dialog, and a book handed
// over from outside the app (shared-file.ts).
//
// The bytes are taken at the door rather than on first open: the path a picker
// or the system hands over may be a copy the system sweeps, so a topic row that
// only points at it may point at nothing later. Once the book is in the library
// the path is only a name. The row is written once, with the book id, because
// topics.json is synced and a second write costs a second revision.
//
// What the bytes are is decided by the bytes, not the name. The formats a shell
// accepts are its own: the phone shell draws EPUB and nothing else, the desk
// draws both.
//
// The phone mirrors no books, so after the import the blob is sent to the
// account by hand, or no other device could open it. That step is separate from
// the import: the book is on the shelf and readable here whether or not the
// upload works.
//
// The io is an argument so this can be run without a filesystem.

import { open } from "@tauri-apps/plugin-dialog";
import { appData } from "../../platform/app/appdata";
import { importBook, type BookFormat } from "../../platform/app/library";
import { normalizeFilePath } from "../../platform/app/path";
import { addFileToTopic } from "../../platform/app/topics";
import { pushBook } from "../../platform/sync";
import { isEpub } from "../epub/sniff";
import { sniffContentType } from "../sources/url";

/** Everything filing a picked path needs: read the bytes, store them, list it. */
export interface FileBookIo {
  /** The file at the absolute path the reader picked, not an AppData one. */
  readFile(path: string): Promise<Uint8Array>;
  importBook(bytes: Uint8Array, originalPath: string): Promise<{ hash: string }>;
  addFileToTopic(topicId: string, path: string, hash: string): Promise<void>;
}

export interface ImportBookIo extends FileBookIo {
  /** The path the reader picked, or null when the picker was dismissed. */
  pickBook(formats: readonly BookFormat[]): Promise<string | null>;
  pushBook(hash: string): Promise<"uploaded" | "no-account">;
}

export const fileBookIo: FileBookIo = {
  readFile: (path) => appData.readPicked(path),
  importBook,
  addFileToTopic,
};

export const importBookIo: ImportBookIo = {
  ...fileBookIo,
  pickBook: async (formats) => {
    const picked = await open({
      multiple: false,
      filters: [
        {
          name: formats.length === 1 ? formats[0].toUpperCase() : "Books",
          extensions: [...formats],
        },
      ],
    });
    return typeof picked === "string" ? picked : null;
  },
  pushBook,
};

export const NOT_AN_EPUB = "That file is not an EPUB, so it was not imported";
export const NOT_A_BOOK = "That file is not a PDF or an EPUB, so it was not imported";
export const UPLOAD_FAILED =
  "The book is on this phone, but it could not be uploaded to your account";

/** What a shell takes in, and what it says about a file it does not. */
export interface Accepted {
  formats: readonly BookFormat[];
  refusal: string;
}

/** The desk and the iPad: both formats the reader opens. */
export const BOOKS: Accepted = { formats: ["pdf", "epub"], refusal: NOT_A_BOOK };
/** The phone: its shell draws EPUB only, so a PDF is refused at the door. */
export const EPUB_ONLY: Accepted = { formats: ["epub"], refusal: NOT_AN_EPUB };

/**
 * What these bytes are, or null when they are neither format the reader opens.
 * EPUB is read from the whole file (an ordinary zip tool repacks a book with
 * its mimetype entry out of place); a PDF is its header.
 */
export function sniffBookFormat(bytes: Uint8Array): BookFormat | null {
  if (isEpub(bytes)) return "epub";
  return sniffContentType(bytes) === "pdf" ? "pdf" : null;
}

export type FileResult =
  | { kind: "refused"; why: string }
  | { kind: "imported"; bookId: string; path: string; format: BookFormat };

export type ImportResult = { kind: "cancelled" } | FileResult;

/**
 * File a path under a topic, bytes and all: read it, check what it is, put it
 * in the library, and write the row with its book id. Nothing is written for a
 * file the shell does not accept, whatever its name says.
 */
export async function fileBook(
  topicId: string,
  rawPath: string,
  accept: Accepted,
  io: FileBookIo = fileBookIo,
): Promise<FileResult> {
  // The form the topic store keeps (docs/pitfall/106), so the path the bytes
  // were read from is the path the row carries.
  const path = normalizeFilePath(rawPath);
  const bytes = await io.readFile(path);
  const format = sniffBookFormat(bytes);
  if (format === null || !accept.formats.includes(format)) {
    return { kind: "refused", why: accept.refusal };
  }
  const { hash } = await io.importBook(bytes, path);
  await io.addFileToTopic(topicId, path, hash);
  return { kind: "imported", bookId: hash, path, format };
}

/** Ask for a book and file it under the topic. */
export async function importPickedBook(
  topicId: string,
  accept: Accepted = BOOKS,
  io: ImportBookIo = importBookIo,
): Promise<ImportResult> {
  const picked = await io.pickBook(accept.formats);
  if (picked === null) return { kind: "cancelled" };
  return fileBook(topicId, picked, accept, io);
}

/** The phone's Import button. */
export function importEpub(
  topicId: string,
  io: ImportBookIo = importBookIo,
): Promise<ImportResult> {
  return importPickedBook(topicId, EPUB_ONLY, io);
}

/**
 * Send an imported book to the account. The line to say, or null when there
 * is nothing to say: uploaded, or no account to upload to — the book is
 * readable here either way.
 */
export async function uploadImported(
  bookId: string,
  io: ImportBookIo = importBookIo,
): Promise<string | null> {
  try {
    await io.pushBook(bookId);
    return null;
  } catch (e) {
    console.warn("failed to upload the imported book", e);
    return UPLOAD_FAILED;
  }
}
