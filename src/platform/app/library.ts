// Content-addressed book library. A book's identity is the sha256 of its file
// bytes (the "book id"), not its path, so its reading position, marks and AI
// threads follow the content across a move/rename and across devices (docs/13).
// Opening any PDF imports a copy into AppData/library/<bookId>.pdf; that copy is
// the authoritative one, so later edits to the original file on disk don't
// affect the app.

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { readGuardedJson, writeTextAtomic } from "./atomic-fs";
import { contentHash } from "./content-hash";
import { basename, decodeLegacyName } from "./path";

const LIBRARY_DIR = "library";
const LIBRARY_FILE = "library.json";

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
    if (!(await exists(LIBRARY_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(LIBRARY_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// The registry read, plus whether it is safe to write the result back. The shelf
// cannot be rebuilt from anywhere (the PDFs survive in library/, their titles do
// not), so an unreadable file must never be silently replaced by "one book, the
// one being imported". Content that doesn't parse is quarantined and a fresh
// registry takes over; a file that could not be read at all is left alone and
// writing is refused until the next launch reads it successfully.
async function readStore(): Promise<{ store: LibraryStore; writable: boolean }> {
  const read = await readGuardedJson<LibraryStore>(LIBRARY_FILE, (raw) => {
    const parsed = raw as LibraryStore | null;
    return parsed && typeof parsed === "object" && parsed.books ? parsed : null;
  });
  if (read.status === "ok") return { store: read.value, writable: true };
  if (read.status === "missing") return { store: { books: {} }, writable: true };
  return { store: { books: {} }, writable: read.savedAs !== null };
}

// Every read hands out repaired names, whether or not the file on disk has been
// rewritten yet.
async function loadStore(): Promise<{ store: LibraryStore; writable: boolean }> {
  const read = await readStore();
  return { store: healLibrary(read.store), writable: read.writable };
}

async function saveStore(store: LibraryStore): Promise<void> {
  await ensureDir();
  await writeTextAtomic(LIBRARY_FILE, JSON.stringify(store, null, 2));
}

// Rewrite the registry once with the repaired names. A clean library writes
// nothing, so this can run at every launch without producing a sync revision.
// Returns whether it wrote.
export async function repairLibraryNames(): Promise<boolean> {
  const { store, writable } = await readStore();
  const healed = healLibrary(store);
  if (healed === store || !writable) return false;
  await saveStore(healed);
  return true;
}

// Whether the library holds the authoritative copy of a book.
export function libraryHas(bookId: string): Promise<boolean> {
  return exists(libraryPdfPath(bookId), { baseDir: BaseDirectory.AppData });
}

// Read a book's authoritative copy back for opening.
export function readLibraryBook(bookId: string): Promise<Uint8Array> {
  return readFile(libraryPdfPath(bookId), { baseDir: BaseDirectory.AppData });
}

export async function getLibraryEntry(bookId: string): Promise<LibraryEntry | null> {
  const { store } = await loadStore();
  return store.books[bookId] ?? null;
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
    await writeFile(libraryPdfPath(hash), bytes, { baseDir: BaseDirectory.AppData });
  }
  const { store, writable } = await loadStore();
  const existing = store.books[hash];
  if (existing) return existing;
  if (!writable) throw new Error(`${LIBRARY_FILE} could not be read; refusing to overwrite it`);
  const entry: LibraryEntry = {
    hash,
    title: basename(originalPath),
    originalFilename: basename(originalPath),
    addedAt: Date.now(),
  };
  await saveStore(addEntry(store, entry));
  return entry;
}
