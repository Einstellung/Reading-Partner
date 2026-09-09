// The paper an EPUB is set on (docs/64). A page is a sheet of fixed CSS pixels,
// US Letter at 96 dpi, with a fixed text block inside it and a fixed base type
// size. The book's own stylesheet is laid over this baseline. There is one
// sheet and the reader cannot choose it: a page number that depends on a
// setting is a page number two devices disagree about, and [p.N] strings have
// already left the app.
//
// Letter rather than the 6x9 the first release cut. The margins and the type
// are fixed, so the sheet decides the line: 6x9 gives 65 characters, Letter
// about 90. Fitted to an iPad's width a 6x9 sheet is blown up until 16px type
// reads as 24 and the line still holds those 65 characters; Letter fits at
// roughly the type's own size. A book cut on the old sheet is cut again the
// next time it is opened (pagination-store.ts, book-cache.ts).
//
// Zoom is what zoom is on a PDF: the sheet scaled as a whole. The steps and the
// two fits are the PDF side's (reading/engine/layout-modes.ts) applied to this
// one page size.

import { LAYOUT_SETTINGS, type ReadingLayout, type ZoomLock } from "../engine/layout-modes";
import { fitScale } from "../engine/layout-settle";

/** CSS pixels per inch: what a CSS inch is, and what the sheet is sized in. */
const DPI = 96;

export const PAGE_WIDTH = 8.5 * DPI; // 816
export const PAGE_HEIGHT = 11 * DPI; // 1056
export const PAGE_PAD_X = 48;
export const PAGE_PAD_Y = 56;
export const BODY_WIDTH = PAGE_WIDTH - 2 * PAGE_PAD_X; // 720
export const BODY_HEIGHT = PAGE_HEIGHT - 2 * PAGE_PAD_Y; // 944
export const BASE_FONT_PX = 16;
export const BASE_LINE_HEIGHT = 1.55;

// The faces the pages are set in, shipped with the app (public/fonts). The
// name is part of the geometry record: a table cut with other faces is a
// table for other pages.
export const READING_FONTS = "noto-serif-1";

export interface PageGeometry {
  width: number;
  height: number;
  padX: number;
  padY: number;
  fontSize: number;
  lineHeight: number;
  fonts: string;
}

export const PAGE_GEOMETRY: PageGeometry = Object.freeze({
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  padX: PAGE_PAD_X,
  padY: PAGE_PAD_Y,
  fontSize: BASE_FONT_PX,
  lineHeight: BASE_LINE_HEIGHT,
  fonts: READING_FONTS,
});

export function sameGeometry(a: PageGeometry | undefined, b: PageGeometry = PAGE_GEOMETRY): boolean {
  if (!a) return false;
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.padX === b.padX &&
    a.padY === b.padY &&
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.fonts === b.fonts
  );
}

/**
 * The sheet a stored table says it was cut on, whether or not it is this one.
 *
 * `sameGeometry` answers whether a table can still be used; this answers what
 * paper it was on, which is what an ink stroke has to be moved off when the
 * answer to the first question is no (migrate.ts). Null for a record that is
 * not a sheet at all — a table from before the field existed, or one whose
 * numbers make no page.
 */
export function readStoredGeometry(raw: unknown): PageGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const size = (key: string): number | null => {
    const v = g[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const pad = (key: string): number | null => {
    const v = g[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const width = size("width");
  const height = size("height");
  const padX = pad("padX");
  const padY = pad("padY");
  const fontSize = size("fontSize");
  const lineHeight = size("lineHeight");
  if (width === null || height === null || padX === null || padY === null) return null;
  if (fontSize === null || lineHeight === null) return null;
  if (width - 2 * padX <= 0 || height - 2 * padY <= 0) return null;
  return {
    width,
    height,
    padX,
    padY,
    fontSize,
    lineHeight,
    fonts: typeof g.fonts === "string" ? g.fonts : "",
  };
}

// --------------------------------------------------------------------- zoom --

export const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

const EPSILON = 1e-3;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** The next step above `scale`, or `scale` itself at the top. */
export function zoomStepUp(scale: number): number {
  for (const step of ZOOM_STEPS) if (step > scale + EPSILON) return step;
  return clampZoom(scale);
}

/** The next step below `scale`, or `scale` itself at the bottom. */
export function zoomStepDown(scale: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < scale - EPSILON) return ZOOM_STEPS[i];
  }
  return clampZoom(scale);
}

export function canZoomIn(scale: number): boolean {
  return scale < MAX_ZOOM - EPSILON;
}

export function canZoomOut(scale: number): boolean {
  return scale > MIN_ZOOM + EPSILON;
}

export interface Viewport {
  clientWidth: number;
  clientHeight: number;
}

/** The scale a fit resolves to for this page on this viewport. */
export function fitZoom(lock: ZoomLock, viewport: Viewport): number {
  const raw = fitScale(lock, { width: PAGE_WIDTH, height: PAGE_HEIGHT }, viewport, 0);
  return raw > 0 ? clampZoom(raw) : 1;
}

/** The fit a layout locks to: fit-width in the column, fit-page in the flip. */
export function lockedZoom(layout: ReadingLayout, viewport: Viewport): number {
  return fitZoom(LAYOUT_SETTINGS[layout].zoom, viewport);
}

// The zoom in effect: a lock that follows the viewport, or a number a pinch or
// a button left behind.
export type Zoom = { kind: "lock"; lock: ZoomLock } | { kind: "scale"; scale: number };

export function zoomScale(zoom: Zoom, layout: ReadingLayout, viewport: Viewport): number {
  if (zoom.kind === "scale") return zoom.scale;
  void layout;
  return fitZoom(zoom.lock, viewport);
}

/**
 * The zoom a book opens at. Same rule as the PDF side's openingZoom: the paged
 * flip always opens at fit-page; the column restores a saved number and falls
 * back to fit-width.
 */
export function openingEpubZoom(layout: ReadingLayout, saved: number | string | undefined): Zoom {
  const lock = LAYOUT_SETTINGS[layout].zoom;
  if (lock === "fit-page") return { kind: "lock", lock };
  return typeof saved === "number" && saved > 0
    ? { kind: "scale", scale: clampZoom(saved) }
    : { kind: "lock", lock };
}

/** Whether a reset would change anything: the zoom is not already the layout's lock. */
export function atLockedZoom(zoom: Zoom, layout: ReadingLayout): boolean {
  return zoom.kind === "lock" && zoom.lock === LAYOUT_SETTINGS[layout].zoom;
}

// ------------------------------------------------------------------- layout --

// Space between two sheets on the desk, in CSS pixels, the same number the PDF
// pages keep between them at scale 1 (page-frame.ts FLOAT_FRAME.pageGap).
export const PAGE_GAP = 8;

export interface StripMetrics {
  /** One slot's extent along the scroll axis: the scaled sheet plus the gap. */
  pitch: number;
  /** The scaled sheet. */
  pageWidth: number;
  pageHeight: number;
}

export function stripMetrics(scale: number): StripMetrics {
  const pageWidth = PAGE_WIDTH * scale;
  const pageHeight = PAGE_HEIGHT * scale;
  return { pitch: pageHeight + PAGE_GAP, pageWidth, pageHeight };
}

/**
 * Where the reader is in the vertical column: the page whose sheet the
 * viewport's top edge is in, and how far into it, in unscaled page units.
 */
export function columnPosition(
  scrollTop: number,
  scale: number,
  pagesCount: number,
): { pageIndex: number; pageY: number } {
  const { pitch } = stripMetrics(scale);
  if (pagesCount <= 0 || pitch <= 0) return { pageIndex: 0, pageY: 0 };
  const index = Math.min(pagesCount - 1, Math.max(0, Math.floor(scrollTop / pitch)));
  const within = Math.max(0, scrollTop - index * pitch) / scale;
  return { pageIndex: index, pageY: Math.min(PAGE_HEIGHT, within) };
}

/** The scroll offset that puts a page's top, or a point inside it, at the viewport top. */
export function columnScrollTop(pageIndex: number, pageY: number, scale: number): number {
  const { pitch } = stripMetrics(scale);
  return Math.max(0, pageIndex * pitch + Math.max(0, pageY) * scale);
}

/** The page a paged strip is resting on, given its horizontal scroll. */
export function flipPosition(scrollLeft: number, slotWidth: number, pagesCount: number): number {
  if (slotWidth <= 0 || pagesCount <= 0) return 0;
  return Math.min(pagesCount - 1, Math.max(0, Math.round(scrollLeft / slotWidth)));
}

/** The pages worth mounting around a visible range: the range plus a margin each side. */
export function mountRange(
  first: number,
  last: number,
  pagesCount: number,
  margin: number,
): { from: number; to: number } {
  return {
    from: Math.max(0, first - margin),
    to: Math.min(pagesCount - 1, last + margin),
  };
}

/** The visible page range of the vertical column. */
export function visibleColumnRange(
  scrollTop: number,
  clientHeight: number,
  scale: number,
  pagesCount: number,
): { first: number; last: number } {
  const { pitch } = stripMetrics(scale);
  if (pagesCount <= 0 || pitch <= 0) return { first: 0, last: -1 };
  const first = Math.min(pagesCount - 1, Math.max(0, Math.floor(scrollTop / pitch)));
  const last = Math.min(pagesCount - 1, Math.max(first, Math.floor((scrollTop + clientHeight - 1) / pitch)));
  return { first, last };
}

/** The column of a point in the laid-out text, by its x offset from the text block's left edge. */
export function columnOf(x: number, columnWidth: number = BODY_WIDTH): number {
  if (columnWidth <= 0) return 0;
  // A glyph's box can sit a fraction of a pixel left of its column.
  return Math.max(0, Math.floor((x + 0.5) / columnWidth));
}

// ---------------------------------------------------------------- the desk --

// The desk's geometry at one scale: how big a slot is, how far apart the slots
// sit, and where the sheet sits inside its slot. Vertical stacks the sheets
// with a gap and centres them across the desk; paged gives each page a
// viewport-sized slot and centres the whole sheet in it.
export interface DeskMetrics {
  slotWidth: number;
  slotHeight: number;
  pitchX: number;
  pitchY: number;
  pageWidth: number;
  pageHeight: number;
  /** The sheet's offset inside its slot. */
  cardLeft: number;
  cardTop: number;
}

export function deskMetrics(layout: ReadingLayout, scale: number, viewport: Viewport): DeskMetrics {
  const { pageWidth, pageHeight, pitch } = stripMetrics(scale);
  const slotWidth = Math.max(viewport.clientWidth, pageWidth);
  const slotHeight = layout === "vertical" ? pageHeight : Math.max(viewport.clientHeight, pageHeight);
  return {
    slotWidth,
    slotHeight,
    pitchX: layout === "vertical" ? 0 : slotWidth,
    pitchY: layout === "vertical" ? pitch : 0,
    pageWidth,
    pageHeight,
    cardLeft: Math.max(0, (slotWidth - pageWidth) / 2),
    cardTop: layout === "vertical" ? 0 : Math.max(0, (slotHeight - pageHeight) / 2),
  };
}

/** Everything a zoom anchor has to be resolved against. */
export interface DeskView {
  layout: ReadingLayout;
  scale: number;
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
  pagesCount: number;
}

/** A point on a sheet, in unscaled page coordinates. */
export interface PageAnchor {
  pageIndex: number;
  pageX: number;
  pageY: number;
}

function viewportOf(v: DeskView): Viewport {
  return { clientWidth: v.clientWidth, clientHeight: v.clientHeight };
}

/**
 * The point on the paper under a point in the viewport. The y half of the
 * vertical column is columnPosition's, so a zoom anchored here and a scroll
 * placed by columnScrollTop measure from the same origin.
 */
export function anchorAt(v: DeskView, vx: number, vy: number): PageAnchor {
  const m = deskMetrics(v.layout, v.scale, viewportOf(v));
  const scale = v.scale > 0 ? v.scale : 1;
  if (v.layout === "vertical") {
    const at = columnPosition(v.scrollTop + vy, scale, v.pagesCount);
    return { ...at, pageX: (v.scrollLeft + vx - m.cardLeft) / scale };
  }
  const contentX = v.scrollLeft + vx;
  const pageIndex =
    m.pitchX > 0
      ? Math.min(Math.max(0, v.pagesCount - 1), Math.max(0, Math.floor(contentX / m.pitchX)))
      : 0;
  return {
    pageIndex,
    pageX: (contentX - (pageIndex * m.pitchX + m.cardLeft)) / scale,
    pageY: (v.scrollTop + vy - m.cardTop) / scale,
  };
}

/** The scroll that puts `a` back under (vx, vy), at the view's scale. */
export function scrollForAnchor(
  v: DeskView,
  a: PageAnchor,
  vx: number,
  vy: number,
): { scrollLeft: number; scrollTop: number } {
  const m = deskMetrics(v.layout, v.scale, viewportOf(v));
  const scale = v.scale > 0 ? v.scale : 1;
  if (v.layout === "vertical") {
    return {
      scrollLeft: m.cardLeft + a.pageX * scale - vx,
      scrollTop: columnScrollTop(a.pageIndex, a.pageY, scale) - vy,
    };
  }
  // The flip never pans sideways: its slot is as wide as the viewport or as
  // the sheet, whichever is bigger, so there is no room beside the page and a
  // zoom that moved x would leave the strip between two pages. The page stays
  // where it is and only the height is anchored.
  return {
    scrollLeft: a.pageIndex * m.pitchX,
    scrollTop: m.cardTop + a.pageY * scale - vy,
  };
}

/**
 * Where a paged strip left to itself has to come to rest: on one whole page.
 * The flip has no scroll snapping under it — a mandatory snap fights every
 * scrollLeft the gesture machine writes — so the desk settles the strip once
 * the scrolling stops. Null when it is already resting on a page.
 */
export function settleFlip(scrollLeft: number, pitchX: number, pagesCount: number): number | null {
  if (pitchX <= 0 || pagesCount <= 0) return null;
  const target = flipPosition(scrollLeft, pitchX, pagesCount) * pitchX;
  return Math.abs(target - scrollLeft) < 1 ? null : target;
}
