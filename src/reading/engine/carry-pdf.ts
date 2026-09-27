// Carrying a PDF's marks onto a new version of the same PDF, by their words
// (reading/replace/replace.ts; carry-marks.ts is the EPUB side).
//
// A PDF mark is a page and rectangles, and a new version can move every line;
// what survives is the text the mark was drawn over, which the mark keeps
// beside its geometry. So the new file is searched for that text with PDFium's
// own search, and the rectangles it answers become the mark's. Of several
// hits the one on the page nearest the old one wins, which is what tells two
// copies of a repeated phrase apart when the new version only shifted pages.
//
// Ink, areas and a mark with no words are not on any text, so they are
// reported rather than guessed at. So is a highlight whose words PDFium cannot
// find as one run — a quote across a line break or a hyphenation often cannot
// be — rather than a shortened match that would highlight half of it.

import type { PdfDocumentObject, PdfEngine, Rect } from "@embedpdf/models";
import { boundingRect, embedRectToZotero, makeSortIndex } from "./convert";
import { getPdfiumEngine } from "./engine-singleton";

type MarkRecord = Record<string, unknown>;

export interface PdfHit {
  pageIndex: number;
  rects: Rect[];
}

/** Pure: of the places a phrase is in the new file, the one nearest the old page. */
export function nearestHit(hits: readonly PdfHit[], oldPage: number): PdfHit | null {
  let best: PdfHit | null = null;
  for (const hit of hits) {
    if (hit.rects.length === 0) continue;
    if (!best || Math.abs(hit.pageIndex - oldPage) < Math.abs(best.pageIndex - oldPage)) best = hit;
  }
  return best;
}

/** Pure: the words a text mark was drawn over, as one search phrase; null for anything else. */
export function searchPhraseOf(mark: MarkRecord): string | null {
  if (mark.type !== "highlight" && mark.type !== "underline") return null;
  if (typeof mark.text !== "string") return null;
  const phrase = mark.text.replace(/\s+/g, " ").trim();
  return phrase.length >= 2 ? phrase : null;
}

/** Pure: the page a stored PDF mark was on. */
export function pageOfMark(mark: MarkRecord): number {
  const page = (mark.position as { pageIndex?: unknown } | undefined)?.pageIndex;
  return typeof page === "number" && Number.isInteger(page) && page >= 0 ? page : 0;
}

/** Pure: a mark moved onto a hit in the new file, everything but its geometry kept. */
export function carriedPdfMark(mark: MarkRecord, hit: PdfHit, pageHeight: number): MarkRecord {
  const bb = boundingRect(hit.rects);
  return {
    ...mark,
    pageLabel: String(hit.pageIndex + 1),
    position: {
      ...(mark.position as Record<string, unknown>),
      pageIndex: hit.pageIndex,
      rects: hit.rects.map((r) => embedRectToZotero(r, pageHeight)),
    },
    sortIndex: makeSortIndex(hit.pageIndex, bb.origin.y, bb.origin.x),
  };
}

async function hitsFor(engine: PdfEngine, doc: PdfDocumentObject, phrase: string): Promise<PdfHit[]> {
  const res = await engine.searchAllPages(doc, phrase, { flags: [] }).toPromise();
  return res.results.map((r) => ({ pageIndex: r.pageIndex, rects: r.rects }));
}

/** Every mark, relocated onto the new PDF or reported as lost. */
export async function carryPdfMarks(
  marks: readonly MarkRecord[],
  successor: Uint8Array,
): Promise<{ moved: MarkRecord[]; unmatched: MarkRecord[] }> {
  const result = { moved: [] as MarkRecord[], unmatched: [] as MarkRecord[] };
  if (marks.length === 0) return result;
  const engine = await getPdfiumEngine();
  const doc = await engine
    .openDocumentBuffer({
      id: `carry-${crypto.randomUUID()}`,
      content: successor.slice().buffer as ArrayBuffer,
    })
    .toPromise();
  try {
    for (const mark of marks) {
      const phrase = searchPhraseOf(mark);
      const hit = phrase ? nearestHit(await hitsFor(engine, doc, phrase), pageOfMark(mark)) : null;
      const page = hit ? doc.pages[hit.pageIndex] : undefined;
      if (!hit || !page) {
        result.unmatched.push(mark);
        continue;
      }
      result.moved.push(carriedPdfMark(mark, hit, page.size.height));
    }
  } finally {
    await engine.closeDocument(doc).toPromise().catch(() => {});
  }
  return result;
}
