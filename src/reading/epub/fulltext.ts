// An EPUB turned into the same Fulltext a PDF produces. Everything that reads a
// book — BM25 search, [p.N] anchors, chapter page ranges, the prep pipeline —
// works on that shape and none of it has to learn a second one.
//
// This lives on the domain side, not in fulltext/. fulltext/ is a capability: it
// may not import a domain, and an EPUB is read by reading/epub. So the capability
// owns the type and the cache, and the conversion is called from here.

import { FULLTEXT_VERSION, type Fulltext, type OutlineItem } from "../../fulltext/types";
import {
  PAGINATION_VERSION,
  blockNumberAt,
  blockTexts,
  paginate,
  type PageRuler,
  type Pagination,
} from "./paginate";
import { parseEpub, type EpubBook } from "./parse";

/**
 * The outline, with each entry's page being the position block its target falls
 * in. An entry whose target cannot be found in the sanitized tree keeps its
 * document's first block rather than being dropped: a chapter missing from the
 * table of contents is worse than one pointing a paragraph early.
 */
export function outlineFor(book: EpubBook, pagination: Pagination): OutlineItem[] {
  const byEntry = new Map(book.docs.map((d) => [d.entry, d]));
  const out: OutlineItem[] = [];
  for (const item of book.nav.toc) {
    const doc = byEntry.get(item.entry);
    if (!doc) continue;
    let offset = 0;
    if (item.fragment !== null) {
      const el = doc.text.ids.get(item.fragment);
      if (el !== undefined) offset = doc.text.offsets.get(el) ?? 0;
    }
    out.push({
      title: item.title,
      page: blockNumberAt(pagination, doc.index, offset),
      level: item.level,
    });
  }
  return out;
}

export interface EpubFulltext {
  fulltext: Omit<Fulltext, "version">;
  pagination: Pagination;
  book: EpubBook;
}

/**
 * Build the full text from an already-parsed book and a pagination table. The
 * table is an argument because it is written once and read forever: a book that
 * has one is re-read against the one it has, never against a fresh cut.
 */
export function fulltextFrom(book: EpubBook, pagination: Pagination): Omit<Fulltext, "version"> {
  const pages = blockTexts(book, pagination);
  const labels = pagination.blocks.map((b) => b.label ?? "");
  return {
    kind: "epub",
    paginationVersion: PAGINATION_VERSION,
    status: pages.join("").trim() === "" ? "no-text-layer" : "ok",
    pages,
    outline: outlineFor(book, pagination),
    pageLocators: pagination.blocks.map((b) => b.cfi),
    // Only carried when the book actually printed page numbers; an array of
    // empty strings would have the display show a blank where a number goes.
    ...(labels.some((l) => l !== "") ? { pageLabels: labels } : {}),
  };
}

/**
 * Read an EPUB end to end. `existing` is the book's stored pagination table when
 * it has one; passing it is what keeps a re-extraction from moving every [p.N]
 * already written down.
 */
export async function readEpub(
  bytes: Uint8Array,
  ruler: PageRuler,
  existing?: Pagination | null,
): Promise<EpubFulltext> {
  const book = parseEpub(bytes);
  const pagination = existing ?? (await paginate(book, ruler));
  return { fulltext: fulltextFrom(book, pagination), pagination, book };
}

export { FULLTEXT_VERSION };
