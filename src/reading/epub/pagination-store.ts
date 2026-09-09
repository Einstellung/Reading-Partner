// Where a book's position blocks live: one pagination-<bookId>.json per EPUB,
// written on the first read and never written again.
//
// Never again is the whole point. Every other page-bearing file in the app is
// derived and rebuilt when its version bumps; this one is not, because its
// content has already left the app. [p.N] strings are written by the AI into
// chapter files, prep notes and observations, and nothing rewrites them
// (docs/39 §1). Recutting the book would move all of them at once, silently.
//
// So the store has no version gate and no repair. A file that will not parse is
// reported and treated as absent, which is the only case where a new table is
// cut — and that is a table for a book whose old numbers are unreadable anyway.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { reportStoreError } from "../../platform/app/store-errors";
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
  if (!Array.isArray(p.blocks) || p.blocks.length === 0) return null;
  return p as Pagination;
}

export interface PaginationIo {
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  onError: (e: unknown) => void;
}

export interface PaginationStore {
  get: (bookId: string) => Promise<Pagination | null>;
  /** Write the table if the book has none. Returns the table now in force. */
  put: (bookId: string, pagination: Pagination) => Promise<Pagination>;
}

export function createPaginationStore(io: PaginationIo): PaginationStore {
  async function get(bookId: string): Promise<Pagination | null> {
    try {
      const text = await io.read(paginationFile(bookId));
      if (text === null) return null;
      return parsePagination(JSON.parse(text));
    } catch (e) {
      io.onError(e);
      return null;
    }
  }
  return {
    get,
    put: async (bookId, pagination) => {
      const existing = await get(bookId);
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

export function putPagination(bookId: string, pagination: Pagination): Promise<Pagination> {
  return store.put(bookId, pagination);
}
