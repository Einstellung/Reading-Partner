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
//
// 5: a figure says where its picture is rather than where its rectangle is. A
// PDF's is a box on a page it has to be cropped out of; an EPUB's is a file in
// the archive, which is the picture itself at its own resolution (docs/39 §3).
// One field cannot mean both, and a version-4 index has no answer for the
// second, so the bump discards them.
export const FIGURES_VERSION = 5 as const;

// Tight bounding box of a figure in top-left page space (PDF points).
export interface FigureBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Where the picture is. A PDF has to say which part of which page to crop, and
// the box can be null when pairing found a caption but no art near it. An EPUB
// names an archive entry, which is the picture as the publisher shipped it.
export type FigureSource =
  | { kind: "pdf"; bbox: FigureBBox | null }
  | { kind: "epub"; href: string };

// Which rung of the EPUB caption ladder this caption came off (docs/39 §3).
// Absent on a PDF figure: there is one place a caption can come from there, the
// caption line printed on the page.
export type CaptionSource = "figcaption" | "alt" | "aria" | "nearby" | "none";

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
  // Where the picture is, and in which of the two languages.
  source: FigureSource;
  // EPUB only.
  captionSource?: CaptionSource;
}

/**
 * A PDF figure's box: the crop, or null for one whose pairing found no art (a
 * scanned page, a cross-column figure), which makes the card fall back to the
 * whole page. Null for an EPUB figure, which is not cropped out of anything.
 */
export function pdfBBox(figure: Figure): FigureBBox | null {
  return figure.source.kind === "pdf" ? figure.source.bbox : null;
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
  // EPUB only: the pagination table version the pages were numbered by (docs/64).
  paginationVersion?: number;
  // When the extraction failed. Only on a "failed" index, and what the retry
  // window is measured from.
  failedAt?: number;
}
