// Where a dragged Lumen ends up (docs/68): the slop that tells a drag from a
// hold, the two docks, the band it may be lifted into, and the shape the spot
// is remembered in.
//
// Run: bun test.

import { expect, test } from "bun:test";

import { NO_SAFE_AREA, type SafeAreaInsets } from "../../../../src/ui/components/base/safe-area";
import {
  CORNER_BODY_PX,
  CORNER_SPOT_DEFAULT,
  DRAG_SLOP_PX,
  columnAlign,
  cornerBottomPx,
  dockX,
  dragOffset,
  dragTransform,
  dropSpot,
  liftFraction,
  liftPxOf,
  maxLiftPx,
  parseCornerSpot,
  passedSlop,
  serializeCornerSpot,
  snapOffset,
  snapSide,
  type CornerFrame,
} from "../../../../src/ui/components/lumen/corner-drag";

function frame(
  width: number,
  height: number,
  insets: SafeAreaInsets = NO_SAFE_AREA,
): CornerFrame {
  return { width, height, insets };
}

// A desk window, and a phone with a notch and a home indicator.
const DESK = frame(1280, 800);
const PHONE = frame(390, 844, { top: 47, right: 0, bottom: 34, left: 0 });

test("the docks are where the corner's own margin puts the body", () => {
  expect(dockX("left", DESK)).toBe(16);
  expect(dockX("right", DESK)).toBe(1280 - 16 - CORNER_BODY_PX);
  // The inset wins over the margin where there is one; a landscape phone puts
  // one on a side edge and not on the other.
  const landscape = frame(844, 390, { top: 0, right: 47, bottom: 21, left: 47 });
  expect(dockX("left", landscape)).toBe(47);
  expect(dockX("right", landscape)).toBe(844 - 47 - CORNER_BODY_PX);
});

test("a window too narrow for both docks keeps them in order", () => {
  const sliver = frame(80, 600);
  expect(dockX("right", sliver)).toBe(dockX("left", sliver));
});

test("the lift stops short of the top bar and the status bar", () => {
  expect(maxLiftPx(DESK)).toBe(800 - 24 - CORNER_BODY_PX - 64);
  expect(maxLiftPx(PHONE)).toBe(844 - 34 - CORNER_BODY_PX - 47 - 64);
  // A window shorter than the two bands has no travel at all rather than a
  // negative one.
  expect(maxLiftPx(frame(390, 120))).toBe(0);
});

test("a remembered lift is clamped back into the window it is read in", () => {
  const high = { side: "right", lift: 0.9 } as const;
  expect(liftPxOf(high, DESK)).toBe(maxLiftPx(DESK));
  // The fraction is kept, so the same spot comes back whole in a window that
  // has room for it.
  expect(liftPxOf(high, frame(1280, 1600))).toBe(0.9 * 1600);
  expect(liftPxOf({ side: "right", lift: 0 }, DESK)).toBe(0);
  expect(liftFraction(-40, DESK)).toBe(0);
  expect(liftFraction(200, DESK)).toBe(200 / 800);
});

test("a press is a drag once it has travelled the slop", () => {
  expect(passedSlop(0, 0)).toBe(false);
  expect(passedSlop(DRAG_SLOP_PX - 1, 0)).toBe(false);
  expect(passedSlop(0, DRAG_SLOP_PX)).toBe(true);
  expect(passedSlop(-DRAG_SLOP_PX, 0)).toBe(true);
});

test("the body stays in its travel for the whole drag", () => {
  const from = { x: dockX("right", DESK), lift: 0 };
  // Thrown off the right edge and pulled below the floor: it goes nowhere.
  expect(dragOffset({ dx: 400, dy: 400 }, from, DESK)).toEqual({ dx: 0, dy: 0 });
  // Carried up and to the left, it follows.
  expect(dragOffset({ dx: -300, dy: -200 }, from, DESK)).toEqual({ dx: -300, dy: -200 });
  // Past the top of the band it stops at the band.
  expect(dragOffset({ dx: 0, dy: -5000 }, from, DESK)).toEqual({
    dx: 0,
    dy: -maxLiftPx(DESK),
  });
  // And past the left dock at the dock.
  expect(dragOffset({ dx: -5000, dy: 0 }, from, DESK)).toEqual({
    dx: dockX("left", DESK) - from.x,
    dy: 0,
  });
});

test("it lands on whichever edge it is nearer", () => {
  expect(snapSide(0, DESK)).toBe("left");
  expect(snapSide(1280 - CORNER_BODY_PX, DESK)).toBe("right");
  // The body's own middle is what is measured, not its left edge.
  expect(snapSide(640 - CORNER_BODY_PX / 2 - 1, DESK)).toBe("left");
  expect(snapSide(640 - CORNER_BODY_PX / 2 + 1, DESK)).toBe("right");
});

test("the drop keeps the height the finger let go at", () => {
  const from = { x: dockX("right", DESK), lift: 0 };
  const offset = dragOffset({ dx: -700, dy: -240 }, from, DESK);
  expect(dropSpot(offset, from, DESK)).toEqual({ side: "left", lift: 240 / 800 });
});

test("the snap travels to where the corner will actually be drawn", () => {
  const from = { x: dockX("right", DESK), lift: 0 };
  const spot = { side: "left", lift: 240 / 800 } as const;
  expect(snapOffset(spot, from, DESK, 0)).toEqual({
    dx: dockX("left", DESK) - from.x,
    dy: -240,
  });
  // Dropped over a composer that owns the bottom edge, it lands above it
  // rather than on it, because that is where the committed corner stands.
  const onTheFloor = { side: "right", lift: 0 } as const;
  expect(snapOffset(onTheFloor, { x: from.x, lift: 120 }, DESK, 120)).toEqual({
    dx: 0,
    dy: 0,
  });
});

test("the composer only lifts a corner that is not already above it", () => {
  expect(cornerBottomPx(0, 120)).toBe(120);
  expect(cornerBottomPx(300, 120)).toBe(300);
  expect(cornerBottomPx(0, 0)).toBe(0);
});

test("the column hangs off the edge the corner is docked at", () => {
  expect(columnAlign("left")).toBe("start");
  expect(columnAlign("right")).toBe("end");
});

test("no offset is no transform", () => {
  expect(dragTransform({ dx: 0, dy: 0 })).toBe("");
  expect(dragTransform({ dx: -12, dy: -3.5 })).toBe("translate3d(-12.00px, -3.50px, 0)");
});

test("the spot round-trips through the slot", () => {
  const spot = { side: "left", lift: 0.3125 } as const;
  expect(parseCornerSpot(serializeCornerSpot(spot))).toEqual(spot);
  expect(parseCornerSpot(serializeCornerSpot(CORNER_SPOT_DEFAULT))).toEqual(
    CORNER_SPOT_DEFAULT,
  );
});

test("anything else in the slot is the corner it has always been", () => {
  for (const raw of [
    null,
    "",
    "{",
    "null",
    "[]",
    '"left"',
    '{"side":"up","lift":0.2}',
    '{"side":"left"}',
    '{"side":"left","lift":"0.2"}',
    '{"side":"left","lift":4}',
    '{"side":"left","lift":-0.2}',
  ]) {
    expect(parseCornerSpot(raw)).toEqual(CORNER_SPOT_DEFAULT);
  }
});
