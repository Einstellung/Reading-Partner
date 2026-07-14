// Read-side helpers over an already-loaded Fulltext. Pure and page-1-based, so
// they run headless and don't touch the cache or the engine.

import type { Fulltext, OutlineItem, SearchDoc, SearchHit } from "./types";
import { bm25Search } from "./bm25";

function pageText(ft: Fulltext, page: number): string {
  return ft.pages[page - 1] ?? "";
}

// The target page's text, padded with up to `radius` characters from the tail
// of the previous page and the head of the next, so context injected for a
// selection isn't clipped at a page boundary.
export function textAround(ft: Fulltext, page: number, radius: number): string {
  const here = pageText(ft, page);
  if (radius <= 0) return here;
  const before = pageText(ft, page - 1);
  const after = pageText(ft, page + 1);
  const tail = before.slice(Math.max(0, before.length - radius));
  const head = after.slice(0, radius);
  return tail + here + head;
}

// The outline entry the given page falls under: the last heading in document
// order whose page is at or before it. Null when the document has no outline.
export function chapterAt(ft: Fulltext, page: number): OutlineItem | null {
  if (ft.outline.length === 0) return null;
  let best: OutlineItem | null = null;
  for (const item of ft.outline) {
    if (item.page <= page && (best === null || item.page >= best.page)) best = item;
  }
  return best;
}

// Concatenated text of a 1-based, inclusive page range (clamped to the book),
// for the AI paging tool. Pages are separated by a blank line.
export function readPages(ft: Fulltext, from: number, to: number): string {
  const lo = Math.max(1, Math.min(from, to));
  const hi = Math.min(ft.pages.length, Math.max(from, to));
  const out: string[] = [];
  for (let p = lo; p <= hi; p++) out.push(pageText(ft, p));
  return out.join("\n\n");
}

// BM25 keyword search across several books' pages, ranked, with a snippet and
// the source book label + page for each hit.
export function searchTopic(query: string, docs: SearchDoc[], limit = 10): SearchHit[] {
  return bm25Search(query, docs, limit);
}
