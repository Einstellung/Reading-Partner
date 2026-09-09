// The one parsed copy of the open book, and the one pagination per open. An
// EPUB is read twice over — once by the ingestion (full text, figures) and once
// by the reading pane — and both want the same archive: unzipping a 71 MB book
// costs 1.2 seconds and 150 MB of resident memory (docs/62 §4), which is not a
// thing to do twice.
//
// It lives here rather than in a store because it is not persisted state: it is
// the open book, and there is exactly one. A single slot, keyed by book id, is
// the whole cache — opening another book replaces it, and closing releases it.
//
// The pagination is cut in the webview (page-ruler.ts) and only there, so the
// ingestion and the pane converge on one table: whichever asks first cuts it,
// the other joins the same promise. A book whose stored table is the old
// 1800-character kind is cut again, once, and its marks moved (migrate.ts).

import { loadAnnotations, saveAnnotations } from "../../platform/app/annotations";
import { remapEpubAnnotations } from "./migrate";
import { createLayoutRuler } from "./page-ruler";
import { paginate, type Pagination } from "./paginate";
import { putPagination, readPagination } from "./pagination-store";
import { parseEpub, type EpubBook } from "./parse";

let held: { bookId: string; book: EpubBook } | null = null;
const cutting = new Map<string, Promise<Pagination>>();

/**
 * The parsed book for `bookId`, parsing it if this is the first caller. The
 * bytes are read only on that first call; later callers get the same instance
 * and therefore the same sanitized trees, the same offsets and the same zip.
 */
export function acquireEpub(bookId: string, bytes: ArrayBuffer | Uint8Array): EpubBook {
  if (held?.bookId === bookId) return held.book;
  const book = parseEpub(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  held = { bookId, book };
  return book;
}

/** The parsed book if it is the one being held, else null. */
export function heldEpub(bookId: string): EpubBook | null {
  return held?.bookId === bookId ? held.book : null;
}

/**
 * Let go of the book. Called when the reader closes; passing a book id that is
 * not the one held is a no-op, so a late release cannot drop the next book.
 */
export function releaseEpub(bookId?: string): void {
  if (bookId === undefined || held?.bookId === bookId) held = null;
}

/**
 * The book's pagination table: the stored one, or a fresh cut written once.
 * `host` is where the ruler lays pages out off-screen; the app's body when
 * the caller has no better element.
 */
export async function ensurePagination(
  bookId: string,
  book: EpubBook,
  host?: HTMLElement,
): Promise<Pagination> {
  const running = cutting.get(bookId);
  if (running) return running;
  const job = (async () => {
    const stored = await readPagination(bookId);
    if (stored.pagination) return stored.pagination;
    const at = host ?? document.body;
    const ruler = createLayoutRuler(at, book);
    let cut: Pagination;
    try {
      cut = await paginate(book, ruler);
    } finally {
      ruler.dispose();
    }
    const table = await putPagination(bookId, cut);
    if (stored.storedVersion !== null && stored.storedVersion < table.version) {
      await migrateMarks(bookId, book, table);
    }
    return table;
  })();
  cutting.set(bookId, job);
  try {
    return await job;
  } finally {
    cutting.delete(bookId);
  }
}

// The one time a table is replaced: the marks keep their CFIs and get their
// page numbers from the new table.
async function migrateMarks(bookId: string, book: EpubBook, table: Pagination): Promise<void> {
  try {
    const marks = await loadAnnotations(bookId);
    const moved = remapEpubAnnotations(marks, book, table);
    if (moved.changed) saveAnnotations(bookId, moved.annotations);
  } catch (e) {
    console.warn("failed to move the marks of a repaginated book", bookId, e);
  }
}
