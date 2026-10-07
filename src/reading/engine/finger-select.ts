// A finger's selection on PDF pages (docs/82), as glyph arithmetic. The hold is
// timed by the touch router (gesture/press.ts) and the selection is painted and
// saved by pdf-select.ts; what is here is which glyphs it covers: the word a
// hold lands on, the span a drag grows from it, the end a handle moves, and the
// boxes and text slices that span is made of on each page.
//
// It runs on the selection plugin's own page geometry and its own glyph
// helpers, but never on its selection state: a selection the plugin held would
// be turned into a mark by whatever drawing tool is in the rack the moment it
// ended (the annotation plugin listens for that), and the hold has to select
// whichever tool is active.

import { expandToWordBoundary, glyphAt, rectsWithinSlice } from "@embedpdf/plugin-selection";
import type { PdfPageGeometry, Rect } from "@embedpdf/models";

/** One glyph: its page and its index in that page's text. */
export interface GlyphPos {
  page: number;
  index: number;
}

/** A run of glyphs, both ends inclusive, start never after end. */
export interface GlyphSpan {
  start: GlyphPos;
  end: GlyphPos;
}

export type Geometries = (page: number) => PdfPageGeometry | undefined;

export function compareGlyphs(a: GlyphPos, b: GlyphPos): number {
  return a.page !== b.page ? a.page - b.page : a.index - b.index;
}

function lastIndex(geo: PdfPageGeometry): number {
  const run = geo.runs[geo.runs.length - 1];
  return run ? run.charStart + run.glyphs.length - 1 : -1;
}

/**
 * The glyph under a point in page space, or null off the words. Exact hits
 * only: a hold beside the text is not on the words.
 */
export function glyphUnder(geo: PdfPageGeometry, page: number, x: number, y: number): GlyphPos | null {
  const index = glyphAt(geo, { x, y }, 0);
  return index < 0 ? null : { page, index };
}

/**
 * The glyph nearest a point in page space, for a drag or a handle that has left
 * the words (between lines, in a margin): the plugin's own tolerance first,
 * then the closest glyph on the page.
 */
export function glyphNear(geo: PdfPageGeometry, page: number, x: number, y: number): GlyphPos | null {
  const loose = glyphAt(geo, { x, y });
  if (loose >= 0) return { page, index: loose };
  let best = -1;
  let bestDist = Infinity;
  for (const run of geo.runs) {
    for (let i = 0; i < run.glyphs.length; i++) {
      const g = run.glyphs[i];
      if (g.width === 0 && g.height === 0) continue;
      const dx = x < g.x ? g.x - x : x > g.x + g.width ? x - (g.x + g.width) : 0;
      const dy = y < g.y ? g.y - y : y > g.y + g.height ? y - (g.y + g.height) : 0;
      // A line away counts for more than a word along it.
      const d = dy * 4 + dx;
      if (d < bestDist) {
        bestDist = d;
        best = run.charStart + i;
      }
    }
  }
  return best < 0 ? null : { page, index: best };
}

/** The word around a glyph: back to the space before it, on to the one after. */
export function wordAround(geo: PdfPageGeometry, at: GlyphPos): GlyphSpan {
  const w = expandToWordBoundary(geo, at.index);
  if (!w) return { start: at, end: at };
  return { start: { page: at.page, index: w.from }, end: { page: at.page, index: w.to } };
}

/**
 * The selection from the word a hold began on to the word under the finger, in
 * whichever direction the finger is: the far edge of each, so a drag never cuts
 * a word. The phone's column grows its selection the same way (epub/word.ts).
 */
export function spanToWord(held: GlyphSpan, target: GlyphSpan): GlyphSpan {
  if (compareGlyphs(target.start, held.start) < 0) return { start: target.start, end: held.end };
  return { start: held.start, end: target.end };
}

/**
 * A handle was dragged onto a word: that end of the selection goes to the
 * word's far edge and grows from the end that stays, the way a drag grows from
 * the held word.
 */
export function moveSpanEnd(span: GlyphSpan, end: "start" | "end", target: GlyphSpan): GlyphSpan {
  const stays = end === "start" ? span.end : span.start;
  return spanToWord({ start: stays, end: stays }, target);
}

/** Each page the span touches, with the glyphs on it (inclusive). */
export function spanSlices(span: GlyphSpan, geometry: Geometries): { page: number; from: number; to: number }[] {
  const out: { page: number; from: number; to: number }[] = [];
  for (let page = span.start.page; page <= span.end.page; page++) {
    const geo = geometry(page);
    if (!geo) continue;
    const from = page === span.start.page ? span.start.index : 0;
    const to = page === span.end.page ? span.end.index : lastIndex(geo);
    if (to >= from) out.push({ page, from, to });
  }
  return out;
}

/** The span's line boxes on each page it touches, in page space. */
export function spanRects(span: GlyphSpan, geometry: Geometries): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>();
  for (const { page, from, to } of spanSlices(span, geometry)) {
    const geo = geometry(page);
    if (!geo) continue;
    const rects = rectsWithinSlice(geo, from, to);
    if (rects.length > 0) out.set(page, rects);
  }
  return out;
}
