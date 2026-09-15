// Reading an EPUB into the app's stores. The one place that knows both halves:
// the book's pages are cut once and kept (pagination-store.ts), and the full
// text is derived from whatever table is in force.
//
// The order matters and is the reason this is a function rather than two calls
// at the call site: a re-extraction must be handed the stored table, never a
// fresh cut, or every [p.N] already written down moves (docs/39 §1). When
// there is no table the webview cuts one here (book-cache.ts): the full text
// of an EPUB is never built without the pages it counts.

import type { Fulltext } from "../../fulltext/types";
import { ensurePagination, heldEpub } from "./book-cache";
import { parseEpub, type EpubBook } from "./parse";
import { fulltextFrom } from "./fulltext";

/**
 * An EPUB's full text, in the shape a PDF's has. The pagination table is read
 * first and written only when the book has none.
 */
export async function extractEpubFulltext(
  bookId: string,
  buffer: ArrayBuffer,
): Promise<Omit<Fulltext, "version">> {
  const book = held(bookId, buffer);
  return fulltextFrom(book, await ensurePagination(bookId, book));
}

// The cache holds one book: the one on screen. Taking a supplement's text in
// while the reader is in the book (docs/67 「和 ingest_url 合并」) must not be the
// thing that evicts it — the figures the reader is looking at are rendered off
// the held copy, and the reading pane would have to unzip 71 MB again. So the
// cache is joined when it already holds this document and a throwaway parse is
// used when it does not: the ingest pays one parse it does not keep, which is
// what it would have paid anyway.
// The document on screen is in the cache by the time its text is sliced off it:
// its pages are laid out first, and that is what puts it there
// (session/open-book.ts). So a miss here is a document nobody is reading.
function held(bookId: string, buffer: ArrayBuffer): EpubBook {
  return heldEpub(bookId) ?? parseEpub(new Uint8Array(buffer));
}
