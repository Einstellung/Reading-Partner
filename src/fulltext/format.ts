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

// The header above each page's text. The default is what the chapter-note
// writer and the prep digest have always emitted, and their output is on disk,
// so it stays exactly as it was. A caller whose output is read by a model that
// will cite the page passes its own, carrying the literal citation shorthand —
// a model copies the anchor it can see far more reliably than one it has to
// assemble from a slug it was told about somewhere else.
export type PageLabel = (page: number) => string;

const DEFAULT_LABEL: PageLabel = (p) => `=== Page ${p} ===`;

// The header every page of the book the reader is in gets, wherever that page is
// printed: the read_pages and read_chapter tools, and the body a lecture turn
// inlines (reading/lecture). One function because a single turn puts all three
// in front of the same model and it cites out of all three — the inlined body
// used to carry a bare header, which made the material the model was handed
// harder to cite correctly than the material it fetched for itself.
export const BOOK_PAGE_LABEL: PageLabel = (p) => `=== Page ${p} === [p.${p}]`;

// A 1-based, inclusive page range from one book, capped at `maxPages` and
// clamped to the book, each page labelled so the model can cite it.
//
// The cap is a parameter rather than the constant because it is a judgement
// about one tool, not about page ranges: read_pages is a look at a couple of
// pages and 10 is generous, while read_chapter has to answer with a whole
// chapter and 10 would truncate nearly every one of them.
export function formatPages(
  ft: Fulltext | null,
  from: number,
  to: number,
  label: PageLabel = DEFAULT_LABEL,
  maxPages: number = MAX_PAGES,
): string {
  if (!ft || ft.status !== "ok") {
    return "The full text of this book isn't machine-readable, so its pages can't be read.";
  }
  const total = ft.pages.length;
  const lo = Math.max(1, Math.min(from, to));
  if (lo > total) return `This book has ${total} pages; page ${lo} is out of range.`;
  const hi = Math.min(total, Math.max(from, to), lo + Math.max(1, Math.round(maxPages)) - 1);
  const parts: string[] = [];
  for (let p = lo; p <= hi; p++) {
    const body = readPages(ft, p, p);
    const cut = body.length > MAX_PAGE_CHARS;
    const text = cut
      ? `${body.slice(0, MAX_PAGE_CHARS)}\n[page ${p} truncated at ${MAX_PAGE_CHARS} chars]`
      : body;
    parts.push(`${label(p)}\n${text}`);
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
