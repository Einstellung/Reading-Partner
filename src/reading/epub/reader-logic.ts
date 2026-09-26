// Everything the EPUB reading pane decides, with no React and no DOM in it.
// The pane is the wiring; this is what the wiring means, and it is here
// because a .ts can be tested and a .tsx cannot.
//
// The vocabulary is the PDF side's (docs/64): pages on a desk, a zoom that
// scales the sheet, a vertical column or a paged flip. The map between a CFI
// and a page number is the pagination table (paginate.ts); both directions of
// it are crossed here.

import type { ViewState, ViewStats } from "../../platform/app/reader-contract";
import type { ReadingLayout } from "../engine/layout-modes";
import { compareLocal, parseCfiStart } from "./file/cfi";
import { atLockedZoom, canZoomIn, canZoomOut, columnScrollTop, type Zoom } from "./page-geometry";
import { blockNumberAt, type Pagination } from "./paginate";

export { indexRuns, offsetOfPoint } from "./file/text";

// --------------------------------------------------------------- position ---

/** The CFI a page starts at, or null when the page is out of range. */
export function cfiForBlock(pagination: Pagination, pageIndex: number): string | null {
  return pagination.blocks[pageIndex]?.cfi ?? null;
}

/** The printed page number for a page, when the book printed one. */
export function labelForBlock(pagination: Pagination, pageIndex: number): string | null {
  const label = pagination.blocks[pageIndex]?.label;
  return label ? label : null;
}

/** What the pagination table says about a page, or undefined out of range. */
export function blockInfo(
  pagination: Pagination,
  pageIndex: number,
): { spine: number; charOffset: number; label: string | null } | undefined {
  const block = pagination.blocks[pageIndex];
  return block ? { spine: block.spine, charOffset: block.charOffset, label: block.label ?? null } : undefined;
}

/** The first page of every spine document the table has, by spine index. */
export function spineStartsOf(pagination: Pagination): Map<number, number> {
  const starts = new Map<number, number>();
  for (let i = 0; i < pagination.blocks.length; i++) {
    const s = pagination.blocks[i].spine;
    if (!starts.has(s)) starts.set(s, i);
  }
  return starts;
}

/** The 0-based page a point in a spine document falls in. */
export function blockIndexAt(pagination: Pagination, spine: number, charOffset: number): number {
  return blockNumberAt(pagination, spine, charOffset) - 1;
}

/**
 * The page a CFI falls in: the last page of that spine document whose start
 * is not after it. Null for a CFI that names no page — a spine index the
 * table does not have, or a string that is not a CFI.
 */
export function pageIndexOfCfi(pagination: Pagination, cfi: string): number | null {
  const target = parseCfiStart(cfi);
  if (!target) return null;
  const { blocks } = pagination;
  let found: number | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.spine < target.spineIndex) continue;
    if (b.spine > target.spineIndex) break;
    const own = parseCfiStart(b.cfi);
    if (!own) continue;
    if (compareLocal(own, target) <= 0) found = i;
    else break;
  }
  return found;
}

export interface RestoreTarget {
  pageIndex: number;
  pageX: number;
  pageY: number;
}

/**
 * Where to open the book. A saved CFI names the exact page it was on when the
 * table was the one in force; a saved page number is what a state from
 * another engine carries. Null opens at the start.
 */
export function restoreTarget(pagination: Pagination, state: ViewState | null): RestoreTarget {
  const count = pagination.blocks.length;
  const clamp = (i: number) => Math.min(Math.max(0, Math.trunc(i)), Math.max(0, count - 1));
  if (!state) return { pageIndex: 0, pageX: 0, pageY: 0 };
  const pageX = typeof state.pageX === "number" && Number.isFinite(state.pageX) ? state.pageX : 0;
  const pageY = typeof state.pageY === "number" && Number.isFinite(state.pageY) ? state.pageY : 0;
  if (typeof state.cfi === "string" && state.cfi !== "") {
    const byCfi = pageIndexOfCfi(pagination, state.cfi);
    if (byCfi !== null) {
      // The in-page offset belongs to the page it was saved with; a CFI that
      // names another page (the table was recut) starts that page at its top.
      const same = typeof state.pageIndex === "number" && clamp(state.pageIndex) === byCfi;
      return { pageIndex: byCfi, pageX: same ? pageX : 0, pageY: same ? pageY : 0 };
    }
  }
  if (typeof state.pageIndex === "number") return { pageIndex: clamp(state.pageIndex), pageX, pageY };
  return { pageIndex: 0, pageX: 0, pageY: 0 };
}

export interface PageScroll {
  /** The offset to write on this axis, or null when the axis is the reader's to pan. */
  scrollLeft: number | null;
  scrollTop: number | null;
}

/**
 * Where the strip has to sit to show a page: the column places the sheet down
 * the y axis and leaves x to a zoomed-in reader's pan, the flip places it
 * along x and has no vertical position of its own (readPosition reports
 * pageY 0 there).
 *
 * The axis a layout owns is always written, even when the answer is 0: a
 * WKWebView that has just had its content shortened keeps reporting the old
 * offset on an axis nobody wrote, and the strip then sits off screen
 * (docs/pitfall/366).
 */
export function pageScroll(
  layout: ReadingLayout,
  index: number,
  y: number,
  scale: number,
  pitchX: number,
): PageScroll {
  if (layout === "vertical") {
    return { scrollLeft: null, scrollTop: columnScrollTop(index, y, scale) };
  }
  return { scrollLeft: index * pitchX, scrollTop: 0 };
}

// ------------------------------------------------------------- the shapes ---

export function statsOf(args: {
  pageIndex: number;
  pagination: Pagination;
  layout: ReadingLayout;
  zoom: Zoom;
  scale: number;
}): ViewStats {
  return {
    pageIndex: args.pageIndex,
    pageLabel: labelForBlock(args.pagination, args.pageIndex) ?? String(args.pageIndex + 1),
    printedLabel: labelForBlock(args.pagination, args.pageIndex),
    pagesCount: args.pagination.blocks.length,
    canZoomIn: canZoomIn(args.scale),
    canZoomOut: canZoomOut(args.scale),
    canZoomReset: !atLockedZoom(args.zoom, args.layout),
    layout: args.layout,
  };
}

export function viewStateOf(args: {
  pageIndex: number;
  cfi: string | null;
  scale: number;
  layout: ReadingLayout;
  pageX?: number;
  pageY?: number;
}): ViewState {
  return {
    pageIndex: args.pageIndex,
    scale: args.scale,
    scrollMode: 0,
    layout: args.layout,
    ...(typeof args.pageX === "number" ? { pageX: args.pageX } : {}),
    ...(typeof args.pageY === "number" ? { pageY: args.pageY } : {}),
    ...(args.cfi ? { cfi: args.cfi } : {}),
  };
}

// -------------------------------------------------------------- the events --

export type Turn = "prev" | "next" | "none";

/** A tap's zone. The middle third is nothing, so a mis-tap does not turn. */
export function tapZone(layout: ReadingLayout, x: number, width: number, rtl = false): Turn {
  if (layout !== "paged" || width <= 0) return "none";
  const edge = width * 0.28;
  if (x <= edge) return rtl ? "next" : "prev";
  if (x >= width - edge) return rtl ? "prev" : "next";
  return "none";
}

/**
 * Whether the reader takes this touch away from the browser, by preventing the
 * default on its moves (docs/pitfall/117, 261): a mark being dragged in either
 * layout, and every touch in the paged flip, where the pane turns the page.
 */
export function claimsTouch(layout: ReadingLayout, drawing: boolean): boolean {
  return drawing || layout === "paged";
}

// How far a finger must travel across the page before it is a page turn rather
// than a tap, and how much of that travel has to be horizontal.
export const SWIPE_MIN = 48;

export function swipeTurn(layout: ReadingLayout, dx: number, dy: number, rtl = false): Turn {
  if (layout !== "paged") return "none";
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return "none";
  const forward = dx < 0;
  return (forward ? !rtl : rtl) ? "next" : "prev";
}

/** Arrow keys turn the page in both layouts; space and Page keys with them. */
export function keyTurn(key: string, rtl = false): Turn {
  switch (key) {
    case "ArrowRight":
    case "PageDown":
      return rtl ? "prev" : "next";
    case "ArrowLeft":
    case "PageUp":
      return rtl ? "next" : "prev";
    default:
      return "none";
  }
}

// --------------------------------------------------------------- the links --

export type BookLink =
  /** A place in this book: a path into the archive, a fragment, or both. */
  | { kind: "internal"; href: string }
  /** The web. It leaves the app, so it goes to the system browser. */
  | { kind: "external"; url: string };

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

/**
 * What following this anchor should do, or null for one that goes nowhere the
 * reader wants to be taken: an empty href, a protocol-relative URL, and every
 * scheme that is neither the book nor the web.
 */
export function bookLinkTarget(raw: string | null | undefined): BookLink | null {
  const href = raw?.trim();
  if (!href) return null;
  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return { kind: "external", url: href };
  if (scheme) return null;
  if (href.startsWith("//")) return null;
  return { kind: "internal", href };
}

// --------------------------------------------------------------- the quote --

/**
 * The strings to look for when the AI cites a passage, most exact first: the
 * quote as given, with its whitespace collapsed, and a leading run of it long
 * enough to be unique.
 */
export function quoteQueries(searchText: string): string[] {
  const raw = searchText.trim();
  if (raw === "") return [];
  const out = [raw];
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed !== raw) out.push(collapsed);
  const head = collapsed.slice(0, 40).trim();
  if (head.length >= 12 && head !== collapsed) out.push(head);
  return out;
}

/**
 * Where a cited quote sits in a document's extracted text, looking from the
 * page it was cited on first and then from the start. Null when no query hits.
 */
export function findQuoteAt(text: string, searchText: string, from: number): { start: number; end: number } | null {
  for (const query of quoteQueries(searchText)) {
    const at = text.indexOf(query, from);
    const hit = at >= 0 ? at : text.indexOf(query);
    if (hit >= 0) return { start: hit, end: hit + query.length };
  }
  const collapsed = searchText.replace(/\s+/g, " ").trim();
  if (collapsed.length >= 12) {
    // The rendered text has line breaks where the quote has spaces: match the
    // words, not the whitespace between them.
    const pattern = collapsed
      .split(" ")
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const re = new RegExp(pattern);
    const tail = re.exec(text.slice(from));
    if (tail) return { start: from + tail.index, end: from + tail.index + tail[0].length };
    const head = re.exec(text);
    if (head) return { start: head.index, end: head.index + head[0].length };
  }
  return null;
}

/** Where a cited quote is: its page by the table, and its span in that spine document's text. */
export interface QuoteSpot {
  pageIndex: number;
  spine: number;
  start: number;
  end: number;
}

/**
 * Find a quote the AI cited on a page. The search starts at the page's first
 * character in its spine document and falls back to the whole document; the
 * page handed back is the one the words are on by the table, which may be a
 * neighbour of the cited one. Null when the page is out of range, its document
 * has no text, or the words are not in it.
 */
export function locateQuote(
  pagination: Pagination,
  textOf: (spine: number) => string | undefined,
  pageIndex: number,
  searchText: string,
): QuoteSpot | null {
  const block = pagination.blocks[pageIndex];
  if (!block) return null;
  const text = textOf(block.spine);
  if (text === undefined) return null;
  const span = findQuoteAt(text, searchText, block.charOffset);
  if (!span) return null;
  return { pageIndex: blockIndexAt(pagination, block.spine, span.start), spine: block.spine, ...span };
}
