// Which copy of a topic file to open, and what has to be written down on the way
// (docs/13, M-sync-1). The library holds the authoritative copy, because the
// original path may be gone — moved, or on a device that never had it.
//
// Every door imports the book as it files it (import-book.ts), so the ordinary
// open reads the library and writes nothing. The second route below is a
// repair, not the normal way in: it serves a row written before the doors
// imported, and a row whose library copy is missing. A row another device filed
// carries that device's path (a phone's content:// URI, another machine's
// disk), so when the path cannot be read and the id is known, the copy is asked
// for from the account instead of the open failing on a path that was never
// here.
//
// The io is an argument so this can be run without a filesystem. The default
// binds the real one; App passes nothing.

import { appData } from "../../platform/app/appdata";
import { importBook, libraryHas, readLibraryBook } from "../../platform/app/library";
import { setFileHash, type FileRef } from "../../platform/app/topics";
import { fetchBook } from "../../platform/sync";

export interface BookSourceIo {
  libraryHas(bookId: string): Promise<boolean>;
  readLibraryBook(bookId: string): Promise<Uint8Array>;
  /** The file at the absolute path the reader picked, not an AppData one. */
  readFile(path: string): Promise<Uint8Array>;
  importBook(bytes: Uint8Array, originalPath: string): Promise<{ hash: string }>;
  setFileHash(topicId: string, path: string, hash: string): Promise<void>;
  /** Download the book's blob from the account into the library. */
  fetchBook(bookId: string): Promise<void>;
}

export const bookSourceIo: BookSourceIo = {
  libraryHas,
  readLibraryBook,
  readFile: (path) => appData.readPicked(path),
  importBook,
  setFileHash,
  fetchBook,
};

// The book is neither here nor in the account (not uploaded yet, no account,
// deleted). `why` is the account's answer.
export class BookNotHere extends Error {
  constructor(
    readonly bookId: string,
    readonly why: unknown,
  ) {
    super(`book ${bookId} is not on this device and could not be downloaded`);
  }
}

// The bytes to open and the id everything about this book is keyed by. A file
// whose id is known and whose copy is in the library is read straight from it;
// anything else is read from its original path, imported and its id written
// down, so the next open takes the first route.
export async function resolveBookSource(
  file: FileRef,
  topicId: string,
  io: BookSourceIo = bookSourceIo,
): Promise<{ bookId: string; bytes: Uint8Array }> {
  if (file.hash && (await io.libraryHas(file.hash))) {
    return { bookId: file.hash, bytes: await io.readLibraryBook(file.hash) };
  }
  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(file.path);
  } catch (e) {
    if (!file.hash) throw e;
    try {
      await io.fetchBook(file.hash);
    } catch (fetchErr) {
      throw new BookNotHere(file.hash, fetchErr);
    }
    return { bookId: file.hash, bytes: await io.readLibraryBook(file.hash) };
  }
  const entry = await io.importBook(bytes, file.path);
  const bookId = entry.hash;
  // Nothing to write when the file already carried this id: the copy was simply
  // missing from the library.
  if (file.hash !== bookId) await io.setFileHash(topicId, file.path, bookId);
  return { bookId, bytes };
}

// The topic a book is opened under: the one the door named, or else the one the
// shell is already in. The vestibule's "Continue reading" names it, because it
// opens a book from outside its topic; the topic screen names nothing and its
// own topic answers.
//
// Null is not an open. A book always belongs to a topic (Topic.files is the only
// way one gets in), and the whole reading session is scoped by that topic — the
// event log, prep, memory retrieval, and whether the soul carries observation
// tools at all (soul/self.ts).
export function topicForOpen(named: string | undefined, active: string | null): string | null {
  return named ?? active;
}
