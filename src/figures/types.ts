// Figure index shape (M9). One figures-<pathHash>.json per document under
// AppData, beside the full-text cache, keyed by the same djb2 path hash. Its own
// version field: a bump invalidates figure caches without touching fulltext.
// Bboxes are in EmbedPDF/top-left page space (origin at the page's top-left, y
// grows downward, PDF points) so they feed renderPageRect / a pdf.js crop
// directly — the same convention as src/reader-embedpdf/convert.ts.

export const FIGURES_VERSION = 1 as const;

// Tight bounding box of a figure in top-left page space (PDF points).
export interface FigureBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Figure {
  // Figure number as written, lower-cased: "3", "3a", "10". Sub-panels that get
  // their own caption ("Figure 3a") are separate entries.
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

export interface FiguresIndex {
  version: typeof FIGURES_VERSION;
  figures: Figure[];
}
