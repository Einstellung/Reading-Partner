// Whether the engine's geometry has caught up with the layout it is supposed to
// be in — as a pure predicate over numbers, so the rule can be tested without a
// viewport. Two paths ask: a layout switch, and opening a book whose saved
// layout is paged. Both hand the engine a request and get no completion back.
//
// A layout switch is not one operation the engine completes. The host sets the
// scroll strategy, asks for the zoom and centres the page, and only the first
// two are synchronous:
//
//   - the scroll plugin recomputes its virtual items inside setScrollStrategy,
//     or silently does nothing when the document is not "loaded" at that
//     instant, and never retries (pitfall 42);
//   - the DOM is a React commit behind that, so the element the browser
//     actually scrolls still has the old layout's scrollable extent;
//   - the viewport plugin defers every scroll it is asked for by one more
//     frame, and the browser clamps whatever arrives to the extent that exists
//     at that moment.
//
// Centring against geometry that is still one layout behind lands between two
// pages, and nothing downstream corrects it: a clamped scroll offset is a
// perfectly good scroll offset as far as every plugin is concerned, so no
// event follows and no one recomputes. So the host does not centre on a frame
// count. It centres when this says the geometry it is about to measure is the
// geometry the layout asked for, and it confirms the page arrived.

import { LAYOUT_SETTINGS, type ReadingLayout, type ScrollAxis, type ZoomLock } from "./layout-modes";
import { pageCenterAlign } from "./paged-gesture";

// Sub-pixel slack. Scaled page geometry is fractional and the browser rounds
// scroll offsets to device pixels, so nothing here is ever compared for
// equality.
export const SETTLE_TOLERANCE_PX = 2;

// Slack on a zoom scale. The plugin floors what it computes to three decimals,
// so two agreeing fits differ by at most one unit in the last place; the
// mismatch this catches (a fit computed against a viewport two paddings too
// narrow) is thirty times that.
export const SETTLE_SCALE_TOLERANCE = 0.002;

export interface LayoutGeometry {
  // The first two virtual items' offsets, unscaled. Which coordinate advances
  // between them is the axis the scroll model was actually laid out on — the
  // plugin's own state says which strategy was requested, not which one the
  // items were built with. A single-item document leaves the second null and
  // the axis unknowable, which is fine: there is no strip to get wrong.
  firstItem: { x: number; y: number } | null;
  secondItem: { x: number; y: number } | null;
  // The model's total content size, unscaled.
  contentWidth: number;
  contentHeight: number;
  // The scale the model is rendered at.
  scale: number;
  // The zoom mode in effect, or null when the level is a bare number (a pinch
  // replaced the fit).
  zoomLock: ZoomLock | null;
  // What the browser will actually let the reader scroll: the scroll
  // container's own extents. The only witness that the re-layout reached the
  // element the scroll position is written on.
  domScrollWidth: number;
  domScrollHeight: number;
  // The largest virtual item, unscaled — the box a fit resolves against, by the
  // same rule the zoom plugin uses. Null when the model has no items yet.
  largestItem: { width: number; height: number } | null;
  // The scroll container's visible box, from the element itself.
  domClientWidth: number;
  domClientHeight: number;
  // The same box as the viewport plugin believes it to be. It is the plugin
  // that resolves a fit and an alignX, so its numbers decide where a page
  // lands; the element's decide what the reader sees. While the two disagree,
  // every placement is computed in one frame of reference and clamped in
  // another.
  pluginClientWidth: number;
  pluginClientHeight: number;
  // The viewport's own padding, which a fit subtracts from the visible box.
  viewportGap: number;
}

// The axis the virtual items are laid out on, or null when the document is too
// short to tell.
export function modelAxis(g: Pick<LayoutGeometry, "firstItem" | "secondItem">): ScrollAxis | null {
  const a = g.firstItem;
  const b = g.secondItem;
  if (!a || !b) return null;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx === dy) return null;
  return dx > dy ? "horizontal" : "vertical";
}

// The scaled extent of the content along a layout's scroll axis: how far the
// scroll container has to reach for the whole document to be scrollable.
export function modelExtent(g: LayoutGeometry, axis: ScrollAxis): number {
  return (axis === "horizontal" ? g.contentWidth : g.contentHeight) * g.scale;
}

function domExtent(g: LayoutGeometry, axis: ScrollAxis): number {
  return axis === "horizontal" ? g.domScrollWidth : g.domScrollHeight;
}

// Whether the viewport plugin's measurements are the element's own. They go out
// of date without a word: the plugin's numbers come from a ResizeObserver on
// the scroll container, which watches the content box, while the padding the
// viewport gives itself (its gap, applied one commit after it mounts) only
// changes the client box. The observer never fires for that, so a viewport that
// mounted before its own padding stays two paddings too narrow for the rest of
// the session — and every fit computed from it comes out too small, which on
// screen is a page that does not fill the frame with its neighbour showing at
// the edge.
export function metricsFresh(g: LayoutGeometry): boolean {
  return (
    Math.abs(g.domClientWidth - g.pluginClientWidth) <= SETTLE_TOLERANCE_PX &&
    Math.abs(g.domClientHeight - g.pluginClientHeight) <= SETTLE_TOLERANCE_PX
  );
}

// The scale this layout's zoom lock resolves to on this viewport, as the zoom
// plugin would compute it — the largest item box against the visible box minus
// its padding, floored to three decimals the way the plugin floors it. Null
// when there is nothing to measure against yet.
export function lockedFitScale(g: LayoutGeometry, layout: ReadingLayout): number | null {
  if (!g.largestItem) return null;
  const raw = fitScale(
    LAYOUT_SETTINGS[layout].zoom,
    g.largestItem,
    { clientWidth: g.domClientWidth, clientHeight: g.domClientHeight },
    g.viewportGap,
  );
  if (raw <= 0) return null;
  return Math.floor(raw * 1e3) / 1e3;
}

// The scale in effect is the fit, not merely a fit's name. The lock says which
// fit the layout wants; this says the number under it was computed against the
// viewport the reader is actually looking at. The plugin clamps a fit to its own
// zoom limits, which this does not know about, so a document too large to fit
// within them reads as never settled — bounded by the caller's frame budget, so
// it costs a wait and not a hang.
export function scaleIsFit(g: LayoutGeometry, layout: ReadingLayout): boolean {
  const want = lockedFitScale(g, layout);
  if (want === null) return true;
  return Math.abs(g.scale - want) <= SETTLE_SCALE_TOLERANCE;
}

// Every part of the layout has landed: the plugin is measuring the viewport the
// reader has, the zoom lock is the layout's and resolved against that viewport,
// the virtual items were rebuilt on the layout's axis, and the DOM has grown to
// hold them at the current scale. Anything short of all of it means a scroll
// issued now measures one layout and lands in another.
export function geometrySettled(g: LayoutGeometry, layout: ReadingLayout): boolean {
  return settleGap(g, layout) === null;
}

// Which part is still outstanding, for the host to re-assert exactly that one.
// "metrics" means the plugin is working from a viewport that is not the one on
// screen; "zoom" means the zoom request never took, or took against those stale
// metrics; "model" means the scroll plugin dropped its layout refresh; "dom"
// means everything took and the browser has not laid the result out yet, which
// no re-assert can hurry. In that order: a fit resolved from the wrong viewport
// cannot be repaired by asking for it again.
export type SettleGap = "metrics" | "zoom" | "model" | "dom" | null;

export function settleGap(g: LayoutGeometry, layout: ReadingLayout): SettleGap {
  const want = LAYOUT_SETTINGS[layout];
  if (!metricsFresh(g)) return "metrics";
  if (g.zoomLock !== want.zoom || !scaleIsFit(g, layout)) return "zoom";
  const axis = modelAxis(g);
  if (axis !== null && axis !== want.axis) return "model";
  if (domExtent(g, want.axis) + SETTLE_TOLERANCE_PX < modelExtent(g, want.axis)) return "dom";
  return null;
}

export interface CenterTarget {
  // The page's virtual item, unscaled.
  pageX: number;
  pageWidth: number;
  scale: number;
  // The viewport plugin's own padding, which its scroll positions include.
  viewportGap: number;
  clientWidth: number;
  // scrollWidth - clientWidth: past this the browser clamps, so the target has
  // to be clamped the same way or the last page never counts as arrived.
  maxScrollX: number;
}

// Where the scroll container's left edge has to sit for one whole page to be
// centred — the plugin's own page position plus the host's alignX (pitfall 40),
// clamped the way the browser clamps it.
export function centeredScrollX(t: CenterTarget): number {
  const align = pageCenterAlign(t.pageWidth * t.scale, t.clientWidth);
  const x = t.pageX * t.scale + t.viewportGap - t.clientWidth * (align / 100);
  return Math.min(Math.max(x, 0), Math.max(0, t.maxScrollX));
}

export interface TopTarget {
  // The page's virtual item, unscaled.
  pageY: number;
  scale: number;
  // The viewport plugin's own padding, which its scroll positions include.
  viewportGap: number;
  // scrollHeight - clientHeight: the browser clamps past this, so the last
  // page's target has to be clamped the same way or it never counts as arrived.
  maxScrollY: number;
}

// Where the scroll container's top edge has to sit for a page to start at the
// top of the viewport. Vertical's placement, and deliberately not centring: the
// column carries on below the page, and a reader arriving from paged mode wants
// to read that page from its first line, not from its middle.
export function pageTopScrollY(t: TopTarget): number {
  return Math.min(Math.max(t.pageY * t.scale + t.viewportGap, 0), Math.max(0, t.maxScrollY));
}

// The page is where the placement asked for it. Compared with slack, never for
// equality: the browser snaps scroll offsets to device pixels.
export function landedAt(actual: number, want: number, tolerance = SETTLE_TOLERANCE_PX): boolean {
  return Math.abs(actual - want) <= tolerance;
}

// The zoom scale a fit resolves to, by the same rule the zoom plugin uses: the
// largest page box in the document against the viewport minus its padding.
// Worth having as a function because the two fits coincide more often than the
// switch's original one-frame re-assert assumed — on a portrait screen holding
// a portrait page they are the same number, so the zoom request that was meant
// to force a re-layout resolves to the scale that is already in effect.
export function fitScale(
  lock: ZoomLock,
  page: { width: number; height: number },
  viewport: { clientWidth: number; clientHeight: number },
  viewportGap: number,
): number {
  const availableWidth = viewport.clientWidth - 2 * viewportGap;
  const availableHeight = viewport.clientHeight - 2 * viewportGap;
  if (availableWidth <= 0 || availableHeight <= 0 || page.width <= 0 || page.height <= 0) return 0;
  const byWidth = availableWidth / page.width;
  if (lock === "fit-width") return byWidth;
  return Math.min(byWidth, availableHeight / page.height);
}

// Whether the two fits resolve to the same scale on this screen — the case
// where switching layout changes no number the zoom plugin can notice.
export function fitsCoincide(
  page: { width: number; height: number },
  viewport: { clientWidth: number; clientHeight: number },
  viewportGap: number,
): boolean {
  return (
    fitScale("fit-width", page, viewport, viewportGap) ===
    fitScale("fit-page", page, viewport, viewportGap)
  );
}
