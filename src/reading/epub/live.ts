// Reading an EPUB into the app's stores. The one place that knows both halves:
// the book's position blocks are cut once and kept (pagination-store.ts), and
// the full text is derived from whatever table is in force.
//
// The order matters and is the reason this is a function rather than two calls
// at the call site: a re-extraction must be handed the stored table, never a
// fresh cut, or every [p.N] already written down moves (docs/39 §1).

import type { Fulltext } from "../../fulltext/types";
import { fulltextFrom } from "./fulltext";
import { paginate } from "./paginate";
import { getPagination, putPagination } from "./pagination-store";
import { parseEpub } from "./parse";

/**
 * An EPUB's full text, in the shape a PDF's has. The pagination table is read
 * first and written only when the book has none.
 */
export async function extractEpubFulltext(
  bookId: string,
  buffer: ArrayBuffer,
): Promise<Omit<Fulltext, "version">> {
  const book = parseEpub(new Uint8Array(buffer));
  const stored = await getPagination(bookId);
  const pagination = stored ?? (await putPagination(bookId, paginate(book)));
  return fulltextFrom(book, pagination);
}
