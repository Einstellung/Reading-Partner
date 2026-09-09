// Content-addressed book library. A book's identity is the sha256 of its file
// bytes (the "book id"), not its path, so its reading position, marks and AI
// threads follow the content across a move/rename and across devices (docs/13).
// Opening any PDF imports a copy into AppData/library/<bookId>.pdf; that copy is
// the authoritative one, so later edits to the original file on disk don't
// affect the app.

import { appData } from "./appdata";
import { readGuardedJson, writeTextAtomic } from "./atomic-fs";
import { contentHash } from "./content-hash";
import { basename, decodeLegacyName } from "./path";

const LIBRARY_DIR = "library";
// Exported so the shelf's pull route can name it once (reading/pull-routes.ts).
export const LIBRARY_FILE = "library.json";

// Which of the two kinds of book file this is. Absent means PDF: every entry
// written before EPUB ingestion existed is one, and library.json is a synced
// file that is never migrated in place (docs/39 §6).
export type BookFormat = "pdf" | "epub";

export function bookExtension(format: BookFormat | undefined): string {
  return format === "epub" ? "epub" : "pdf";
}

// The library copy's path. The extension follows the format, so nothing on the
// way to opening a book has to be told what kind it is a second time.
export function libraryBookPath(bookId: string, format?: BookFormat): string {
  return `${LIBRARY_DIR}/${bookId}.${bookExtension(format)}`;
}

export interface LibraryEntry {
  hash: string;
  title: string;
  originalFilename: string;
  addedAt: number;
  format?: BookFormat;
}

export interface LibraryStore {
  books: Record<string, LibraryEntry>;
}

// Pure: register an entry if its hash is new. A repeated import is a no-op, so
// the first-seen title/addedAt are preserved.
export function addEntry(store: LibraryStore, entry: LibraryEntry): LibraryStore {
  if (store.books[entry.hash]) return store;
  return { books: { ...store.books, [entry.hash]: entry } };
}

// Pure: take an entry out. Returns the store unchanged — same object — when the
// book is not in it, so deleting a book twice writes no second revision of a
// file the whole sync treats as one unit.
export function removeEntry(store: LibraryStore, bookId: string): LibraryStore {
  if (!store.books[bookId]) return store;
  const books = { ...store.books };
  delete books[bookId];
  return { books };
}

// Pure: decode a title/filename that was taken from a percent-encoded file URL
// (see path.ts). Returns the store unchanged — same object — when there is
// nothing to repair, which is what keeps the repair from writing a new revision
// on every launch (the whole file is one sync unit).
export function healLibrary(store: LibraryStore): LibraryStore {
  let changed = false;
  const books: Record<string, LibraryEntry> = {};
  for (const [id, entry] of Object.entries(store.books)) {
    const title = decodeLegacyName(entry.title);
    const originalFilename = decodeLegacyName(entry.originalFilename);
    if (title === entry.title && originalFilename === entry.originalFilename) {
      books[id] = entry;
      continue;
    }
    changed = true;
    books[id] = { ...entry, title, originalFilename };
  }
  return changed ? { books } : store;
}

async function ensureDir(): Promise<void> {
  try {
    if (!(await appData.exists(LIBRARY_DIR))) {
      await appData.mkdirp(LIBRARY_DIR);
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// The registry read. An empty registry is the answer for a file that is not
// there yet, and for one whose bad content has just been moved aside. It is not
// the answer for a file that is sitting there unread: the shelf cannot be
// rebuilt from anywhere (the PDFs survive in library/, their titles do not), so
// "no books" would be the app telling the reader their library is gone. Raising
// is also what keeps the file from being overwritten — every writer below loads
// before it saves.
async function readStore(): Promise<LibraryStore> {
  const read = await readGuardedJson<LibraryStore>(LIBRARY_FILE, (raw) => {
    const parsed = raw as LibraryStore | null;
    return parsed && typeof parsed === "object" && parsed.books ? parsed : null;
  });
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return { books: {} };
  if (read.savedAs === null) throw new Error(`${LIBRARY_FILE} could not be read`);
  return { books: {} };
}

// Every read hands out repaired names, whether or not the file on disk has been
// rewritten yet.
async function loadStore(): Promise<LibraryStore> {
  return healLibrary(await readStore());
}

async function saveStore(store: LibraryStore): Promise<void> {
  await ensureDir();
  await writeTextAtomic(LIBRARY_FILE, JSON.stringify(store, null, 2));
}

// Rewrite the registry once with the repaired names. A clean library writes
// nothing, so this can run at every launch without producing a sync revision.
// Returns whether it wrote.
export async function repairLibraryNames(): Promise<boolean> {
  const store = await readStore();
  const healed = healLibrary(store);
  if (healed === store) return false;
  await saveStore(healed);
  return true;
}

// The formats, in the order the library is searched for a copy whose format the
// caller does not already know. A book id is the hash of the file's bytes, so at
// most one of the two names can ever exist for one id.
const FORMATS: readonly BookFormat[] = ["pdf", "epub"];

// The library copy's path for a book whose format is not known up front, or null
// when the library holds no copy of it. Every read below goes through this, so
// an entry with no `format` field — every entry written before EPUB ingestion —
// still resolves.
export async function findLibraryBookPath(bookId: string): Promise<string | null> {
  for (const format of FORMATS) {
    const path = libraryBookPath(bookId, format);
    if (await appData.exists(path)) return path;
  }
  return null;
}

// Whether the library holds the authoritative copy of a book.
export async function libraryHas(bookId: string): Promise<boolean> {
  return (await findLibraryBookPath(bookId)) !== null;
}

// Read a book's authoritative copy back for opening. Throws the same way a
// missing file always did when there is no copy.
export async function readLibraryBook(bookId: string): Promise<Uint8Array> {
  const path = (await findLibraryBookPath(bookId)) ?? libraryBookPath(bookId, "pdf");
  return appData.readBytes(path);
}

// What a set of book bytes is, from the bytes themselves. Two formats, two
// magic numbers, and no third answer: this only ever sees a file some caller has
// already decided is a book (intake sniffs properly, reading/epub/sniff.ts, and
// the sync channel carries what another device imported).
export function formatOfBytes(bytes: Uint8Array): BookFormat {
  const zip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  return zip ? "epub" : "pdf";
}

export async function getLibraryEntry(bookId: string): Promise<LibraryEntry | null> {
  return (await loadStore()).books[bookId] ?? null;
}

// Import a book by its bytes: compute the book id, copy the bytes into the
// library on first sight, and register title/originalFilename/format. Idempotent
// — re-importing the same content neither re-copies the blob nor overwrites the
// registry. originalPath is always a stored topic file path, which topics.ts
// normalized on the way in (path.ts), so the basename here is the real filename.
export async function importBook(bytes: Uint8Array, originalPath: string): Promise<LibraryEntry> {
  const hash = await contentHash(bytes);
  const format = formatOfBytes(bytes);
  await ensureDir();
  if (!(await libraryHas(hash))) {
    await appData.writeBytes(libraryBookPath(hash, format), bytes);
  }
  const store = await loadStore();
  const existing = store.books[hash];
  if (existing) return existing;
  const entry: LibraryEntry = {
    hash,
    title: basename(originalPath),
    originalFilename: basename(originalPath),
    addedAt: Date.now(),
    format,
  };
  await saveStore(addEntry(store, entry));
  return entry;
}

// Take a deleted book off the shelf (reading/delete/delete-book.ts). The blob
// under library/ is not touched here: this is the registry, and what the reader
// deleted is removed from disk by the caller in one place.
export async function removeLibraryEntry(bookId: string): Promise<void> {
  const store = await loadStore();
  const next = removeEntry(store, bookId);
  if (next === store) return;
  await saveStore(next);
}
