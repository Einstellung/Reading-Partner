// What the phone's paged reading area decides, with no DOM in it (docs/79).
// paged-view.ts measures and writes; the arithmetic between a column strip, a
// window of spine documents and a screen page is here, where a test reaches it.
//
// A screen page is one column of one spine document laid out as CSS columns at
// this device's width and this reader's type. It is never stored: the position
// that is written down is a CFI, and the page number the reader sees is the
// pagination table's (docs/64), both reached from a screen page by measuring.

import { FLOW_PAD_Y, type FlowDisplay } from "./flow-display";

/**
 * The column rules one spine document is laid out under, added after the flow
 * baseline (flow-mount.ts). `.rp-paper` becomes the multi-column box: one
 * column per screen, the gap twice the side margin so column k starts exactly
 * k screens to the right. The paper's own wash is not drawn here, since a
 * multicol box gives an absolute child only its first column's width; the
 * paged view paints the wash over the whole strip instead. A picture never
 * outgrows a page and is never cut across two.
 */
export function pagedColumnCss(width: number, height: number, display: FlowDisplay): string {
  const padX = display.padX;
  const body = Math.max(1, height - 2 * FLOW_PAD_Y);
  return `
.rp-paper {
  box-sizing: border-box;
  width: ${width}px;
  height: ${height}px;
  padding: ${FLOW_PAD_Y}px ${padX}px;
  column-width: ${Math.max(1, width - 2 * padX)}px;
  column-gap: ${2 * padX}px;
  column-fill: auto;
}
.rp-wash { display: none; }
img, svg, video { max-height: ${body}px; object-fit: contain; break-inside: avoid; }
figure { break-inside: avoid; }`;
}

/** How many screens a column strip this wide holds; never fewer than one. */
export function columnCount(scrollWidth: number, width: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.round(scrollWidth / width));
}

/**
 * The column a box starting at `x` is in, for a strip whose first column's
 * screen starts at `originX`. Clamped to the strip, because a box a book pushed
 * out past the last column is still read as being on it.
 */
export function columnAt(x: number, originX: number, width: number, pages: number): number {
  if (width <= 0 || pages <= 1) return 0;
  const col = Math.floor((x - originX + 0.5) / width);
  return Math.min(Math.max(0, col), pages - 1);
}

export interface WindowDoc {
  spine: number;
  pages: number;
}

export interface WindowSlot extends WindowDoc {
  /** The window page this document's first column is. */
  first: number;
}

export interface PagedWindow {
  slots: WindowSlot[];
  total: number;
}

/**
 * The documents laid out side by side, in spine order: each starts where the
 * one before it ends. This is the strip the touch router drags across, so a
 * turn off the end of one chapter is a turn onto the next one.
 */
export function layoutWindow(docs: readonly WindowDoc[]): PagedWindow {
  const sorted = [...docs].sort((a, b) => a.spine - b.spine);
  const slots: WindowSlot[] = [];
  let total = 0;
  for (const d of sorted) {
    slots.push({ spine: d.spine, pages: d.pages, first: total });
    total += d.pages;
  }
  return { slots, total };
}

/** The document and its column a window page falls in, clamped to the window. */
export function locateInWindow(win: PagedWindow, page: number): { spine: number; column: number } | null {
  if (win.slots.length === 0) return null;
  const p = Math.min(Math.max(0, page), win.total - 1);
  for (const s of win.slots) {
    if (p < s.first + s.pages) return { spine: s.spine, column: p - s.first };
  }
  const last = win.slots[win.slots.length - 1];
  return { spine: last.spine, column: last.pages - 1 };
}

/** The window page of a document's column, or null when it is not in the window. */
export function windowPageOf(win: PagedWindow, spine: number, column: number): number | null {
  const s = win.slots.find((x) => x.spine === spine);
  if (!s) return null;
  return s.first + Math.min(Math.max(0, column), s.pages - 1);
}

/**
 * The documents kept laid out around the one being read: it and its two
 * neighbours, so a turn across either chapter boundary never waits.
 */
export function neighbourSpines(current: number, count: number): number[] {
  const out: number[] = [];
  for (const s of [current - 1, current, current + 1]) {
    if (s >= 0 && s < count) out.push(s);
  }
  return out;
}

/**
 * Where the first character on a shown page is looked for: down the column
 * from its top line in steps of a few pixels, at the line start and a little
 * way in, so an indented first line or a drop cap still has a point on words.
 */
export function pageProbePoints(
  box: { left: number; top: number; height: number },
  padX: number,
  step = 8,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const x0 = box.left + padX + 2;
  const y0 = box.top + FLOW_PAD_Y + 4;
  const bottom = box.top + box.height - FLOW_PAD_Y;
  for (let y = y0; y < bottom; y += step) {
    for (const dx of [0, 40, 120]) points.push({ x: x0 + dx, y });
  }
  return points;
}

/** Whether the character at an offset is ink rather than space. */
export function isInkAt(text: string, offset: number): boolean {
  const c = text.charAt(offset);
  return c !== "" && c.trim() !== "";
}

/** Whether a touch starts in the left band the shell's back gesture owns. */
export function inBackEdge(x: number, left: number, zone: number): boolean {
  return zone > 0 && x - left >= 0 && x - left < zone;
}
