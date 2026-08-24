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

export function libraryPdfPath(bookId: string): string {
  return `${LIBRARY_DIR}/${bookId}.pdf`;
}

export interface LibraryEntry {
  hash: string;
  title: string;
  originalFilename: string;
  addedAt: number;
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

// Whether the library holds the authoritative copy of a book.
export function libraryHas(bookId: string): Promise<boolean> {
  return appData.exists(libraryPdfPath(bookId));
}

// Read a book's authoritative copy back for opening.
export function readLibraryBook(bookId: string): Promise<Uint8Array> {
  return appData.readBytes(libraryPdfPath(bookId));
}

export async function getLibraryEntry(bookId: string): Promise<LibraryEntry | null> {
  return (await loadStore()).books[bookId] ?? null;
}

// Import a PDF by its bytes: compute the book id, copy the bytes into the library
// on first sight, and register title/originalFilename. Idempotent — re-importing
// the same content neither re-copies the blob nor overwrites the registry.
// originalPath is always a stored topic file path, which topics.ts normalized on
// the way in (path.ts), so the basename here is the real filename.
export async function importBook(bytes: Uint8Array, originalPath: string): Promise<LibraryEntry> {
  const hash = await contentHash(bytes);
  await ensureDir();
  if (!(await libraryHas(hash))) {
    await appData.writeBytes(libraryPdfPath(hash), bytes);
  }
  const store = await loadStore();
  const existing = store.books[hash];
  if (existing) return existing;
  const entry: LibraryEntry = {
    hash,
    title: basename(originalPath),
    originalFilename: basename(originalPath),
    addedAt: Date.now(),
  };
  await saveStore(addEntry(store, entry));
  return entry;
}
