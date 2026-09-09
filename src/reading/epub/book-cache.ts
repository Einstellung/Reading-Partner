// The one parsed copy of the open book. An EPUB is read twice over — once by
// the ingestion (full text, figures) and once by the reading pane — and both
// want the same archive: unzipping a 71 MB book costs 1.2 seconds and 150 MB
// of resident memory (docs/62 §4), which is not a thing to do twice.
//
// It lives here rather than in a store because it is not persisted state: it is
// the open book, and there is exactly one. A single slot, keyed by book id, is
// the whole cache — opening another book replaces it, and closing releases it.
// Anything that arrives for a book that is no longer open parses its own copy
// and throws it away, which is what a stale extraction should do anyway.
//
// EpubZip is itself lazy (zip.ts): the markup is inflated when the book is
// parsed and an image only when something asks for it, so holding the book
// holds the markup and the archive bytes, not every picture in it.

import { paginate, type Pagination } from "./paginate";
import { getPagination, putPagination } from "./pagination-store";
import { parseEpub, type EpubBook } from "./parse";

let held: { bookId: string; book: EpubBook } | null = null;

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
 * Both the ingestion and the reading pane ask for this, and both may ask at the
 * same time — `put` returns whatever is already on disk, so two racing callers
 * converge on one table rather than on two different cuts of the book
 * (docs/39 §1).
 */
export async function ensurePagination(bookId: string, book: EpubBook): Promise<Pagination> {
  const stored = await getPagination(bookId);
  return stored ?? (await putPagination(bookId, paginate(book)));
}
