// The geometry of a mark on a sheet, with no DOM in it. Every number here is
// in page coordinates: the 576 by 864 sheet of page-geometry.ts, origin at its
// top-left corner, y growing downward — the coordinate system the overlay is
// laid out in, so a rect written here is a rect the overlay draws unchanged.
//
// This is not the PDF side's space. A PDF mark is stored in PDF points with a
// bottom-left origin, and convert.ts flips y about the page height on the way
// in and out. An EPUB page has no PDF points and no such convention to honour,
// so it keeps the one the browser already uses and there is nothing to flip.
//
// Marks anchored on text (highlight, underline, the AI pen) are not stored in
// these coordinates at all — they are stored as a range CFI and found again by
// resolving it, which is what survives a re-paginated book. Only ink is stored
// as geometry, because free strokes are not on any words.

import { BODY_HEIGHT, BODY_WIDTH, PAGE_HEIGHT, PAGE_PAD_X, PAGE_PAD_Y, PAGE_WIDTH } from "./page-geometry";

export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PagePoint {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The text block: what the sheet actually shows of the laid-out columns. */
export const BODY_BOX: Box = Object.freeze({
  left: PAGE_PAD_X,
  top: PAGE_PAD_Y,
  right: PAGE_PAD_X + BODY_WIDTH,
  bottom: PAGE_PAD_Y + BODY_HEIGHT,
});

/** The whole sheet, which is as far as ink may go. */
export const PAGE_BOX: Box = Object.freeze({ left: 0, top: 0, right: PAGE_WIDTH, bottom: PAGE_HEIGHT });

/**
 * A rect cut down to a box, or null when the two do not meet.
 *
 * Every text mark is clipped to the text block rather than to the sheet. A
 * range that runs past the foot of a page continues in the next column, which
 * the layout has laid out beside this one and the clip box hides; without the
 * cut its rects would be painted in the sheet's margin, where the words they
 * belong to are not.
 */
export function clipRect(r: PageRect, box: Box = BODY_BOX): PageRect | null {
  const left = Math.max(r.left, box.left);
  const top = Math.max(r.top, box.top);
  const right = Math.min(r.left + r.width, box.right);
  const bottom = Math.min(r.top + r.height, box.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function clipRects(rects: readonly PageRect[], box: Box = BODY_BOX): PageRect[] {
  const out: PageRect[] = [];
  for (const r of rects) {
    const cut = clipRect(r, box);
    if (cut) out.push(cut);
  }
  return out;
}

/** A point held inside a box. */
export function clampPoint(p: PagePoint, box: Box = PAGE_BOX): PagePoint {
  return {
    x: Math.min(Math.max(p.x, box.left), box.right),
    y: Math.min(Math.max(p.y, box.top), box.bottom),
  };
}

/** The smallest rect holding all of them, or null for none. */
export function unionRect(rects: readonly PageRect[]): PageRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** How thick an underline is drawn, and how far under the words it sits. */
export const UNDERLINE_THICKNESS = 2;

/** The band an underline paints for one line's rect. */
export function underlineBand(r: PageRect, thickness = UNDERLINE_THICKNESS): PageRect {
  return {
    left: r.left,
    top: r.top + Math.max(0, r.height - thickness),
    width: r.width,
    height: Math.min(thickness, r.height),
  };
}

// ------------------------------------------------------------ hit testing ---

/** How far outside a mark a press still counts as a press on it. */
export const HIT_PAD = 3;

export function rectsHit(rects: readonly PageRect[], p: PagePoint, pad = HIT_PAD): boolean {
  for (const r of rects) {
    if (
      p.x >= r.left - pad &&
      p.x <= r.left + r.width + pad &&
      p.y >= r.top - pad &&
      p.y <= r.top + r.height + pad
    ) {
      return true;
    }
  }
  return false;
}

/** Squared distance from a point to a segment, so no square root is taken. */
function distanceToSegment(p: PagePoint, a: PagePoint, b: PagePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  if (len === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
  t = Math.min(1, Math.max(0, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/** Whether a press lands on one of an ink mark's strokes. */
export function pathsHit(paths: readonly number[][], p: PagePoint, tolerance: number): boolean {
  const limit = tolerance * tolerance;
  for (const flat of paths) {
    if (flat.length < 2) continue;
    if (flat.length === 2) {
      if ((p.x - flat[0]) ** 2 + (p.y - flat[1]) ** 2 <= limit) return true;
      continue;
    }
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const a = { x: flat[i], y: flat[i + 1] };
      const b = { x: flat[i + 2], y: flat[i + 3] };
      if (distanceToSegment(p, a, b) <= limit) return true;
    }
  }
  return false;
}

// -------------------------------------------------------------------- ink ---

/** The width an ink stroke is drawn at when the mark does not say. */
export const INK_WIDTH = 2;

/** How far the pen must move before a stroke records another point. */
export const INK_MIN_STEP = 1.5;

export function shouldAppendInkPoint(last: PagePoint | undefined, next: PagePoint, minStep = INK_MIN_STEP): boolean {
  if (!last) return true;
  return Math.abs(next.x - last.x) >= minStep || Math.abs(next.y - last.y) >= minStep;
}

/** Points to the flat `[x0,y0,x1,y1,…]` a stroke is stored as, rounded to 0.1px. */
export function pointsToPath(points: readonly PagePoint[]): number[] {
  const flat: number[] = [];
  for (const p of points) flat.push(round(p.x), round(p.y));
  return flat;
}

export function pathToPoints(flat: readonly number[]): PagePoint[] {
  const points: PagePoint[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
  return points;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The `points` attribute of an SVG polyline for one stored stroke. */
export function polylinePoints(flat: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) parts.push(`${flat[i]},${flat[i + 1]}`);
  return parts.join(" ");
}

/** The box a set of strokes occupies, or null when they hold no points. */
export function pathsBounds(paths: readonly number[][]): PageRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const flat of paths) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      left = Math.min(left, flat[i]);
      right = Math.max(right, flat[i]);
      top = Math.min(top, flat[i + 1]);
      bottom = Math.max(bottom, flat[i + 1]);
    }
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

// ------------------------------------------------------------- the anchor ---

/** A page rect as the viewport rect an annotation popup is anchored on. */
export function popupRect(
  rect: PageRect,
  toViewport: (p: PagePoint) => PagePoint,
): [number, number, number, number] {
  const a = toViewport({ x: rect.left, y: rect.top });
  const b = toViewport({ x: rect.left + rect.width, y: rect.top + rect.height });
  return [a.x, a.y, b.x, b.y];
}
