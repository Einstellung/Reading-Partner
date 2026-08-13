// Which copy of a topic file to open, and what has to be written down on the way
// (docs/13, M-sync-1). The library holds the authoritative copy once a file has
// been imported, because the original path may be gone — moved, or on a device
// that never had it.
//
// The io is an argument so this can be run without a filesystem. The default
// binds the real one; App passes nothing.

import { readFile } from "@tauri-apps/plugin-fs";
import { importBook, libraryHas, readLibraryBook } from "../../platform/app/library";
import { migrateBookLive } from "../../platform/app/migrate";
import { hashPath } from "../../platform/app/storage";
import { setFileHash, type FileRef } from "../../platform/app/topics";

export interface BookSourceIo {
  libraryHas(bookId: string): Promise<boolean>;
  readLibraryBook(bookId: string): Promise<Uint8Array>;
  readFile(path: string): Promise<Uint8Array>;
  importBook(bytes: Uint8Array, originalPath: string): Promise<{ hash: string }>;
  // Legacy path-hash-keyed data (annotations, threads, position) moved under the
  // book id the content hash gives it.
  migrateBookLive(oldKey: string, newKey: string): Promise<void>;
  pathHash(path: string): string;
  setFileHash(topicId: string, path: string, hash: string): Promise<void>;
}

export const bookSourceIo: BookSourceIo = {
  libraryHas,
  readLibraryBook,
  readFile,
  importBook,
  migrateBookLive,
  pathHash: hashPath,
  setFileHash,
};

// The bytes to open and the id everything about this book is keyed by. A file
// whose id is known and whose copy is in the library is read straight from it;
// anything else is read from its original path, imported, migrated and backfilled
// so the next open takes the first route.
export async function resolveBookSource(
  file: FileRef,
  topicId: string,
  io: BookSourceIo = bookSourceIo,
): Promise<{ bookId: string; bytes: Uint8Array }> {
  if (file.hash && (await io.libraryHas(file.hash))) {
    return { bookId: file.hash, bytes: await io.readLibraryBook(file.hash) };
  }
  const bytes = await io.readFile(file.path);
  const entry = await io.importBook(bytes, file.path);
  const bookId = entry.hash;
  await io.migrateBookLive(io.pathHash(file.path), bookId);
  // Nothing to write when the file already carried this id: the copy was simply
  // missing from the library.
  if (file.hash !== bookId) await io.setFileHash(topicId, file.path, bookId);
  return { bookId, bytes };
}
