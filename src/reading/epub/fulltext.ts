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
  type Pagination,
} from "./paginate";
import type { NavEntry } from "./file/nav";
import { type EpubBook } from "./file/parse";

/**
 * The outline, with each entry's page being the position block its target falls
 * in. An entry whose target cannot be found in the sanitized tree keeps its
 * document's first block rather than being dropped: a chapter missing from the
 * table of contents is worse than one pointing a paragraph early.
 */
export function outlineFor(book: EpubBook, pagination: Pagination): OutlineItem[] {
  return tocTargets(book, pagination).map(({ item, page }) => ({
    title: item.title,
    page,
    level: item.level,
  }));
}

/**
 * The first table-of-contents entry on a page (1-based), as a link the reader
 * resolves the way it resolves the book's own (the archive entry, then the
 * fragment). An outline row carries only its page, and the page's first block
 * can be the tail of the chapter before; this is the heading the row was made
 * from. Null when no entry is on that page.
 */
export function outlineHrefAt(book: EpubBook, pagination: Pagination, page: number): string | null {
  const hit = tocTargets(book, pagination).find((t) => t.page === page);
  if (!hit) return null;
  return hit.item.fragment === null ? hit.item.entry : `${hit.item.entry}#${hit.item.fragment}`;
}

function tocTargets(book: EpubBook, pagination: Pagination): { item: NavEntry; page: number }[] {
  const byEntry = new Map(book.docs.map((d) => [d.entry, d]));
  const out: { item: NavEntry; page: number }[] = [];
  for (const item of book.nav.toc) {
    const doc = byEntry.get(item.entry);
    if (!doc) continue;
    let offset = 0;
    if (item.fragment !== null) {
      const el = doc.text.ids.get(item.fragment);
      if (el !== undefined) offset = doc.text.offsets.get(el) ?? 0;
    }
    out.push({ item, page: blockNumberAt(pagination, doc.index, offset) });
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

export { FULLTEXT_VERSION };
