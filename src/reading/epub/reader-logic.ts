// Everything the EPUB reading pane decides, with no React and no renderer in
// it. The pane is the wiring; this is what the wiring means, and it is here
// because a .ts can be tested and a .tsx cannot.
//
// Two directions of the same map live here. Going in, a position block number
// becomes the CFI the renderer navigates to. Coming out, the renderer says
// where it is with a DOM range, and that becomes a block number again — the
// number the whole app already speaks ([p.N], chapter ranges, the top bar).

import type { ViewState, ViewStats } from "../../platform/app/reader-contract";
import { blockNumberAt, type Pagination } from "./paginate";
import type { DocumentText, TextRun } from "./text";

// ------------------------------------------------------------ type size ----

// An EPUB has no zoom: there is no page to make bigger, only type to set
// larger. The shell's zoom buttons drive these steps, and ViewStats.canZoom*
// is what tells the top bar when a button has run out of room.
//
// The ratios are the ordinary typographic steps a reader expects from a "make
// it bigger" button — about 12% each, small enough that no press feels like a
// jump and large enough that every press is visible.
export const FONT_SIZES = [15, 17, 19, 21, 24, 27, 31] as const;
export const DEFAULT_FONT_STEP = 2;

export function clampFontStep(step: number): number {
  if (!Number.isFinite(step)) return DEFAULT_FONT_STEP;
  return Math.min(FONT_SIZES.length - 1, Math.max(0, Math.trunc(step)));
}

export function fontSizeAt(step: number): number {
  return FONT_SIZES[clampFontStep(step)];
}

export function canGrow(step: number): boolean {
  return clampFontStep(step) < FONT_SIZES.length - 1;
}

export function canShrink(step: number): boolean {
  return clampFontStep(step) > 0;
}

export function canResetType(step: number): boolean {
  return clampFontStep(step) !== DEFAULT_FONT_STEP;
}

// ---------------------------------------------------------------- layout ----

/** The reading layout, in the renderer's word for it. */
export function flowFor(layout: "vertical" | "paged"): "scrolled" | "paginated" {
  return layout === "vertical" ? "scrolled" : "paginated";
}

// --------------------------------------------------------------- position ---

/** The CFI a position block starts at, or null when the block is out of range. */
export function cfiForBlock(pagination: Pagination, pageIndex: number): string | null {
  return pagination.blocks[pageIndex]?.cfi ?? null;
}

/** The printed page number for a block, when the book printed one. */
export function labelForBlock(pagination: Pagination, pageIndex: number): string | null {
  const label = pagination.blocks[pageIndex]?.label;
  return label ? label : null;
}

/**
 * Where to open the book. A saved CFI is the exact place the reader stopped; a
 * saved block number is the coarse one, good to a page or two, and is what a
 * state written before this engine existed carries. Null opens at the start.
 */
export function restoreTarget(pagination: Pagination, state: ViewState | null): string | null {
  if (!state) return null;
  if (typeof state.cfi === "string" && state.cfi !== "") return state.cfi;
  if (typeof state.pageIndex === "number") return cfiForBlock(pagination, state.pageIndex);
  return null;
}

/** Text nodes by identity, so a range's container finds its run in one lookup. */
export function indexRuns(text: DocumentText): Map<Node, TextRun> {
  const map = new Map<Node, TextRun>();
  for (const run of text.runs) map.set(run.node, run);
  return map;
}

/**
 * A point in the live document as an offset into the extracted text — the same
 * offsets the pagination was cut on, because the renderer is showing the same
 * sanitized markup the ingestion read (render-book.ts).
 *
 * A container that is not a text node addresses a place between children, so
 * the element's own start offset is the answer; a node the extraction never
 * saw (the renderer's injected <style>, which lives in <head>) has none, and
 * the caller gets 0 rather than a guess.
 */
export function offsetOfPoint(
  text: DocumentText,
  runs: Map<Node, TextRun>,
  node: Node | null,
  offset: number,
): number {
  if (!node) return 0;
  const run = runs.get(node);
  if (run) return run.start + Math.min(Math.max(0, offset), run.length);
  if (node.nodeType === 1) {
    const el = node as Element;
    const own = text.offsets.get(el);
    if (own !== undefined) return own;
    const child = el.childNodes[Math.min(offset, el.childNodes.length - 1)];
    if (child && child !== node) return offsetOfPoint(text, runs, child, 0);
  }
  const parent = node.parentElement;
  if (parent) {
    const own = text.offsets.get(parent);
    if (own !== undefined) return own;
  }
  return 0;
}

/** The 0-based position block a point in a spine document falls in. */
export function blockIndexAt(pagination: Pagination, spine: number, charOffset: number): number {
  return blockNumberAt(pagination, spine, charOffset) - 1;
}

// ------------------------------------------------------------- the shapes ---

export function statsOf(args: {
  pageIndex: number;
  pagination: Pagination;
  fontStep: number;
  layout: "vertical" | "paged";
}): ViewStats {
  return {
    pageIndex: args.pageIndex,
    pageLabel: labelForBlock(args.pagination, args.pageIndex) ?? String(args.pageIndex + 1),
    pagesCount: args.pagination.blocks.length,
    canZoomIn: canGrow(args.fontStep),
    canZoomOut: canShrink(args.fontStep),
    canZoomReset: canResetType(args.fontStep),
    layout: args.layout,
  };
}

export function viewStateOf(args: {
  pageIndex: number;
  cfi: string | null;
  fontStep: number;
  layout: "vertical" | "paged";
}): ViewState {
  return {
    pageIndex: args.pageIndex,
    // The type size, in the field the PDF side keeps its zoom in. Both are
    // "how big is it", both are per book, and a state that carried two would
    // have to say which one a file written by the other engine meant.
    scale: fontSizeAt(args.fontStep),
    scrollMode: 0,
    layout: args.layout,
    ...(args.cfi ? { cfi: args.cfi } : {}),
  };
}

/** The type size a saved state opens at. */
export function openingFontStep(state: ViewState | null): number {
  const scale = state?.scale;
  if (typeof scale !== "number") return DEFAULT_FONT_STEP;
  const exact = FONT_SIZES.indexOf(scale as (typeof FONT_SIZES)[number]);
  if (exact >= 0) return exact;
  // A number from another engine, or from a step table that has since changed:
  // the nearest step, so the book opens at about the size it was left at.
  let best = DEFAULT_FONT_STEP;
  for (let i = 0; i < FONT_SIZES.length; i++) {
    if (Math.abs(FONT_SIZES[i] - scale) < Math.abs(FONT_SIZES[best] - scale)) best = i;
  }
  return best;
}

// -------------------------------------------------------------- the events --
//
// Nothing in the book's frame dispatches an event (docs/pitfall/244), so every
// gesture is read on the element wrapping it and turned into a page turn here.
// The frame's own scrolling is untouched: a scroll is not a DOM event, and the
// container that scrolls in continuous mode is on this side of the frame.

export type Turn = "prev" | "next" | "none";

/** A tap's zone. The middle third is nothing, so a mis-tap does not turn. */
export function tapZone(
  layout: "vertical" | "paged",
  x: number,
  width: number,
  rtl = false,
): Turn {
  if (layout !== "paged" || width <= 0) return "none";
  const edge = width * 0.28;
  if (x <= edge) return rtl ? "next" : "prev";
  if (x >= width - edge) return rtl ? "prev" : "next";
  return "none";
}

/**
 * Whether the reader takes this touch away from the browser, by preventing the
 * default on its moves.
 *
 * WebKit hands a touch sequence to its own scrolling a few moves in and sends
 * `pointercancel` instead of the rest of it, and the only way to keep the
 * sequence is to claim it before that (docs/pitfall/117). Measured on the iPad:
 * a drag with any vertical component was gone after six pointermoves, which is
 * every selection longer than one line (docs/pitfall/261).
 *
 * Two cases claim it. A selection being dragged out of the text, in either
 * layout: it is a mark being made, never a scroll. And every touch in the paged
 * layout, where nothing scrolls at all — the pane turns the page itself, and a
 * swipe that gets cancelled halfway turns nothing.
 */
export function claimsTouch(layout: "vertical" | "paged", drawing: boolean): boolean {
  return drawing || layout === "paged";
}

// How far a finger must travel across the page before it is a page turn rather
// than a tap, and how much of that travel has to be horizontal. The same shape
// as the reader's other swipe test (engine/gesture/touch-routing.ts): a
// distance floor plus an axis test, so a diagonal drag does neither.
export const SWIPE_MIN = 48;

export function swipeTurn(
  layout: "vertical" | "paged",
  dx: number,
  dy: number,
  rtl = false,
): Turn {
  if (layout !== "paged") return "none";
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return "none";
  // Dragging the page leftwards brings the next one in.
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
//
// A book's own links — a footnote marker, a cross-reference, the note that
// sends you back — are anchors in the frame, and the frame's click listener
// never fires (docs/pitfall/244). So the pane hit-tests a tap against the
// frame's document itself, and this says what the anchor it found means.
//
// The href is read as the book wrote it. foliate rewrites `src`, `link[href]`
// and the rest into blob URLs when it loads a section, but never an `<a>`, so
// what is on the element is the relative path in the archive.

export type BookLink =
  /** A place in this book: a path into the archive, a fragment, or both. */
  | { kind: "internal"; href: string }
  /** The web. It leaves the app, so it goes to the system browser. */
  | { kind: "external"; url: string };

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

/**
 * What following this anchor should do, or null for one that goes nowhere the
 * reader wants to be taken: an empty href, a protocol-relative URL an EPUB has
 * no business carrying, and every scheme that is neither the book nor the web
 * (`javascript:`, `data:`, `mailto:`, a blob left over from a rewrite).
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
 * The strings to look for when the AI cites a passage, most exact first.
 *
 * The quote comes from the extracted text, where every block element ended in a
 * newline that the rendered document does not have; and a model that quotes a
 * long passage is more likely to have dropped a character in the middle of it
 * than at the start. So: the quote as given, the quote with its whitespace
 * collapsed, and a leading run of it long enough to be unique.
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
