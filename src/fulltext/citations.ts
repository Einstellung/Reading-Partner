// Is this document a paper or a book? Measured, not declared (docs/09): count
// the inline numeric citations — the `[12]` markers a paper leaves in its own
// prose — per 10,000 characters of text. A paper's references carry its
// argument, so they are cited on nearly every page; a book's bibliography is
// further reading, so its body almost never points at one.
//
// Measured over the five documents in the author's library (2026-08-19,
// per 10,000 non-whitespace characters):
//
//   embodied-AI survey, bilingual 67-page layout  94.6
//   the same survey, 22-page English original     57.5
//   Build a Large Language Model from Scratch      1.9
//   A Brief History of Intelligence                0.6
//   Hands-On Large Language Models                 0.6
//
// Fifty times between the two groups with nothing in between, which is why the
// threshold can sit an order of magnitude clear of both sides. The first row is
// the case that defeats every structural signal: 67 pages, a full PDF outline,
// reads as a book at a glance, and is a paper.
//
// The verdict decides what preparation a document gets — a paper's prep follows
// its citations outward, a book's follows its chapters inward — and nothing
// else. What goes into a turn's context is decided by size and by whether a
// chapter table exists, so a misread here costs preparation aimed the wrong way,
// never a broken load.

import type { Fulltext } from "./types";

// Citations per 10,000 characters at or above which the references are load
// bearing. An order of magnitude above the densest book measured and five times
// below the sparsest paper.
export const PAPER_CITATION_DENSITY = 10;

// Below this much text there is nothing to measure: a two-page note with one
// bracket in it would read as a paper on a single mark.
export const MIN_MEASURABLE_CHARS = 2_000;

// A bracketed citation marker as papers write it inline: [12]. Only the bare
// form is counted. Lists and ranges ([12, 15], [12-15]) are left out on purpose:
// every document measured writes far more bare markers than lists, and the wider
// pattern also picks up a programming book's array indices — which is the one
// place a book's count climbs (Build a Large Language Model from Scratch goes
// from 1.9 to 6.0 per 10k, eating most of the margin for nothing).
const INLINE_CITATION = /\[\d{1,3}\]/g;

export interface CitationDensity {
  // Bracketed markers found.
  citations: number;
  // Characters of text, whitespace removed — so a CJK page and an English page
  // are measured the same way.
  chars: number;
  // citations per 10,000 chars.
  per10k: number;
}

export function citationDensity(pages: readonly string[]): CitationDensity {
  let citations = 0;
  let chars = 0;
  for (const page of pages) {
    if (!page) continue;
    citations += page.match(INLINE_CITATION)?.length ?? 0;
    chars += page.replace(/\s/g, "").length;
  }
  return { citations, chars, per10k: chars > 0 ? (citations / chars) * 10_000 : 0 };
}

// "paper": its references carry the argument, so prep follows them outward.
// "book": prep works inward, chapter by chapter.
// "unknown": too little text to judge, or none at all.
export type DocumentShape = "paper" | "book" | "unknown";

export function documentShape(ft: Pick<Fulltext, "pages" | "status">): DocumentShape {
  if (ft.status !== "ok") return "unknown";
  const density = citationDensity(ft.pages);
  if (density.chars < MIN_MEASURABLE_CHARS) return "unknown";
  return density.per10k >= PAPER_CITATION_DENSITY ? "paper" : "book";
}
