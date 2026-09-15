// One document's bytes to one Fulltext in the store (docs/67 「和 ingest_url 合并」).
//
// The only place that turns bytes into the text the AI reads, whichever door the
// document came in by: a book the reader opened (session/open-book.ts) or a link
// they pasted, which is taken in as a supplement and read by read_paper. One
// function because the two must agree — the page numbers the model cites are the
// page numbers the reader sees only if both count them off the same table.
//
// It is a dispatch on the format and nothing else: an EPUB produces the same
// Fulltext a PDF does (docs/39 §1), and an EPUB's pages are cut (or read back)
// before its text is sliced off them.

import { ensureFulltext, type Fulltext } from "../../fulltext";
import type { BookFormat } from "../../platform/app/library";
import { extractEpubFulltext } from "../epub/live";
import { PAGINATION_VERSION } from "../epub/paginate";

/**
 * The document's full text, cached under its own id.
 *
 * `stale` says the document was just laid out again, so a cache counted in its
 * old page numbers is not a cache of this document any more.
 */
export function ensureDocumentFulltext(
  docId: string,
  buffer: ArrayBuffer,
  format: BookFormat,
  stale = false,
): Promise<Fulltext> {
  return format === "epub"
    ? ensureFulltext(
        docId,
        buffer,
        (b) => extractEpubFulltext(docId, b),
        (ft) => !stale && ft.paginationVersion === PAGINATION_VERSION,
      )
    : ensureFulltext(docId, buffer);
}
