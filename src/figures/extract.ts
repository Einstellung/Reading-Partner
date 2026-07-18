// Figure-index extraction (M9). Runs alongside full-text extraction on the same
// pinned pdf.js: for each page it walks the operator list to find where the
// figure art lands (raster image objects AND vector drawing — academic figures
// are mostly paths + text, so raster alone yields a sliver) and pairs each
// figure region with the nearest caption line matching /^(Figure|Fig.?)\s*N/.
// The pure functions take plain operator/text data so they run headless under
// `bun test`; getOperatorList itself needs a DOM (DOMMatrix) and only runs in
// the webview, so extractFiguresFromDocument is exercised by the app, not tests.
//
// Coordinates: the operator list is in PDF user space (bottom-left origin, y up,
// points). Pairing happens in that space; the final bbox is flipped to top-left
// page space (see types.ts) for the renderer.

import { FIGURES_VERSION, type Figure, type FigureBBox, type FiguresIndex } from "./types";

// Sub-op codes inside a constructPath op, needed to decode its flat argument
// array (each verb consumes a fixed number of coordinates).
export interface PathVerbs {
  moveTo: number;
  lineTo: number;
  curveTo: number;
  curveTo2: number;
  curveTo3: number;
  rectangle: number;
  closePath: number;
}

// The subset of pdf.js OPS codes the walk needs, injected so the pure functions
// never import pdfjs (and tests can use their own numbering). The vector fields
// are optional: when omitted the walk stays raster-only (the original behavior).
export interface OpCodes {
  save: number;
  restore: number;
  transform: number;
  // Every op that paints an image (paintImageXObject, paintInlineImageXObject,
  // paintImageMaskXObject, …). Any of these marks an image at the current CTM.
  image: Set<number>;
  // Vector drawing. constructPath records a path; paint ops (stroke/fill/eoFill
  // …) commit it as figure art; clipEnd ops (clip/eoClip/endPath) discard it so
  // clip regions don't inflate the bbox.
  constructPath?: number;
  paint?: Set<number>;
  clipEnd?: Set<number>;
  path?: PathVerbs;
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
// of every image paint. Pure: no pdfjs, no DOM. Raster only — kept for the
// raster-specific tests; the pipeline uses graphicsBoxesFromOps.
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

// Bounding box (in the path's own coordinate space, then mapped through the CTM)
// of one constructPath op. pdf.js 4.x packs the op as [subOpCodes[], flatArgs[],
// minMax]; minMax skips bezier control points, so we decode the flat args
// instead. Verb arg counts: rectangle 4 (x,y,w,h), moveTo/lineTo 2, curveTo 6,
// curveTo2/curveTo3 4, closePath 0. Returns null for an empty / undecodable path.
function pathBoxFromConstruct(arg: unknown, ctm: Matrix, verbs: PathVerbs): UserRect | null {
  if (!Array.isArray(arg)) return null;
  const subOps = arg[0] as number[] | undefined;
  const flat = arg[1] as number[] | undefined;
  if (!Array.isArray(subOps) || !Array.isArray(flat)) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (px: number, py: number) => {
    const p = apply(ctm, px, py);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  let j = 0;
  for (const op of subOps) {
    if (op === verbs.rectangle) {
      const x = flat[j++];
      const y = flat[j++];
      const w = flat[j++];
      const h = flat[j++];
      add(x, y);
      add(x + w, y + h);
    } else if (op === verbs.moveTo || op === verbs.lineTo) {
      add(flat[j++], flat[j++]);
    } else if (op === verbs.curveTo) {
      add(flat[j++], flat[j++]);
      add(flat[j++], flat[j++]);
      add(flat[j++], flat[j++]);
    } else if (op === verbs.curveTo2 || op === verbs.curveTo3) {
      add(flat[j++], flat[j++]);
      add(flat[j++], flat[j++]);
    } else if (op === verbs.closePath) {
      // no coordinates
    } else {
      // Unknown verb: arg count is unknown, so the flat cursor would desync.
      // Stop and keep what we have.
      break;
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1 };
}

// Walk the operator list and return the user-space box of every painted graphic
// — raster images plus committed vector paths. A path box is accumulated at
// constructPath and only committed when a fill/stroke op paints it; a clip/endPath
// discards it. Pure: no pdfjs, no DOM.
export function graphicsBoxesFromOps(ops: OpList, codes: OpCodes): UserRect[] {
  let ctm = IDENTITY;
  const stack: Matrix[] = [];
  const boxes: UserRect[] = [];
  let pending: UserRect | null = null;
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
    } else if (codes.constructPath != null && fn === codes.constructPath && codes.path) {
      const b = pathBoxFromConstruct(ops.argsArray[i], ctm, codes.path);
      if (b) pending = pending ? unionRect(pending, b) : b;
    } else if (codes.paint && codes.paint.has(fn)) {
      if (pending && pending.x1 > pending.x0 && pending.y1 > pending.y0) boxes.push(pending);
      pending = null;
    } else if (codes.clipEnd && codes.clipEnd.has(fn)) {
      pending = null;
    }
  }
  return boxes;
}

// A caption line reconstructed from text items, in user space.
export interface CaptionLine {
  id: string;
  caption: string;
  x: number; // left edge
  width: number; // line width (points); 0 when item widths are unknown
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
      w: typeof it.width === "number" && it.width > 0 ? it.width : 0,
      h: typeof it.height === "number" && it.height > 0 ? it.height : DEFAULT_LINE_H,
    }));
  // Group into lines by baseline y (top of page first), then order by x within.
  positioned.sort((a, b) => (Math.abs(a.y - b.y) <= LINE_Y_TOL ? a.x - b.x : b.y - a.y));
  const lines: { text: string; x: number; xRight: number; y: number; h: number }[] = [];
  for (const it of positioned) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= LINE_Y_TOL) {
      last.text += it.str;
      last.x = Math.min(last.x, it.x);
      last.xRight = Math.max(last.xRight, it.x + it.w);
      last.h = Math.max(last.h, it.h);
    } else {
      lines.push({ text: it.str, x: it.x, xRight: it.x + it.w, y: it.y, h: it.h });
    }
  }
  const out: CaptionLine[] = [];
  for (const ln of lines) {
    const text = ln.text.trim();
    const m = FIG_RE.exec(text);
    if (!m) continue;
    out.push({
      id: m[1].toLowerCase(),
      caption: text,
      x: ln.x,
      width: Math.max(0, ln.xRight - ln.x),
      yBaseline: ln.y,
      yTop: ln.y + ln.h,
    });
  }
  return out;
}

// Every positioned text item as a user-space box (baseline .. baseline+height).
// Used to absorb a figure's own labels into its bbox and to find the text block
// above a caption for the fallback region.
export function textBoxesFromItems(items: TextItem[]): UserRect[] {
  const out: UserRect[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform || it.transform.length < 6) continue;
    if (it.str.trim() === "") continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
    const h = typeof it.height === "number" && it.height > 0 ? it.height : DEFAULT_LINE_H;
    out.push({ x0: x, y0: y, x1: x + w, y1: y + h });
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

function unionRect(a: UserRect, b: UserRect): UserRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function union(rects: UserRect[]): UserRect {
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
}

// Two boxes belong to the same figure region when they overlap or sit within
// this gap (points) on both axes. Small enough that a two-column layout's
// separate figures stay apart, large enough that one figure's scattered strokes,
// arrowheads and labels merge.
const CLUSTER_GAP = 18;

// Signed separation on one axis: >0 is a gap, <=0 is overlap.
function sep(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(a0 - b1, b0 - a1);
}

// Merge graphics boxes into connected regions (union-find over the overlap/near
// relation). One figure's scattered parts collapse into a region; two figures
// separated by more than CLUSTER_GAP stay distinct.
export function clusterBoxes(boxes: UserRect[], gap = CLUSTER_GAP): UserRect[] {
  const n = boxes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (sep(a.x0, a.x1, b.x0, b.x1) <= gap && sep(a.y0, a.y1, b.y0, b.y1) <= gap) unite(i, j);
    }
  }
  const groups = new Map<number, UserRect>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const prev = groups.get(r);
    groups.set(r, prev ? unionRect(prev, boxes[i]) : boxes[i]);
  }
  return [...groups.values()];
}

function toTopLeft(r: UserRect, pageHeight: number): FigureBBox {
  return { x: r.x0, y: pageHeight - r.y1, width: r.x1 - r.x0, height: r.y1 - r.y0 };
}

// Grow a figure region to include text items whose center falls inside it
// (axis labels, legends) without chasing text outside. Iterated so an absorbed
// label can pull in an adjacent one; bounded to stay cheap.
const LABEL_ABSORB_ITER = 3;
function absorbLabels(box: UserRect, textBoxes: UserRect[]): UserRect {
  let cur = box;
  for (let iter = 0; iter < LABEL_ABSORB_ITER; iter++) {
    let grew = false;
    for (const t of textBoxes) {
      const cx = (t.x0 + t.x1) / 2;
      const cy = (t.y0 + t.y1) / 2;
      if (cx < cur.x0 || cx > cur.x1 || cy < cur.y0 || cy > cur.y1) continue;
      const u = unionRect(cur, t);
      if (u.x0 < cur.x0 || u.y0 < cur.y0 || u.x1 > cur.x1 || u.y1 > cur.y1) {
        cur = u;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return cur;
}

// A figure bbox narrower than its caption, or absurdly narrow for the page, is
// untrustworthy.
const MIN_WIDTH_FRAC = 0.15;
function wideEnough(box: UserRect, caption: CaptionLine, pageWidth?: number): boolean {
  const w = box.x1 - box.x0;
  if (caption.width > 0 && w < caption.width) return false;
  if (pageWidth && w < MIN_WIDTH_FRAC * pageWidth) return false;
  return true;
}

// Caption-anchored fallback region: the caption's horizontal span (or a column
// width when the span is unknown) extending upward from the caption to the
// nearest wide text line above it, capped at CAP_MAX_FRAC of the page height.
// Returns null when it can't even be sized.
const CAP_MAX_FRAC = 0.6;
const CAP_FALLBACK_COL_FRAC = 0.45;
export function captionAnchoredRegion(
  caption: CaptionLine,
  textBoxes: UserRect[],
  pageHeight: number,
  pageWidth?: number,
): UserRect | null {
  const capW =
    caption.width > 0 ? caption.width : pageWidth ? CAP_FALLBACK_COL_FRAC * pageWidth : 0;
  if (capW <= 0) return null;
  const x0 = caption.x;
  const x1 = caption.x + capW;
  const yBottom = caption.yTop; // just above the caption text
  const maxTop = caption.yTop + CAP_MAX_FRAC * pageHeight;
  let top = maxTop;
  for (const t of textBoxes) {
    if (t.y0 <= caption.yTop + DEFAULT_LINE_H) continue; // not above the caption
    if (t.y0 >= maxTop) continue; // beyond the cap
    // Require a body-width line so a small in-figure label doesn't cap the region.
    if (xOverlap(x0, x1, t.x0, t.x1) < 0.5) continue;
    top = Math.min(top, t.y0);
  }
  if (top <= yBottom) return null;
  return { x0, y0: yBottom, x1, y1: top };
}

// Options for the pairing pass. Omitting them keeps the original raster-only
// behavior (no label absorption, no sanity floor).
export interface PairOptions {
  textBoxes?: UserRect[];
  pageWidth?: number;
}

// Pair captions with figure regions on one page. Each region is assigned to the
// nearest caption that sits below it (captions sit below the art); all regions
// assigned to one caption merge (multi-panel). The merged box absorbs its own
// labels; if it's narrower than the caption it's replaced by the caption-anchored
// fallback, or null (whole page) when even that is unavailable. `page` is 1-based.
export function pairFiguresOnPage(
  regionBoxes: UserRect[],
  captions: CaptionLine[],
  page: number,
  pageHeight: number,
  opts: PairOptions = {},
): Figure[] {
  const maxGap = 0.35 * pageHeight;
  const assigned = new Map<number, UserRect[]>(); // caption index -> its regions
  for (const box of regionBoxes) {
    let best = -1;
    let bestGap = Infinity;
    for (let ci = 0; ci < captions.length; ci++) {
      const c = captions[ci];
      // Caption below the region: its top is at or just under the region's bottom.
      const gap = box.y0 - c.yTop;
      if (gap < -DEFAULT_LINE_H) continue; // caption sits above the region
      if (gap > maxGap) continue;
      // Require some horizontal relationship so a caption doesn't grab a region
      // in the other column.
      if (xOverlap(box.x0, box.x1, c.x, c.x + Math.max(40, box.x1 - box.x0)) <= 0 && Math.abs(gap) > 40)
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
    const regions = assigned.get(ci);
    let bbox: FigureBBox | null = null;
    if (regions && regions.length) {
      let box = union(regions);
      if (opts.textBoxes) box = absorbLabels(box, opts.textBoxes);
      if (wideEnough(box, c, opts.pageWidth)) {
        bbox = toTopLeft(box, pageHeight);
      } else {
        const fb = captionAnchoredRegion(c, opts.textBoxes ?? [], pageHeight, opts.pageWidth);
        // Never ship a bbox narrower than the caption; fall back to whole page.
        bbox = fb && wideEnough(fb, c, opts.pageWidth) ? toTopLeft(fb, pageHeight) : null;
      }
    }
    return { id: c.id, page, caption: c.caption, bbox };
  });
}

// Everything one page needs to yield its figures. `pageHeight`/`pageWidth` are
// the page's dimensions in points (user space); pageWidth is optional.
export interface PageInput {
  page: number; // 1-based
  pageHeight: number;
  pageWidth?: number;
  ops: OpList;
  textItems: TextItem[];
}

// A vector box this close to the full page is a page background / border, not a
// figure — dropped before clustering so it doesn't swallow the whole page.
const FULL_PAGE_FRAC = 0.95;

export function figuresForPage(input: PageInput, codes: OpCodes): Figure[] {
  let boxes = graphicsBoxesFromOps(input.ops, codes);
  if (input.pageWidth) {
    const pw = input.pageWidth;
    const ph = input.pageHeight;
    boxes = boxes.filter(
      (b) => !(b.x1 - b.x0 >= FULL_PAGE_FRAC * pw && b.y1 - b.y0 >= FULL_PAGE_FRAC * ph),
    );
  }
  const clusters = clusterBoxes(boxes);
  const captions = captionLinesFromText(input.textItems);
  const textBoxes = textBoxesFromItems(input.textItems);
  return pairFiguresOnPage(clusters, captions, input.page, input.pageHeight, {
    textBoxes,
    pageWidth: input.pageWidth,
  });
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
  const paint = new Set<number>();
  for (const name of [
    "stroke",
    "closeStroke",
    "fill",
    "eoFill",
    "fillStroke",
    "eoFillStroke",
    "closeFillStroke",
    "closeEOFillStroke",
  ]) {
    if (typeof OPS[name] === "number") paint.add(OPS[name]);
  }
  const clipEnd = new Set<number>();
  for (const name of ["endPath", "clip", "eoClip"]) {
    if (typeof OPS[name] === "number") clipEnd.add(OPS[name]);
  }
  const path: PathVerbs = {
    moveTo: OPS.moveTo,
    lineTo: OPS.lineTo,
    curveTo: OPS.curveTo,
    curveTo2: OPS.curveTo2,
    curveTo3: OPS.curveTo3,
    rectangle: OPS.rectangle,
    closePath: OPS.closePath,
  };
  return {
    save: OPS.save,
    restore: OPS.restore,
    transform: OPS.transform,
    image,
    constructPath: OPS.constructPath,
    paint,
    clipEnd,
    path,
  };
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
      const viewport = page.getViewport({ scale: 1 });
      const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
      perPage.push(
        figuresForPage(
          { page: n, pageHeight: viewport.height, pageWidth: viewport.width, ops, textItems: text.items },
          codes,
        ),
      );
    } catch {
      perPage.push([]);
    }
    if (n % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return assembleIndex(perPage);
}

export { FIGURES_VERSION };
export type { PdfjsModule };
