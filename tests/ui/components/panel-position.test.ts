// Where a floating panel lands. The cases that matter are the edges: an anchor
// against a viewport border, and a panel too big for the viewport at all.

import { expect, test } from "bun:test";
import {
  fitPanelWidth,
  placePanel,
  pointAnchor,
  type AnchorRect,
} from "../../../src/ui/components/common/panel-position";

const VIEWPORT = { width: 1000, height: 800 };
const PANEL = { width: 200, height: 100 };
const GAP = 10;
const MARGIN = 8;

function below(anchor: AnchorRect, viewport = VIEWPORT, panel = PANEL) {
  return placePanel({ anchor, panel, viewport, gap: GAP, margin: MARGIN });
}

function beside(anchor: AnchorRect, viewport = VIEWPORT, panel = PANEL) {
  return placePanel({ anchor, panel, viewport, placement: "right", gap: GAP, margin: MARGIN });
}

test("a point anchor is a rect with no size", () => {
  expect(pointAnchor(4, 9)).toEqual({ left: 4, top: 9, right: 4, bottom: 9 });
});

test("with room everywhere the panel hangs under the anchor, centred on it", () => {
  expect(below({ left: 400, top: 300, right: 440, bottom: 320 })).toEqual({ left: 320, top: 330 });
});

test("an anchor at the left edge pushes the panel back to the margin", () => {
  expect(below(pointAnchor(0, 100))).toEqual({ left: MARGIN, top: 110 });
  // A margin's worth in: still clamped, never a negative left.
  expect(below(pointAnchor(MARGIN, 100)).left).toBe(MARGIN);
});

test("an anchor at the right edge pulls the panel back inside", () => {
  // The swatch scrolled to the far end of the header band: centring alone would
  // put half the palette past the screen.
  const { left } = below(pointAnchor(VIEWPORT.width, 100));
  expect(left).toBe(VIEWPORT.width - PANEL.width - MARGIN);
  expect(left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width - MARGIN);
});

test("a panel wider than the viewport keeps its left edge on screen", () => {
  const narrow = { width: 150, height: 800 };
  expect(below(pointAnchor(75, 100), narrow).left).toBe(MARGIN);
});

test("no room below flips the panel above the anchor", () => {
  // 760 + 10 + 100 overflows 800 - 8, and 760 - 10 - 100 clears the top margin.
  expect(below(pointAnchor(500, 760))).toEqual({ left: 400, top: 650 });
});

test("no room either side of the anchor pins the panel to the bottom margin", () => {
  // A short viewport (the soft keyboard is open): the anchor is under the
  // keyboard and there is no room above it either.
  const short = { width: 1000, height: 150 };
  expect(below(pointAnchor(500, 100), short).top).toBe(short.height - PANEL.height - MARGIN);
});

test("a panel taller than the viewport keeps its top edge on screen", () => {
  const short = { width: 1000, height: 60 };
  expect(below(pointAnchor(500, 40), short).top).toBe(MARGIN);
});

test("beside the anchor the panel opens to its right, top-aligned", () => {
  expect(beside({ left: 100, top: 200, right: 140, bottom: 240 })).toEqual({ left: 150, top: 200 });
});

test("no room to the right opens the panel on the other side", () => {
  const anchor = { left: 940, top: 200, right: 980, bottom: 240 };
  expect(beside(anchor)).toEqual({ left: 940 - GAP - PANEL.width, top: 200 });
});

test("no room on either side clamps the panel to the right margin", () => {
  const narrow = { width: 260, height: 800 };
  const anchor = { left: 120, top: 200, right: 160, bottom: 240 };
  expect(beside(anchor, narrow).left).toBe(narrow.width - PANEL.width - MARGIN);
});

test("beside the anchor the panel is still clamped vertically", () => {
  const anchor = { left: 100, top: 780, right: 140, bottom: 800 };
  expect(beside(anchor).top).toBe(VIEWPORT.height - PANEL.height - MARGIN);
});

test("gap and margin default to zero", () => {
  const anchor = { left: 0, top: 0, right: 0, bottom: 0 };
  expect(placePanel({ anchor, panel: PANEL, viewport: VIEWPORT })).toEqual({ left: 0, top: 0 });
});

test("a fixed-width panel shrinks only on a viewport too narrow for it", () => {
  expect(fitPanelWidth(360, 1000, MARGIN)).toBe(360);
  expect(fitPanelWidth(360, 320, MARGIN)).toBe(320 - 2 * MARGIN);
  expect(fitPanelWidth(360, 10, MARGIN)).toBe(0);
});
