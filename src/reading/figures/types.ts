// Figure index shape (M9). One figures-<pathHash>.json per document under
// AppData, beside the full-text cache, keyed by the same djb2 path hash. Its own
// version field: a bump invalidates figure caches without touching fulltext.
// Bboxes are in EmbedPDF/top-left page space (origin at the page's top-left, y
// grows downward, PDF points) so they feed renderPageRect / a pdf.js crop
// directly — the same convention as src/reading/engine/convert.ts.

// 3: the index says whether it is the document's figures or the record of an
// extraction that failed. Version 2 files cannot answer that — a failed
// extraction wrote the same empty index a figure-less document does — so the
// bump discards them and every document is read once more.
//
// 4: captions are read in Chinese as well as English, and a figure number keeps
// every section it was printed with. A version-3 index of a translated book is
// empty, and one of a chapter-numbered book holds the first figure of each
// chapter and nothing else — both are wrong about the document, not merely
// thinner, so they are discarded rather than kept until something else evicts
// them.
export const FIGURES_VERSION = 4 as const;

// Tight bounding box of a figure in top-left page space (PDF points).
export interface FigureBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Figure {
  // Figure number as the document prints it, minus the label and lower-cased:
  // "3", "3a", "3.8", "3-1", "3-1a". Sub-panels that get their own caption
  // ("Figure 3a") are separate entries. Chinese and English captions over the
  // same picture give the same id, and matching folds "." against every dash —
  // see lookup.ts.
  id: string;
  // 1-based page the caption sits on.
  page: number;
  // The full caption line ("Figure 3: A schematic of ...").
  caption: string;
  // Tight image box, or null when pairing found the caption but no image near
  // it (scanned page / cross-column figure) — the card falls back to the whole
  // page.
  bbox: FigureBBox | null;
}

// "ok" is an answer about the document — including the honest empty one, for a
// document with no figures in it. "failed" is an answer about the app: pdf.js
// would not open the file, or the extraction threw. Kept apart because an empty
// index is cached and consulted forever after, and one of the two deserves
// another try (see FIGURES_RETRY_AFTER_MS in store.ts).
export type FiguresStatus = "ok" | "failed";

export interface FiguresIndex {
  version: typeof FIGURES_VERSION;
  status: FiguresStatus;
  figures: Figure[];
  // When the extraction failed. Only on a "failed" index, and what the retry
  // window is measured from.
  failedAt?: number;
}
