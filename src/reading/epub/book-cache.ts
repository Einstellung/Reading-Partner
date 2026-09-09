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
// the other joins the same promise. A book whose stored table is one this build
// cannot lay pages by — the old 1800-character kind, or one cut on the 6x9
// sheet the first paged release used — is cut again, once, and its marks moved
// (migrate.ts). That is the only thing that ever replaces a table, and it is
// nobody's choice: the sheet is a constant in the code (docs/64).

import { loadAnnotations, saveAnnotations } from "../../platform/app/annotations";
import { remapEpubAnnotations } from "./migrate";
import { createLayoutRuler } from "./page-ruler";
import { paginate, type Pagination } from "./paginate";
import { putPagination, readPagination } from "./pagination-store";
import { parseEpub, type EpubBook } from "./parse";

/** A book's table, and whether getting it meant cutting the book over again. */
export interface PreparedPagination {
  pagination: Pagination;
  /**
   * The stored table was replaced, so every page number in this book has moved
   * and everything counted in them has to be built again (open-book.ts).
   */
  recut: boolean;
}

let held: { bookId: string; book: EpubBook } | null = null;
const cutting = new Map<string, Promise<PreparedPagination>>();

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
 * The book's pagination table, and whether the book had to be cut for it.
 * `host` is where the ruler lays pages out off-screen; the app's body when
 * the caller has no better element.
 */
export async function preparePagination(
  bookId: string,
  book: EpubBook,
  host?: HTMLElement,
  // Only the first caller in gets to watch: the rest join the same job.
  onProgress?: (done: number, total: number) => void,
): Promise<PreparedPagination> {
  const running = cutting.get(bookId);
  if (running) return running;
  const job = (async () => {
    const stored = await readPagination(bookId);
    if (stored.pagination) return { pagination: stored.pagination, recut: false };
    const at = host ?? document.body;
    const ruler = createLayoutRuler(at, book);
    let fresh: Pagination;
    try {
      fresh = await paginate(book, ruler, onProgress);
    } finally {
      ruler.dispose();
    }
    // put writes when the book has no table this build reads, which is exactly
    // the case here: a first cut and a replacement land the same way.
    const table = await putPagination(bookId, fresh);
    // A table was on disk and is not this one, so the book was cut again and
    // the marks move before anything reads a page number off them.
    const recut = stored.storedVersion !== null;
    if (recut) await migrateMarks(bookId, book, table, stored.outdated ?? undefined);
    return { pagination: table, recut };
  })();
  cutting.set(bookId, job);
  try {
    return await job;
  } finally {
    cutting.delete(bookId);
  }
}

/** The book's pagination table, for the callers that do not care how it got there. */
export async function ensurePagination(
  bookId: string,
  book: EpubBook,
  host?: HTMLElement,
  onProgress?: (done: number, total: number) => void,
): Promise<Pagination> {
  return (await preparePagination(bookId, book, host, onProgress)).pagination;
}

// The one time a table is replaced: the text marks keep their CFIs and get
// their page numbers from the new table; ink, which is anchored on no words, is
// carried over by the old table (migrate.ts).
async function migrateMarks(
  bookId: string,
  book: EpubBook,
  table: Pagination,
  previous?: Pagination,
): Promise<void> {
  try {
    const marks = await loadAnnotations(bookId);
    if (marks.length === 0) return;
    const moved = remapEpubAnnotations(marks, book, table, previous);
    if (moved.changed) saveAnnotations(bookId, moved.annotations);
  } catch (e) {
    console.warn("failed to move the marks of a repaginated book", bookId, e);
  }
}
