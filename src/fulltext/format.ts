// Prompt-facing rendering of full text: a page range and a search result turned
// into the strings a model reads. query.ts returns structure, this turns it into
// tool output. Every caller that gives a model access to a text layer needs the
// same two renderings — the reading companion, the chapter-note writer and the
// prep digest — so they live in the full-text layer rather than in any one of
// them. Pure: no Tauri, no cache, 1-based pages.

import { annotationPage, type Annotation } from "../platform/app/reader-contract";
import { readPages, searchTopic } from "./query";
import type { Fulltext, SearchDoc } from "./types";

// One material's annotations, flattened for the read_annotations tool. `page` is
// 1-based (converted from the engine's 0-based position.pageIndex) or null when
// the annotation carries no page.
export interface AnnotationLite {
  page: number | null;
  text: string;
  comment: string;
}

// One stored annotation flattened into the shape above. Skips annotations with
// neither text nor comment (legacy image regions), which are evidence of
// nothing. Here rather than in either caller because a reading turn and a talk's
// materials both need it and both need the same answer.
export function toAnnotationLite(ann: Annotation): AnnotationLite | null {
  const text = typeof ann.text === "string" ? ann.text.trim() : "";
  const comment = typeof ann.comment === "string" ? ann.comment.trim() : "";
  if (!text && !comment) return null;
  return { page: annotationPage(ann as { position?: { pageIndex?: number } }), text, comment };
}

// A topic material as the tools see it: its label (file name), its cached full
// text (null when never extracted), and its user annotations.
export interface TopicMaterial {
  label: string;
  fulltext: Fulltext | null;
  annotations: AnnotationLite[];
}

// Max pages one read_pages call may pull, so the model can't dump a whole book.
// Exported because a tool description has to state the same number formatPages
// enforces.
export const MAX_PAGES = 10;
// Max characters of any one page. MAX_PAGES bounded the number of pages but
// nothing bounded their size, so a dense page could return several thousand
// tokens on its own. The cut is announced inside the page's own block: a model
// that can't see the break will quote straight across it.
export const MAX_PAGE_CHARS = 4000;
const SEARCH_LIMIT = 8;

// A 1-based, inclusive page range from one book, capped at MAX_PAGES and clamped
// to the book, each page labelled so the model can cite it.
export function formatPages(ft: Fulltext | null, from: number, to: number): string {
  if (!ft || ft.status !== "ok") {
    return "The full text of this book isn't machine-readable, so its pages can't be read.";
  }
  const total = ft.pages.length;
  const lo = Math.max(1, Math.min(from, to));
  if (lo > total) return `This book has ${total} pages; page ${lo} is out of range.`;
  const hi = Math.min(total, Math.max(from, to), lo + MAX_PAGES - 1);
  const parts: string[] = [];
  for (let p = lo; p <= hi; p++) {
    const body = readPages(ft, p, p);
    const cut = body.length > MAX_PAGE_CHARS;
    const text = cut
      ? `${body.slice(0, MAX_PAGE_CHARS)}\n[page ${p} truncated at ${MAX_PAGE_CHARS} chars]`
      : body;
    parts.push(`=== Page ${p} ===\n${text}`);
  }
  return parts.join("\n\n");
}

// BM25 across every material with a usable text layer, ranked, book + page cited.
export function formatSearch(query: string, materials: TopicMaterial[]): string {
  const docs: SearchDoc[] = materials
    .filter((m) => m.fulltext?.status === "ok")
    .map((m) => ({ label: m.label, fulltext: m.fulltext as Fulltext }));
  if (docs.length === 0) return "No material in this topic has a searchable text layer.";
  const hits = searchTopic(query, docs, SEARCH_LIMIT);
  if (hits.length === 0) return `No matches for "${query}" across the topic.`;
  return hits.map((h) => `[${h.label}, p${h.page}] ${h.snippet}`).join("\n\n");
}
