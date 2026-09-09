// Where a book's pages live: one pagination-<bookId>.json per EPUB, written on
// the first open and never written again.
//
// Never again is the whole point. Every other page-bearing file in the app is
// derived and rebuilt when its version bumps; this one is not, because its
// content has already left the app. [p.N] strings are written by the AI into
// chapter files, prep notes and observations, and nothing rewrites them
// (docs/39 §1). Recutting the book would move all of them at once, silently.
//
// The one exception is a version-1 table (the 1800-character blocks the first
// EPUB release cut). It is read as absent, so the book is cut again, and the
// caller is told it was a v1 so the marks can be moved (migrate.ts). A file that
// will not parse is reported and treated as absent too — that is a table for a
// book whose old numbers are unreadable anyway.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { reportStoreError } from "../../platform/app/store-errors";
import { sameGeometry } from "./page-geometry";
import { PAGINATION_VERSION, type Pagination } from "./paginate";

/** One book's table. Exported so a delete names it the same way. */
export function paginationFile(bookId: string): string {
  return `pagination-${bookId}.json`;
}

export function parsePagination(raw: unknown): Pagination | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Pagination>;
  if (p.version !== PAGINATION_VERSION) return null;
  if (p.kind !== "epub") return null;
  if (!sameGeometry(p.geometry)) return null;
  if (!Array.isArray(p.blocks) || p.blocks.length === 0) return null;
  return p as Pagination;
}

/** The version number a stored file declares, whatever else is in it. */
export function storedVersionOf(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as { version?: unknown }).version;
  return typeof v === "number" ? v : null;
}

export interface PaginationIo {
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  onError: (e: unknown) => void;
}

export interface StoredPagination {
  /** The table in force, or null when the book has none this version reads. */
  pagination: Pagination | null;
  /** The version the file on disk declares; null when there is no file. */
  storedVersion: number | null;
}

export interface PaginationStore {
  get: (bookId: string) => Promise<Pagination | null>;
  read: (bookId: string) => Promise<StoredPagination>;
  /** Write the table if the book has none this version reads. Returns the table now in force. */
  put: (bookId: string, pagination: Pagination) => Promise<Pagination>;
}

export function createPaginationStore(io: PaginationIo): PaginationStore {
  async function read(bookId: string): Promise<StoredPagination> {
    try {
      const text = await io.read(paginationFile(bookId));
      if (text === null) return { pagination: null, storedVersion: null };
      const raw: unknown = JSON.parse(text);
      return { pagination: parsePagination(raw), storedVersion: storedVersionOf(raw) };
    } catch (e) {
      io.onError(e);
      return { pagination: null, storedVersion: null };
    }
  }
  return {
    read,
    get: async (bookId) => (await read(bookId)).pagination,
    put: async (bookId, pagination) => {
      const existing = (await read(bookId)).pagination;
      if (existing) return existing;
      try {
        await io.write(paginationFile(bookId), JSON.stringify(pagination));
      } catch (e) {
        io.onError(e);
      }
      return pagination;
    },
  };
}

const store = createPaginationStore({
  read: async (file) => ((await appData.exists(file)) ? appData.readText(file) : null),
  write: (file, contents) => writeTextAtomic(file, contents),
  onError: (e) => reportStoreError("pagination", e),
});

export function getPagination(bookId: string): Promise<Pagination | null> {
  return store.get(bookId);
}

export function readPagination(bookId: string): Promise<StoredPagination> {
  return store.read(bookId);
}

export function putPagination(bookId: string, pagination: Pagination): Promise<Pagination> {
  return store.put(bookId, pagination);
}
