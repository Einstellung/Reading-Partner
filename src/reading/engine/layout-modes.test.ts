import { expect, test } from "bun:test";
import {
  applyJump,
  applyLayout,
  LAYOUT_SETTINGS,
  otherLayout,
  readingPosition,
  restingState,
  type LayoutEngineState,
  type ReadingLayout,
  type VisiblePage,
} from "./layout-modes";

const layouts: ReadingLayout[] = ["vertical", "paged"];

test("the two layouts disagree on every setting they own", () => {
  // If a field were equal in both, leaving a layout would silently keep the
  // other one's value — the shape the stuck-in-a-page-strip bug takes.
  const v = LAYOUT_SETTINGS.vertical;
  const p = LAYOUT_SETTINGS.paged;
  const shared = (Object.keys(v) as (keyof typeof v)[]).filter((k) => v[k] === (p[k] as never));
  expect(shared).toEqual([]);
});

test("a round trip lands exactly where it started", () => {
  for (const start of layouts) {
    const initial = restingState(start, 1.25);
    const there = applyLayout(initial, otherLayout(start));
    const back = applyLayout(there, start);
    expect(back).toEqual(restingState(start, 0));
  }
});

test("switching back and forth repeatedly is stable", () => {
  let s = restingState("vertical");
  const seen: LayoutEngineState[] = [];
  for (let i = 0; i < 6; i++) {
    s = applyLayout(s, i % 2 === 0 ? "paged" : "vertical");
    seen.push(s);
  }
  expect(seen[0]).toEqual(seen[2]);
  expect(seen[2]).toEqual(seen[4]);
  expect(seen[1]).toEqual(seen[3]);
  expect(seen[3]).toEqual(seen[5]);
});

test("applying the same layout twice changes nothing the second time", () => {
  for (const l of layouts) {
    const once = applyLayout(restingState(otherLayout(l)), l);
    expect(applyLayout(once, l)).toEqual(once);
  }
});

test("a switch out of a dirty layout still lands clean", () => {
  // Mid-drag, engine paused, pointer captured, inertia in flight: the switch
  // owns all of it, whichever direction it goes.
  const dirty: LayoutEngineState = {
    ...restingState("paged", 0.97),
    gesturesIdle: false,
    enginePaused: true,
    pointerCaptured: true,
    inertia: true,
  };
  expect(applyLayout(dirty, "vertical")).toEqual(restingState("vertical"));
  expect(applyLayout(dirty, "paged")).toEqual(restingState("paged", 0.97));
});

test("the fit-page baseline is dropped on the way out and never leaks back in", () => {
  const paged = restingState("paged", 1.4);
  const vertical = applyLayout(paged, "vertical");
  expect(vertical.fitPageBaseline).toBe(0);
  // Re-entering paged starts with no baseline: the host recomputes it from the
  // zoom the new fit-page lands on, which a viewport resize may have changed.
  expect(applyLayout(vertical, "paged").fitPageBaseline).toBe(0);
});

test("paged is the horizontal fit-page strip, vertical the fit-width column", () => {
  expect(LAYOUT_SETTINGS.paged.axis).toBe("horizontal");
  expect(LAYOUT_SETTINGS.paged.zoom).toBe("fit-page");
  expect(LAYOUT_SETTINGS.vertical.axis).toBe("vertical");
  expect(LAYOUT_SETTINGS.vertical.zoom).toBe("fit-width");
});

test("paged centres the page it is given, vertical starts it at the top", () => {
  // The switch carries the reading position across the axis flip, and each
  // layout places it its own way: one whole page in the middle of the strip,
  // or the page's first line at the top of the column.
  expect(LAYOUT_SETTINGS.paged.placePage).toBe("center");
  expect(LAYOUT_SETTINGS.vertical.placePage).toBe("top");
});

test("otherLayout is the toggle the reader's menu item performs", () => {
  expect(otherLayout("paged")).toBe("vertical");
  expect(otherLayout("vertical")).toBe("paged");
});

test("a jump drops every gesture the router had in flight", () => {
  // The states a jump can arrive in: a finger following, the engine paused
  // under it, the pointer captured on the viewport, inertia still coasting.
  // Each of those keeps writing the scroll position, so each has to go —
  // otherwise the fling overwrites the jump a frame later and the reader lands
  // short of the page it was sent to.
  const mid: LayoutEngineState = {
    ...restingState("vertical"),
    gesturesIdle: false,
    enginePaused: true,
    pointerCaptured: true,
    inertia: true,
  };
  expect(applyJump(mid)).toEqual(restingState("vertical"));
});

test("a jump is not a layout switch: it leaves the layout exactly as it found it", () => {
  for (const layout of layouts) {
    const resting = restingState(layout, 1.4);
    const jumped = applyJump(resting);
    expect(jumped.axis).toBe(resting.axis);
    expect(jumped.zoom).toBe(resting.zoom);
    expect(jumped.touchLock).toBe(resting.touchLock);
    // The fit-page baseline belongs to the layout, not to the gesture: a jump
    // inside paged mode must not make the reader recompute "zoomed in".
    expect(jumped.fitPageBaseline).toBe(resting.fitPageBaseline);
  }
});

test("jumping twice changes nothing further", () => {
  const once = applyJump({ ...restingState("paged", 1.1), inertia: true });
  expect(applyJump(once)).toEqual(once);
});

// --- where the reader is ----------------------------------------------------

// What the scroll plugin publishes while a layout rests on `page`, at a viewport
// that shows a neighbour. Measured shapes, both real:
//
// paged at 900x1000 with a 612x792 page — fit-page 1.237 against a fit-width of
// 1.437, so the 757px-wide page sits centred in a 900px viewport with 47px of
// the next page and 46px of the previous one showing past the strip's gap. The
// centred page is the most visible, so the plugin calls it the current one.
//
// vertical at any viewport — the reader stops `into` page-units down page
// `page`, and the page below shows at the bottom of the column. The plugin calls
// the lower one current once it covers more of the screen, which is exactly the
// case that has to keep saving the upper one.
function restingOn(layout: ReadingLayout, page: number, into = 0) {
  if (layout === "paged") {
    const visible: VisiblePage[] = [
      ...(page > 1 ? [{ pageNumber: page - 1, pageX: 565, pageY: 0 }] : []),
      { pageNumber: page, pageX: 0, pageY: 0 },
      { pageNumber: page + 1, pageX: 0, pageY: 0 },
    ];
    return { currentPage: page, visible };
  }
  const visible: VisiblePage[] = [
    { pageNumber: page, pageX: 0, pageY: into },
    { pageNumber: page + 1, pageX: 0, pageY: 0 },
  ];
  // Past halfway down page `page`, the page below covers more of the viewport.
  return { currentPage: into > 396 ? page + 1 : page, visible };
}

test("each layout anchors on the page its own placement puts on screen", () => {
  expect(LAYOUT_SETTINGS.paged.anchor).toBe("centered-page");
  expect(LAYOUT_SETTINGS.vertical.anchor).toBe("viewport-top");
});

test("paged saves the centred page, not the neighbour peeking in at the left edge", () => {
  // The bug this rule replaces: the leftmost visible page is page 7 while the
  // reader is looking at page 8, and page 7 is what used to get written.
  const at = restingOn("paged", 8);
  expect(at.visible[0].pageNumber).toBe(7);
  expect(readingPosition("paged", at.currentPage, at.visible)).toEqual({ pageIndex: 7 });
});

test("paged saves no in-page offset: the page is whole", () => {
  const at = restingOn("paged", 8);
  const pos = readingPosition("paged", at.currentPage, at.visible);
  expect(pos.pageX).toBeUndefined();
  expect(pos.pageY).toBeUndefined();
});

test("vertical saves the page the viewport top is in, and how far into it", () => {
  const at = restingOn("vertical", 8, 412);
  // The plugin calls page 9 current here; the position is still inside page 8.
  expect(at.currentPage).toBe(9);
  expect(readingPosition("vertical", at.currentPage, at.visible)).toEqual({
    pageIndex: 7,
    pageX: 0,
    pageY: 412,
  });
});

test("a saved position round-trips: restore it, save again unmoved, get it back", () => {
  // Restoring feeds pageIndex + 1 back to the engine as the page to place, and
  // the reader then rests on that page in that layout. Saving again has to name
  // the same page, or every reopen walks.
  for (const layout of layouts) {
    for (const page of [1, 2, 8, 137]) {
      const at = restingOn(layout, page);
      const saved = readingPosition(layout, at.currentPage, at.visible);
      expect(saved.pageIndex).toBe(page - 1);
      const back = restingOn(layout, saved.pageIndex + 1);
      expect(readingPosition(layout, back.currentPage, back.visible)).toEqual(saved);
    }
  }
});

test("vertical's in-page offset round-trips with the page", () => {
  const at = restingOn("vertical", 8, 412);
  const saved = readingPosition("vertical", at.currentPage, at.visible);
  const back = restingOn("vertical", saved.pageIndex + 1, saved.pageY);
  expect(readingPosition("vertical", back.currentPage, back.visible)).toEqual(saved);
});

test("switching layouts and back does not shift the saved page", () => {
  // paged -> vertical -> paged with no scrolling in between. The switch carries
  // the plugin's current page across and each layout places it its own way, so
  // the position saved on the far side has to be the one saved on this side.
  const start = restingOn("paged", 8);
  const inPaged = readingPosition("paged", start.currentPage, start.visible);
  const asVertical = restingOn("vertical", inPaged.pageIndex + 1);
  const inVertical = readingPosition("vertical", asVertical.currentPage, asVertical.visible);
  expect(inVertical.pageIndex).toBe(inPaged.pageIndex);
  const backToPaged = restingOn("paged", inVertical.pageIndex + 1);
  expect(readingPosition("paged", backToPaged.currentPage, backToPaged.visible)).toEqual(inPaged);
});

test("with no visibility metrics both layouts fall back to the plugin's page", () => {
  for (const layout of layouts) {
    expect(readingPosition(layout, 8, [])).toEqual({ pageIndex: 7 });
  }
});

test("a page number below one never becomes a negative index", () => {
  for (const layout of layouts) {
    expect(readingPosition(layout, 0, []).pageIndex).toBe(0);
    expect(readingPosition(layout, 1, [{ pageNumber: 0, pageX: 0, pageY: 0 }]).pageIndex).toBe(0);
  }
});
