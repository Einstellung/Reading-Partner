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

import { isUnspaced } from "../words/unspaced";

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

/** How many characters the page's text has, generated line breaks included. */
export function pageCharCount(geo: PdfPageGeometry): number {
  return lastIndex(geo) + 1;
}

function lastIndex(geo: PdfPageGeometry): number {
  const run = geo.runs[geo.runs.length - 1];
  return run ? run.charStart + run.glyphs.length - 1 : -1;
}

/**
 * The glyph under a point in page space, or null off the words: across, the
 * glyph's loose box, which meets its neighbours'; up and down, its line's ink
 * band. A glyph's own ink is no target: a comma's or a "一"'s is a sliver.
 * Spaces are not words.
 */
export function glyphUnder(geo: PdfPageGeometry, page: number, x: number, y: number): GlyphPos | null {
  const bands = lineBands(geo);
  for (let r = 0; r < geo.runs.length; r++) {
    const band = bands[r];
    if (!band || y < band.top || y > band.bottom) continue;
    const run = geo.runs[r];
    for (let i = 0; i < run.glyphs.length; i++) {
      const g = run.glyphs[i];
      if (g.flags !== 0 || g.width <= 0) continue;
      if (x >= g.x && x <= g.x + g.width) return { page, index: run.charStart + i };
    }
  }
  return null;
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

/**
 * The word around a glyph: back to the space before it, on to the one after.
 * With the page's text, a character of a script written without spaces is a
 * word of its own and ends a spaced word beside it; without it the engine's
 * spaces are the only boundaries, and a CJK line is one word
 * (docs/pitfall/embedpdf/677).
 */
export function wordAround(geo: PdfPageGeometry, at: GlyphPos, text?: string): GlyphSpan {
  if (text !== undefined && isUnspaced(text[at.index])) return { start: at, end: at };
  const w = expandToWordBoundary(geo, at.index);
  if (!w) return { start: at, end: at };
  let from = w.from;
  let to = w.to;
  if (text !== undefined) {
    from = at.index;
    while (from > w.from && !isUnspaced(text[from - 1])) from--;
    to = at.index;
    while (to < w.to && !isUnspaced(text[to + 1])) to++;
  }
  return { start: { page: at.page, index: from }, end: { page: at.page, index: to } };
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
    const rects = lineRects(geo, from, to);
    if (rects.length > 0) out.set(page, rects);
  }
  return out;
}

// --- line boxes -------------------------------------------------------------
//
// PDFium gives every glyph two boxes. The loose one is the font's whole
// ascent-to-descent cell: neighbours on a line meet edge to edge, which makes
// it the right box across, but a CJK face's cell can be twice the line pitch
// (docs/pitfall/embedpdf/678), so a highlight drawn from it covers the next
// line too and an underline lands in the middle of it. The tight one is the
// ink: right up and down for most glyphs, a sliver for a comma or a "一". A
// line's box is therefore the loose extent across and the line's ink band up
// and down: the union of the ink of every glyph in the run, padded a little
// and never into the next line's ink.

interface Band {
  top: number;
  bottom: number;
}

/** How far a line's band reaches past its ink, as a share of the ink's height. */
export const BAND_PAD = 0.15;

type Glyph = PdfPageGeometry["runs"][number]["glyphs"][number];

// A glyph's ink, or its loose box when the engine gave no tight one (then the
// box is the line already and is not padded).
function inkOf(g: Glyph): (Band & { tight: boolean }) | null {
  if (g.flags !== 0) return null;
  const { tightY, tightHeight } = g;
  if (tightY !== undefined && tightHeight !== undefined && Number.isFinite(tightY) && tightHeight > 0) {
    return { top: tightY, bottom: tightY + tightHeight, tight: true };
  }
  return g.height > 0 ? { top: g.y, bottom: g.y + g.height, tight: false } : null;
}

const bandCache = new WeakMap<PdfPageGeometry, (Band | null)[]>();

/** Each run's line band, null for a run with no ink (a generated line break). */
export function lineBands(geo: PdfPageGeometry): (Band | null)[] {
  const cached = bandCache.get(geo);
  if (cached) return cached;
  const ink = geo.runs.map((run) => {
    let top = Infinity;
    let bottom = -Infinity;
    let tight = false;
    for (const g of run.glyphs) {
      const b = inkOf(g);
      if (!b) continue;
      top = Math.min(top, b.top);
      bottom = Math.max(bottom, b.bottom);
      tight ||= b.tight;
    }
    return top < bottom ? { top, bottom, tight } : null;
  });
  // A run that is nothing but a dash or a comma has a sliver of ink: it gets
  // the page's usual line height around it.
  const heights = ink.flatMap((b) => (b ? [b.bottom - b.top] : [])).sort((a, b) => a - b);
  const usual = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 0;
  const bands = ink.map((b, r) => {
    if (!b) return null;
    let { top, bottom } = b;
    if (!b.tight) return { top, bottom };
    if (bottom - top < usual / 2) {
      const mid = (top + bottom) / 2;
      top = mid - usual / 2;
      bottom = mid + usual / 2;
    }
    const pad = (bottom - top) * BAND_PAD;
    // The nearest ink above and below among the runs sharing some of this
    // one's width: the pad stops halfway to it.
    const rect = geo.runs[r].rect;
    let above = -Infinity;
    let below = Infinity;
    ink.forEach((o, k) => {
      if (!o || k === r) return;
      const other = geo.runs[k].rect;
      if (other.x >= rect.x + rect.width || other.x + other.width <= rect.x) return;
      if (o.bottom <= b.top) above = Math.max(above, o.bottom);
      else if (o.top >= b.bottom) below = Math.min(below, o.top);
    });
    // Nor past the font's own cell, where that is the nearer.
    return {
      top: Math.min(top, Math.max(rect.y, top - Math.max(0, Math.min(pad, (top - above) / 2)))),
      bottom: Math.max(bottom, Math.min(rect.y + rect.height, bottom + Math.max(0, Math.min(pad, (below - bottom) / 2)))),
    };
  });
  bandCache.set(geo, bands);
  return bands;
}

const EPS = 0.5;

function holds(r: Rect, g: Glyph): boolean {
  return (
    g.x >= r.origin.x - EPS &&
    g.x + g.width <= r.origin.x + r.size.width + EPS &&
    g.y >= r.origin.y - EPS &&
    g.y + g.height <= r.origin.y + r.size.height + EPS
  );
}

/**
 * The line boxes of glyphs `from`..`to` (inclusive) on a page: across, the
 * selection plugin's own boxes, which split and join lines the way its
 * selection does; up and down, the band of the lines whose glyphs each box
 * holds.
 */
export function lineRects(geo: PdfPageGeometry, from: number, to: number): Rect[] {
  const loose = rectsWithinSlice(geo, from, to);
  const bands = lineBands(geo);
  const vertical: (Band | null)[] = loose.map(() => null);
  geo.runs.forEach((run, r) => {
    const band = bands[r];
    const end = run.charStart + run.glyphs.length - 1;
    if (!band || end < from || run.charStart > to) return;
    for (let i = Math.max(from, run.charStart); i <= Math.min(to, end); i++) {
      const g = run.glyphs[i - run.charStart];
      if (g.flags === 2) continue;
      const k = loose.findIndex((rect) => holds(rect, g));
      if (k < 0) continue;
      const v = vertical[k];
      vertical[k] = v ? { top: Math.min(v.top, band.top), bottom: Math.max(v.bottom, band.bottom) } : { ...band };
    }
  });
  return loose.map((rect, k) => {
    const v = vertical[k];
    return v ? { origin: { x: rect.origin.x, y: v.top }, size: { width: rect.size.width, height: v.bottom - v.top } } : rect;
  });
}
