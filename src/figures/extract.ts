// Figure-index extraction (M9). Runs alongside full-text extraction on the same
// pinned pdf.js: for each page it walks the operator list to find image objects
// (bounding box = the current transform applied to the image's unit square) and
// pairs each with the nearest caption line matching /^(Figure|Fig.?)\s*N/. The
// pure functions take plain operator/text data so they run headless under `bun
// test`; getOperatorList itself needs a DOM (DOMMatrix) and only runs in the
// webview, so extractFiguresFromDocument is exercised by the app, not tests.
//
// Coordinates: the operator list is in PDF user space (bottom-left origin, y up,
// points). Pairing happens in that space; the final bbox is flipped to top-left
// page space (see types.ts) for the renderer.

import { FIGURES_VERSION, type Figure, type FigureBBox, type FiguresIndex } from "./types";

// The subset of pdf.js OPS codes the walk needs, injected so the pure functions
// never import pdfjs (and tests can use their own numbering).
export interface OpCodes {
  save: number;
  restore: number;
  transform: number;
  // Every op that paints an image (paintImageXObject, paintInlineImageXObject,
  // paintImageMaskXObject, …). Any of these marks an image at the current CTM.
  image: Set<number>;
}

// pdf.js OperatorList shape (the parts we read).
export interface OpList {
  fnArray: number[];
  argsArray: unknown[];
}

// pdf.js text item (getTextContent), the fields we read. `transform` is
// [a,b,c,d,e,f]; e,f is the baseline origin in user space.
export interface TextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// PDF matrix product with row-vector convention (p' = p·M): `inner` is applied
// first, then `outer`. A `cm` operator concatenates as CTM = cm ∘ CTM_old.
function multiply(inner: Matrix, outer: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = inner;
  const [a2, b2, c2, d2, e2, f2] = outer;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// Rect in user space (bottom-left origin): [x0,y0] bottom-left, [x1,y1] top-right.
interface UserRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// The axis-aligned box of the unit square [0,1]² mapped through the CTM — where
// an image XObject lands, since pdf.js always draws images into the unit square.
function unitSquareBox(ctm: Matrix): UserRect {
  const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

// Images thinner than this (points) are hairlines / rules / tiny icons, not
// figures — dropped so they don't get paired with a caption.
const MIN_IMAGE_PT = 12;

// Walk the operator list, tracking the CTM stack, and return the user-space box
// of every image paint. Pure: no pdfjs, no DOM.
export function imageBoxesFromOps(ops: OpList, codes: OpCodes): UserRect[] {
  let ctm = IDENTITY;
  const stack: Matrix[] = [];
  const boxes: UserRect[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === codes.save) {
      stack.push(ctm);
    } else if (fn === codes.restore) {
      if (stack.length) ctm = stack.pop() as Matrix;
    } else if (fn === codes.transform) {
      const a = ops.argsArray[i] as number[] | undefined;
      if (a && a.length >= 6) ctm = multiply([a[0], a[1], a[2], a[3], a[4], a[5]], ctm);
    } else if (codes.image.has(fn)) {
      const b = unitSquareBox(ctm);
      if (b.x1 - b.x0 >= MIN_IMAGE_PT && b.y1 - b.y0 >= MIN_IMAGE_PT) boxes.push(b);
    }
  }
  return boxes;
}

// A caption line reconstructed from text items, in user space.
export interface CaptionLine {
  id: string;
  caption: string;
  x: number; // left edge
  yBaseline: number; // baseline y (user space)
  yTop: number; // approximate top of the line
}

const FIG_RE = /^(?:figure|fig\.?)\s*(\d+[a-z]?)\b/i;
// Group text items whose baselines fall within this many points into one line.
const LINE_Y_TOL = 3;
const DEFAULT_LINE_H = 10;

// Reconstruct text lines from positioned items and return those that open a
// figure caption. Items with no position are ignored (can't be paired).
export function captionLinesFromText(items: TextItem[]): CaptionLine[] {
  const positioned = items
    .filter((it) => typeof it.str === "string" && it.transform && it.transform.length >= 6)
    .map((it) => ({
      str: it.str as string,
      x: (it.transform as number[])[4],
      y: (it.transform as number[])[5],
      h: typeof it.height === "number" && it.height > 0 ? it.height : DEFAULT_LINE_H,
    }));
  // Group into lines by baseline y (top of page first), then order by x within.
  positioned.sort((a, b) => (Math.abs(a.y - b.y) <= LINE_Y_TOL ? a.x - b.x : b.y - a.y));
  const lines: { text: string; x: number; y: number; h: number }[] = [];
  for (const it of positioned) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= LINE_Y_TOL) {
      last.text += it.str;
      last.x = Math.min(last.x, it.x);
      last.h = Math.max(last.h, it.h);
    } else {
      lines.push({ text: it.str, x: it.x, y: it.y, h: it.h });
    }
  }
  const out: CaptionLine[] = [];
  for (const ln of lines) {
    const text = ln.text.trim();
    const m = FIG_RE.exec(text);
    if (!m) continue;
    out.push({ id: m[1].toLowerCase(), caption: text, x: ln.x, yBaseline: ln.y, yTop: ln.y + ln.h });
  }
  return out;
}

// Horizontal overlap fraction of two x-ranges (0..1 of the narrower range).
function xOverlap(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (hi <= lo) return 0;
  return (hi - lo) / Math.max(1, Math.min(a1 - a0, b1 - b0));
}

function union(rects: UserRect[]): UserRect {
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
}

function toTopLeft(r: UserRect, pageHeight: number): FigureBBox {
  return { x: r.x0, y: pageHeight - r.y1, width: r.x1 - r.x0, height: r.y1 - r.y0 };
}

// Pair captions with image boxes on one page. Each image is assigned to the
// nearest caption that sits below it (figures caption below the art); all images
// assigned to one caption merge into a single bbox (multi-panel). A caption with
// no image within reach keeps bbox null. `page` is 1-based.
export function pairFiguresOnPage(
  imageBoxes: UserRect[],
  captions: CaptionLine[],
  page: number,
  pageHeight: number,
): Figure[] {
  const maxGap = 0.35 * pageHeight;
  const assigned = new Map<number, UserRect[]>(); // caption index -> its images
  for (const box of imageBoxes) {
    let best = -1;
    let bestGap = Infinity;
    for (let ci = 0; ci < captions.length; ci++) {
      const c = captions[ci];
      // Caption below the image: its top is at or just under the image's bottom.
      const gap = box.y0 - c.yTop;
      if (gap < -DEFAULT_LINE_H) continue; // caption sits above the image
      if (gap > maxGap) continue;
      // Require some horizontal relationship so a caption doesn't grab an image
      // in the other column.
      if (xOverlap(box.x0, box.x1, c.x, c.x + Math.max(40, (box.x1 - box.x0))) <= 0 && Math.abs(gap) > 40)
        continue;
      const score = Math.abs(gap);
      if (score < bestGap) {
        bestGap = score;
        best = ci;
      }
    }
    if (best >= 0) {
      const arr = assigned.get(best) ?? [];
      arr.push(box);
      assigned.set(best, arr);
    }
  }
  return captions.map((c, ci) => {
    const imgs = assigned.get(ci);
    const bbox = imgs && imgs.length ? toTopLeft(union(imgs), pageHeight) : null;
    return { id: c.id, page, caption: c.caption, bbox };
  });
}

// Everything one page needs to yield its figures. `pageHeight` is the page's
// height in points (user space).
export interface PageInput {
  page: number; // 1-based
  pageHeight: number;
  ops: OpList;
  textItems: TextItem[];
}

export function figuresForPage(input: PageInput, codes: OpCodes): Figure[] {
  const boxes = imageBoxesFromOps(input.ops, codes);
  const captions = captionLinesFromText(input.textItems);
  return pairFiguresOnPage(boxes, captions, input.page, input.pageHeight);
}

// Assemble the whole index from per-page results, de-duplicating repeated figure
// ids (a figure spanning a page break, or a caption echoed in a running header):
// the first occurrence with a bbox wins, otherwise the first occurrence.
export function assembleIndex(perPage: Figure[][]): FiguresIndex {
  const byId = new Map<string, Figure>();
  for (const page of perPage) {
    for (const fig of page) {
      const prev = byId.get(fig.id);
      if (!prev) byId.set(fig.id, fig);
      else if (!prev.bbox && fig.bbox) byId.set(fig.id, fig);
    }
  }
  const figures = [...byId.values()].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id));
  return { version: FIGURES_VERSION, figures };
}

// --- engine-backed path (browser only) ---

// Structural subset of pdf.js we drive here.
interface PdfjsPageOps {
  getViewport(o: { scale: number }): { width: number; height: number };
  getOperatorList(): Promise<OpList>;
  getTextContent(): Promise<{ items: TextItem[] }>;
}
interface PdfjsDocOps {
  numPages: number;
  getPage(n: number): Promise<PdfjsPageOps>;
}
interface PdfjsModule {
  OPS: Record<string, number>;
}

function opCodesFrom(OPS: Record<string, number>): OpCodes {
  const image = new Set<number>();
  for (const [name, code] of Object.entries(OPS)) {
    if (/^paint(Image|InlineImage|SolidColorImageMask)/.test(name)) image.add(code);
  }
  return { save: OPS.save, restore: OPS.restore, transform: OPS.transform, image };
}

const YIELD_EVERY = 4;

// Build the figure index from an open pdf.js document. Never throws for a single
// bad page — a page that fails to yield an operator list contributes nothing.
export async function extractFiguresFromDocument(
  doc: PdfjsDocOps,
  OPS: Record<string, number>,
): Promise<FiguresIndex> {
  const codes = opCodesFrom(OPS);
  const perPage: Figure[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n);
      const pageHeight = page.getViewport({ scale: 1 }).height;
      const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
      perPage.push(figuresForPage({ page: n, pageHeight, ops, textItems: text.items }, codes));
    } catch {
      perPage.push([]);
    }
    if (n % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return assembleIndex(perPage);
}

export { FIGURES_VERSION };
export type { PdfjsModule };
