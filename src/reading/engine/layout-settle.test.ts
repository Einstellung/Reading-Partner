import { expect, test } from "bun:test";
import {
  centeredScrollX,
  fitScale,
  fitsCoincide,
  geometrySettled,
  landedAt,
  lockedFitScale,
  metricsFresh,
  modelAxis,
  pageTopScrollY,
  scaleIsFit,
  settleGap,
  SETTLE_SCALE_TOLERANCE,
  SETTLE_TOLERANCE_PX,
  type LayoutGeometry,
} from "./layout-settle";

// A 14-page letter-size document (612x792) in a portrait iPad viewport, at the
// numbers measured in the browser: page gap 10, viewport gap 10, fit 1.33.
const PAGE = { width: 612, height: 792 };
const IPAD_PORTRAIT = { clientWidth: 834, clientHeight: 1194 };
const GAP = 10;
const SCALE = 1.33;
const PAGES = 14;

const columnHeight = PAGES * PAGE.height + (PAGES - 1) * 10;
const stripWidth = PAGES * PAGE.width + (PAGES - 1) * 10;

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
  secondItem: { x: 0, y: PAGE.height + 10 },
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
  secondItem: { x: PAGE.width + 10, y: 0 },
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
  // Measured on the open path: the viewport applies its own gap as padding one
  // commit after it mounts, which changes the client box and not the content
  // box, so the ResizeObserver behind the plugin's metrics never fires. The
  // plugin then holds a viewport 2*gap narrower than the one on screen for the
  // rest of the session.
  const stale: LayoutGeometry = {
    ...pagedGeometry(),
    pluginClientWidth: IPAD_PORTRAIT.clientWidth - 2 * GAP,
    pluginClientHeight: IPAD_PORTRAIT.clientHeight - 2 * GAP,
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
    pluginClientWidth: IPAD_PORTRAIT.clientWidth - 2 * GAP,
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
  const wide = { ...pagedGeometry(), domClientWidth: 854, pluginClientWidth: 854 };
  expect(fitScale("fit-width", PAGE, { clientWidth: 854, clientHeight: 1214 }, GAP)).toBeCloseTo(1.3627, 4);
  expect(lockedFitScale({ ...wide, domClientHeight: 1214, pluginClientHeight: 1214 }, "paged")).toBe(1.362);
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
  expect(fitWidth).toBe(1.437);
  expect(fitPage).toBe(1.237);
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
  const pageX = 7 * (PAGE.width + 10);
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
  const pageY = 7 * (PAGE.height + 10);
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
  // Measured: 834x1194 viewport, 612x792 page, both fits resolve to 1.33. The
  // switch's zoom request therefore changes no scale, fires no scale change,
  // and recomputes nothing — which is why the switch cannot lean on it.
  expect(fitsCoincide(PAGE, IPAD_PORTRAIT, GAP)).toBe(true);
  expect(fitScale("fit-width", PAGE, IPAD_PORTRAIT, GAP)).toBeCloseTo(1.33, 3);
  expect(fitScale("fit-page", PAGE, IPAD_PORTRAIT, GAP)).toBeCloseTo(1.33, 3);
});

test("on a shorter viewport the two fits differ", () => {
  // Measured: 900x1000, same page. fit-width 1.4379, fit-page 1.2374.
  const wide = { clientWidth: 900, clientHeight: 1000 };
  expect(fitsCoincide(PAGE, wide, GAP)).toBe(false);
  expect(fitScale("fit-width", PAGE, wide, GAP)).toBeCloseTo(1.4379, 4);
  expect(fitScale("fit-page", PAGE, wide, GAP)).toBeCloseTo(1.2374, 4);
});

test("a viewport with no room yet resolves to no scale at all", () => {
  expect(fitScale("fit-page", PAGE, { clientWidth: 0, clientHeight: 0 }, GAP)).toBe(0);
  expect(fitScale("fit-width", { width: 0, height: 0 }, IPAD_PORTRAIT, GAP)).toBe(0);
});
