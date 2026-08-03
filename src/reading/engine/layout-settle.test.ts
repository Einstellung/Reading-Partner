import { expect, test } from "bun:test";
import {
  centeredScrollX,
  fitScale,
  fitsCoincide,
  geometrySettled,
  landedAt,
  lockedFitScale,
  markPlacement,
  type MarkPlacement,
  metricsFresh,
  modelAxis,
  pageTopScrollY,
  scaleIsFit,
  settleGap,
  SETTLE_SCALE_TOLERANCE,
  SETTLE_TOLERANCE_PX,
  type LayoutGeometry,
} from "./layout-settle";
import { PAGE_FRAME } from "./page-frame";

// A 14-page letter-size document (612x792) in a portrait iPad viewport, at the
// numbers measured in the browser with the frame the reader ships (page-frame.ts):
// no viewport gap, so fit resolves against the whole 834 and the sheet reaches
// both edges — 834/612 floored to 1.362.
const PAGE = { width: 612, height: 792 };
const IPAD_PORTRAIT = { clientWidth: 834, clientHeight: 1194 };
const GAP = PAGE_FRAME.viewportGap;
const PAGE_GAP = PAGE_FRAME.pageGap;
const SCALE = 1.362;
const PAGES = 14;
// The gap the viewport plugin defaults to, kept as a number the tests can name.
// The reader does not use it, but the arithmetic it drives is still the plugin's
// and still what a stale measurement is measured against.
const PADDED_GAP = 10;

const columnHeight = PAGES * PAGE.height + (PAGES - 1) * PAGE_GAP;
const stripWidth = PAGES * PAGE.width + (PAGES - 1) * PAGE_GAP;

// The viewport as both the element and the plugin see it while nothing is
// stale. Every page is the same size in this document, so the largest item is
// the page.
const measured = {
  largestItem: PAGE,
  domClientWidth: IPAD_PORTRAIT.clientWidth,
  domClientHeight: IPAD_PORTRAIT.clientHeight,
  pluginClientWidth: IPAD_PORTRAIT.clientWidth,
  pluginClientHeight: IPAD_PORTRAIT.clientHeight,
  viewportGap: GAP,
};

// What the host reads while resting in each layout.
const verticalGeometry = (): LayoutGeometry => ({
  firstItem: { x: 0, y: 0 },
  secondItem: { x: 0, y: PAGE.height + PAGE_GAP },
  contentWidth: PAGE.width,
  contentHeight: columnHeight,
  scale: SCALE,
  zoomLock: "fit-width",
  domScrollWidth: IPAD_PORTRAIT.clientWidth,
  domScrollHeight: columnHeight * SCALE + 2 * GAP,
  ...measured,
});

const pagedGeometry = (): LayoutGeometry => ({
  firstItem: { x: 0, y: 0 },
  secondItem: { x: PAGE.width + PAGE_GAP, y: 0 },
  contentWidth: stripWidth,
  contentHeight: PAGE.height,
  scale: SCALE,
  zoomLock: "fit-page",
  domScrollWidth: stripWidth * SCALE + 2 * GAP,
  domScrollHeight: IPAD_PORTRAIT.clientHeight,
  ...measured,
});

test("a layout at rest is settled for itself and never for the other one", () => {
  expect(geometrySettled(verticalGeometry(), "vertical")).toBe(true);
  expect(geometrySettled(verticalGeometry(), "paged")).toBe(false);
  expect(geometrySettled(pagedGeometry(), "paged")).toBe(true);
  expect(geometrySettled(pagedGeometry(), "vertical")).toBe(false);
});

test("the model is rebuilt before the DOM is, and that frame is not settled", () => {
  // The frame the old code centred on: the scroll plugin has rebuilt its
  // virtual items as a strip and the zoom lock is fit-page, but the element the
  // browser scrolls still has the vertical column's extents, so a scroll issued
  // now is clamped to nothing and lands on page 1.
  const midSwitch: LayoutGeometry = {
    ...pagedGeometry(),
    domScrollWidth: IPAD_PORTRAIT.clientWidth,
    domScrollHeight: columnHeight * SCALE + 2 * GAP,
  };
  expect(geometrySettled(midSwitch, "paged")).toBe(false);
  expect(settleGap(midSwitch, "paged")).toBe("dom");
});

test("a dropped layout refresh is visible in the items, not in the request", () => {
  // setScrollStrategy returns without a word when the document is not "loaded"
  // at that instant, and re-issuing the same strategy is a no-op inside the
  // plugin. The only witness is the items themselves still running down a
  // column while paged mode asks for a strip.
  const dropped: LayoutGeometry = { ...verticalGeometry(), zoomLock: "fit-page" };
  expect(settleGap(dropped, "paged")).toBe("model");
  expect(geometrySettled(dropped, "paged")).toBe(false);
});

test("a zoom request that never took is reported as the zoom gap", () => {
  const noZoom: LayoutGeometry = { ...pagedGeometry(), zoomLock: "fit-width" };
  expect(settleGap(noZoom, "paged")).toBe("zoom");
  // A pinch leaves a bare number instead of a fit, which is the same gap.
  expect(settleGap({ ...pagedGeometry(), zoomLock: null }, "paged")).toBe("zoom");
});

test("a settled geometry has no gap left", () => {
  expect(settleGap(pagedGeometry(), "paged")).toBe(null);
  expect(settleGap(verticalGeometry(), "vertical")).toBe(null);
});

test("a viewport the plugin has not measured since it padded itself is not settled", () => {
  // Measured on the open path, back when the viewport had a gap: it applies that
  // gap as padding one commit after it mounts, which changes the client box and
  // not the content box, so the ResizeObserver behind the plugin's metrics never
  // fires. The plugin then holds a viewport 2*gap narrower than the one on
  // screen for the rest of the session. The reader's gap is zero now, so this
  // particular staleness cannot arise — a rotation's can, and it is the same
  // disagreement.
  const stale: LayoutGeometry = {
    ...pagedGeometry(),
    viewportGap: PADDED_GAP,
    pluginClientWidth: IPAD_PORTRAIT.clientWidth - 2 * PADDED_GAP,
    pluginClientHeight: IPAD_PORTRAIT.clientHeight - 2 * PADDED_GAP,
  };
  expect(metricsFresh(stale)).toBe(false);
  expect(geometrySettled(stale, "paged")).toBe(false);
  // Repaired first, and on its own: a fit resolved against the wrong viewport
  // comes back wrong however many times it is asked for.
  expect(settleGap(stale, "paged")).toBe("metrics");
});

test("stale metrics are still stale when the zoom is wrong too", () => {
  const stale: LayoutGeometry = {
    ...pagedGeometry(),
    scale: 1.3,
    zoomLock: "fit-width",
    pluginClientWidth: IPAD_PORTRAIT.clientWidth - 2 * PADDED_GAP,
    pluginClientHeight: IPAD_PORTRAIT.clientHeight,
  };
  expect(settleGap(stale, "paged")).toBe("metrics");
});

test("a fit that is the layout's in name but not in number is a zoom gap", () => {
  // The failure the open path lands in: fit-page computed while the viewport was
  // 2*gap narrower resolves to 1.3, the lock still says fit-page, and nothing
  // downstream disagrees — on screen the page stops short of the frame and its
  // neighbour shows at the edge.
  const short: LayoutGeometry = { ...pagedGeometry(), scale: 1.3 };
  expect(scaleIsFit(short, "paged")).toBe(false);
  expect(settleGap(short, "paged")).toBe("zoom");
  expect(geometrySettled(short, "paged")).toBe(false);
});

test("the expected fit is floored the way the zoom plugin floors it", () => {
  // The plugin keeps three decimals (Math.floor(x * 1e3) / 1e3), so a host that
  // compares against the exact quotient never agrees with it.
  expect(fitScale("fit-width", PAGE, IPAD_PORTRAIT, GAP)).toBeCloseTo(1.36275, 5);
  expect(lockedFitScale(pagedGeometry(), "paged")).toBe(1.362);
  // And the slack covers that last place without covering a stale fit.
  expect(scaleIsFit({ ...pagedGeometry(), scale: SCALE + SETTLE_SCALE_TOLERANCE / 2 }, "paged")).toBe(true);
  expect(scaleIsFit({ ...pagedGeometry(), scale: SCALE + 0.01 }, "paged")).toBe(false);
});

test("a model with no items yet has no fit to check against", () => {
  // Nothing to measure means nothing to disagree with: the other conditions
  // carry the settle, rather than it waiting for a number that cannot exist.
  const empty: LayoutGeometry = { ...pagedGeometry(), largestItem: null };
  expect(lockedFitScale(empty, "paged")).toBe(null);
  expect(scaleIsFit(empty, "paged")).toBe(true);
  // Same for a viewport with no room in it yet.
  const unsized: LayoutGeometry = { ...pagedGeometry(), domClientWidth: 0, pluginClientWidth: 0 };
  expect(lockedFitScale(unsized, "paged")).toBe(null);
  expect(scaleIsFit(unsized, "paged")).toBe(true);
});

test("each layout is checked against its own fit", () => {
  // On a viewport where the two fits differ, vertical resting at fit-width is
  // settled and the same numbers read as paged are not.
  const wide = { clientWidth: 900, clientHeight: 1000 };
  const onWide = {
    largestItem: PAGE,
    domClientWidth: wide.clientWidth,
    domClientHeight: wide.clientHeight,
    pluginClientWidth: wide.clientWidth,
    pluginClientHeight: wide.clientHeight,
    viewportGap: GAP,
  };
  const fitWidth = lockedFitScale({ ...verticalGeometry(), ...onWide }, "vertical")!;
  const fitPage = lockedFitScale({ ...pagedGeometry(), ...onWide }, "paged")!;
  expect(fitWidth).toBe(1.47);
  expect(fitPage).toBe(1.262);
  const vertical: LayoutGeometry = {
    ...verticalGeometry(),
    ...onWide,
    scale: fitWidth,
    domScrollHeight: columnHeight * fitWidth + 2 * GAP,
  };
  expect(settleGap(vertical, "vertical")).toBe(null);
  expect(scaleIsFit(vertical, "paged")).toBe(false);
});

test("the axis comes from the items, and a one-page document has none", () => {
  expect(modelAxis(pagedGeometry())).toBe("horizontal");
  expect(modelAxis(verticalGeometry())).toBe("vertical");
  expect(modelAxis({ firstItem: { x: 0, y: 0 }, secondItem: null })).toBe(null);
  expect(modelAxis({ firstItem: null, secondItem: null })).toBe(null);
});

test("a single-page document settles on the zoom and the DOM alone", () => {
  // No second item means no axis to check; a document that fits on one screen
  // has no strip to lay out wrong, and waiting for one would hang the switch.
  const one: LayoutGeometry = {
    firstItem: { x: 0, y: 0 },
    secondItem: null,
    contentWidth: PAGE.width,
    contentHeight: PAGE.height,
    scale: SCALE,
    zoomLock: "fit-page",
    domScrollWidth: IPAD_PORTRAIT.clientWidth,
    domScrollHeight: IPAD_PORTRAIT.clientHeight,
    ...measured,
  };
  expect(geometrySettled(one, "paged")).toBe(true);
  expect(geometrySettled({ ...one, zoomLock: "fit-width" }, "paged")).toBe(false);
});

test("a DOM within sub-pixel slack of the model counts as caught up", () => {
  const g = pagedGeometry();
  const short = { ...g, domScrollWidth: g.contentWidth * g.scale - SETTLE_TOLERANCE_PX };
  expect(geometrySettled(short, "paged")).toBe(true);
  const shorter = { ...g, domScrollWidth: g.contentWidth * g.scale - SETTLE_TOLERANCE_PX - 1 };
  expect(geometrySettled(shorter, "paged")).toBe(false);
});

test("centring puts a page narrower than the viewport in the middle", () => {
  // Page 8 of the strip, at the numbers the browser reported.
  const pageX = 7 * (PAGE.width + PAGE_GAP);
  const x = centeredScrollX({
    pageX,
    pageWidth: PAGE.width,
    scale: SCALE,
    viewportGap: GAP,
    clientWidth: IPAD_PORTRAIT.clientWidth,
    maxScrollX: Number.POSITIVE_INFINITY,
  });
  const left = pageX * SCALE + GAP - x;
  const right = IPAD_PORTRAIT.clientWidth - left - PAGE.width * SCALE;
  expect(Math.abs(left - right)).toBeLessThanOrEqual(0.001);
});

test("a page wider than the viewport is left-aligned, not pulled off-screen", () => {
  const x = centeredScrollX({
    pageX: 1000,
    pageWidth: 1000,
    scale: 2,
    viewportGap: GAP,
    clientWidth: 834,
    maxScrollX: Number.POSITIVE_INFINITY,
  });
  expect(x).toBe(1000 * 2 + GAP);
});

test("the target is clamped the way the browser clamps it", () => {
  // The last page of the strip: past the end the browser stops, so a target
  // past the end has to stop there too or the page never counts as arrived.
  const maxScrollX = 500;
  const x = centeredScrollX({
    pageX: 100000,
    pageWidth: PAGE.width,
    scale: SCALE,
    viewportGap: GAP,
    clientWidth: IPAD_PORTRAIT.clientWidth,
    maxScrollX,
  });
  expect(x).toBe(maxScrollX);
  // And never negative: the first page of a strip narrower than the viewport.
  expect(
    centeredScrollX({
      pageX: 0,
      pageWidth: 100,
      scale: 1,
      viewportGap: 0,
      clientWidth: 834,
      maxScrollX,
    }),
  ).toBe(0);
});

test("vertical puts the page top at the top of the viewport, not in the middle", () => {
  // Page 8 of the column, at the numbers the browser reported: the switch out of
  // paged mode lands here and the reader reads on from the page's first line.
  const pageY = 7 * (PAGE.height + PAGE_GAP);
  expect(
    pageTopScrollY({ pageY, scale: SCALE, viewportGap: GAP, maxScrollY: Number.POSITIVE_INFINITY }),
  ).toBeCloseTo(pageY * SCALE + GAP, 6);
  // The first page sits at the very top, and no page is ever placed above it.
  expect(
    pageTopScrollY({ pageY: 0, scale: SCALE, viewportGap: 0, maxScrollY: 10000 }),
  ).toBe(0);
});

test("the last page's top is clamped the way the browser clamps it", () => {
  // Past the end of the column the browser stops, so the target has to stop
  // there too or the last page never counts as arrived.
  const maxScrollY = 500;
  expect(
    pageTopScrollY({ pageY: 100000, scale: SCALE, viewportGap: GAP, maxScrollY }),
  ).toBe(maxScrollY);
});

test("landing is measured with slack, never for equality", () => {
  expect(landedAt(5791, 5791.4)).toBe(true);
  expect(landedAt(5791, 5793)).toBe(true);
  expect(landedAt(5791, 5794)).toBe(false);
  // Half a page off — the reported symptom, two pages meeting on screen.
  expect(landedAt(4904, 5324)).toBe(false);
});

test("fit-page and fit-width are the same number on a portrait screen", () => {
  // Measured: 834x1194 viewport, 612x792 page, both fits resolve to 1.3627. The
  // switch's zoom request therefore changes no scale, fires no scale change,
  // and recomputes nothing — which is why the switch cannot lean on it.
  expect(fitsCoincide(PAGE, IPAD_PORTRAIT, GAP)).toBe(true);
  expect(fitScale("fit-width", PAGE, IPAD_PORTRAIT, GAP)).toBeCloseTo(1.3627, 4);
  expect(fitScale("fit-page", PAGE, IPAD_PORTRAIT, GAP)).toBeCloseTo(1.3627, 4);
});

test("on a shorter viewport the two fits differ", () => {
  // Measured: 900x1000, same page. fit-width 1.4706, fit-page 1.2626.
  const wide = { clientWidth: 900, clientHeight: 1000 };
  expect(fitsCoincide(PAGE, wide, GAP)).toBe(false);
  expect(fitScale("fit-width", PAGE, wide, GAP)).toBeCloseTo(1.4706, 4);
  expect(fitScale("fit-page", PAGE, wide, GAP)).toBeCloseTo(1.2626, 4);
});

test("a viewport gap costs the fit twice over, which is why the reader has none", () => {
  // The plugin resolves every fit against clientWidth - 2*gap, so the padding
  // is not only a margin: it is a page that stops short of the screen it was
  // asked to fill. On the paged strip that is the neighbour showing at the edge.
  const withGap = fitScale("fit-width", PAGE, IPAD_PORTRAIT, PADDED_GAP);
  const withNone = fitScale("fit-width", PAGE, IPAD_PORTRAIT, 0);
  expect(PAGE.width * withGap).toBeCloseTo(IPAD_PORTRAIT.clientWidth - 2 * PADDED_GAP, 6);
  expect(PAGE.width * withNone).toBeCloseTo(IPAD_PORTRAIT.clientWidth, 6);
});

test("a viewport with no room yet resolves to no scale at all", () => {
  expect(fitScale("fit-page", PAGE, { clientWidth: 0, clientHeight: 0 }, GAP)).toBe(0);
  expect(fitScale("fit-width", { width: 0, height: 0 }, IPAD_PORTRAIT, GAP)).toBe(0);
});

// --- jumping to a mark inside a page ---------------------------------------
// At the numbers measured on the iPad that reported this: a 318-page book in
// paged mode, a viewport 820 wide, the page rendered 819.5 wide, and a
// highlight starting 45pt in from the page's left edge.
const DEVICE_WIDTH = 820;
const DEVICE_PAGE_WIDTH = 819.5;
const DEVICE_SCALE = DEVICE_PAGE_WIDTH / PAGE.width;
const MARK_X = 45;
const MARK_Y = 236;

// The two plugins' arithmetic end to end, as the scroll offset a placement
// produces: the scroll plugin adds the in-page coordinate to the page's scaled
// left edge and its own gap, and the viewport plugin subtracts the alignment.
const scrollLeftOf = (
  p: Pick<MarkPlacement, "pageCoordinates" | "alignX">,
  pageX: number,
  scale: number,
  clientWidth: number,
): number => pageX * scale + p.pageCoordinates.x * scale + GAP - clientWidth * (p.alignX / 100);

// Where the browser stops: the scroll offset a placement actually produces.
const clampScroll = (x: number, maxScrollX: number) => Math.min(Math.max(x, 0), maxScrollX);

const deviceMark = (layout: "paged" | "vertical", markX = MARK_X, pageWidthPx = DEVICE_PAGE_WIDTH) =>
  markPlacement(layout, {
    markX,
    markY: MARK_Y,
    alignY: 20,
    pageWidthPx,
    clientWidth: DEVICE_WIDTH,
  });

test("a mark jump that fits the page on screen sends only the mark's y", () => {
  for (const layout of ["paged", "vertical"] as const) {
    const p = deviceMark(layout);
    // The x is what the plugin would read as a horizontal scroll offset.
    expect([layout, p.pageCoordinates.x]).toEqual([layout, 0]);
    expect([layout, p.pageCoordinates.y]).toEqual([layout, MARK_Y]);
    expect([layout, p.alignY]).toEqual([layout, 20]);
  }
});

test("the strip puts the page a mark is on exactly where a page turn puts it", () => {
  // Page 194 of the strip, far enough in that nothing here is near a clamp.
  const pageX = 193 * (PAGE.width + PAGE_GAP);
  const want = centeredScrollX({
    pageX,
    pageWidth: PAGE.width,
    scale: DEVICE_SCALE,
    viewportGap: GAP,
    clientWidth: DEVICE_WIDTH,
    maxScrollX: Number.POSITIVE_INFINITY,
  });
  expect(scrollLeftOf(deviceMark("paged"), pageX, DEVICE_SCALE, DEVICE_WIDTH)).toBeCloseTo(want, 6);
});

test("the mark's own x used to drag the page off the strip", () => {
  const pageX = 193 * (PAGE.width + PAGE_GAP);
  const pageLeftPx = pageX * DEVICE_SCALE;
  // Where the page's left edge lands, measured from the viewport's: the page is
  // half a pixel narrower than the screen, so centred is a hair inside it.
  const placed = scrollLeftOf(deviceMark("paged"), pageX, DEVICE_SCALE, DEVICE_WIDTH);
  expect(pageLeftPx - placed).toBeCloseTo((DEVICE_WIDTH - DEVICE_PAGE_WIDTH) / 2, 6);
  // What the old form did: the mark's x, scaled, straight into the scroll
  // offset, and no alignment at all. Measured on the device as a page whose
  // left edge sat at -60.1 with a strip of desk the same width showing on the
  // right.
  const old = scrollLeftOf(
    { pageCoordinates: { x: MARK_X, y: MARK_Y }, alignX: 0 },
    pageX,
    DEVICE_SCALE,
    DEVICE_WIDTH,
  );
  expect(pageLeftPx - old).toBeCloseTo(-60.26, 2);
});

test("the column does not move sideways for a mark", () => {
  // Vertical is one page per row at the viewport's own width: the page's left
  // edge is the column's, and a mark inside it is no reason to leave it. Even
  // pinched wider than the screen, which is the one case where it could.
  expect(scrollLeftOf(deviceMark("vertical"), 0, DEVICE_SCALE, DEVICE_WIDTH)).toBe(GAP);
  const zoomed = deviceMark("vertical", PAGE.width, 2 * DEVICE_PAGE_WIDTH);
  expect(zoomed.pageCoordinates.x).toBe(0);
  expect(zoomed.alignX).toBe(0);
});

// --- and once a pinch has made the page wider than the screen ---------------
// The reader magnified the page to read it, and a jump must not undo that. The
// page no longer fits, so there is horizontal room to move in, and the mark
// takes it: alignX 50 puts the mark itself in the middle of the screen.
const ZOOM_PAGE_WIDTH = 2 * DEVICE_PAGE_WIDTH;
const ZOOM_SCALE = ZOOM_PAGE_WIDTH / PAGE.width;
const ZOOM_MAX_SCROLL_X = stripWidth * ZOOM_SCALE + 2 * GAP - DEVICE_WIDTH;

// Where the mark itself ends up, measured from the viewport's left edge.
const markOnScreen = (markX: number, pageX: number): number => {
  const p = deviceMark("paged", markX, ZOOM_PAGE_WIDTH);
  const at = clampScroll(scrollLeftOf(p, pageX, ZOOM_SCALE, DEVICE_WIDTH), ZOOM_MAX_SCROLL_X);
  return pageX * ZOOM_SCALE + markX * ZOOM_SCALE + GAP - at;
};

test("a mark on a magnified page lands in the middle of the screen", () => {
  const pageX = 7 * (PAGE.width + PAGE_GAP);
  // Halfway across the page: nothing to clamp, so the mark is centred exactly.
  expect(markOnScreen(PAGE.width / 2, pageX)).toBeCloseTo(DEVICE_WIDTH / 2, 6);
  // The regression this replaces: a mark on the right-hand side used to be the
  // worst case. Now it is the same case as any other.
  expect(markOnScreen(500, pageX)).toBeCloseTo(DEVICE_WIDTH / 2, 6);
  const p = deviceMark("paged", 500, ZOOM_PAGE_WIDTH);
  expect(clampScroll(scrollLeftOf(p, pageX, ZOOM_SCALE, DEVICE_WIDTH), ZOOM_MAX_SCROLL_X)).toBeGreaterThan(0);
});

test("a mark against either edge of the strip stays on screen", () => {
  // The first page's left edge: centring it would scroll past the start, so the
  // browser stops at 0 and the mark sits at its own distance from that edge.
  const first = deviceMark("paged", 0, ZOOM_PAGE_WIDTH);
  expect(clampScroll(scrollLeftOf(first, 0, ZOOM_SCALE, DEVICE_WIDTH), ZOOM_MAX_SCROLL_X)).toBe(0);
  expect(markOnScreen(0, 0)).toBeCloseTo(GAP, 6);
  // The last page's right edge: past the end of the strip, so the browser stops
  // there instead, and the mark is still inside the viewport.
  const lastPageX = (PAGES - 1) * (PAGE.width + PAGE_GAP);
  const last = deviceMark("paged", PAGE.width, ZOOM_PAGE_WIDTH);
  expect(
    clampScroll(scrollLeftOf(last, lastPageX, ZOOM_SCALE, DEVICE_WIDTH), ZOOM_MAX_SCROLL_X),
  ).toBe(ZOOM_MAX_SCROLL_X);
  const on = markOnScreen(PAGE.width, lastPageX);
  expect(on).toBeGreaterThan(0);
  expect(on).toBeLessThanOrEqual(DEVICE_WIDTH);
});
