// The insets an anchored overlay hands to Radix as collisionPadding. What has
// to hold: a device that reports nothing still gets the design's own gutter, an
// inset larger than the gutter wins, and a resize that changes nothing compares
// equal so an open overlay is not re-rendered for it.

import { expect, test } from "bun:test";
import {
  insetsFromPadding,
  NO_SAFE_AREA,
  OVERLAY_GUTTER,
  safeCollisionPadding,
  sameInsets,
} from "../../../src/ui/components/common/safe-area";

const padding = (top: string, right: string, bottom: string, left: string) => ({
  paddingTop: top,
  paddingRight: right,
  paddingBottom: bottom,
  paddingLeft: left,
});

test("a resolved padding reads back as four numbers", () => {
  expect(insetsFromPadding(padding("59px", "0px", "34px", "0px"))).toEqual({
    top: 59,
    right: 0,
    bottom: 34,
    left: 0,
  });
});

test("fractional insets survive", () => {
  expect(insetsFromPadding(padding("20.5px", "0px", "0px", "0px")).top).toBe(20.5);
});

test("an unmeasured or nonsense padding is no inset", () => {
  expect(insetsFromPadding(padding("", "auto", "-4px", "NaN"))).toEqual(NO_SAFE_AREA);
});

test("no inset still keeps the gutter", () => {
  expect(safeCollisionPadding(NO_SAFE_AREA)).toEqual({
    top: OVERLAY_GUTTER,
    right: OVERLAY_GUTTER,
    bottom: OVERLAY_GUTTER,
    left: OVERLAY_GUTTER,
  });
});

test("an inset larger than the gutter wins, per side", () => {
  // Landscape: the notch is on one side, the home indicator at the bottom.
  expect(safeCollisionPadding({ top: 0, right: 21, bottom: 21, left: 59 })).toEqual({
    top: 8,
    right: 21,
    bottom: 21,
    left: 59,
  });
});

test("the gutter is a floor, not an addition", () => {
  expect(safeCollisionPadding({ top: 4, right: 4, bottom: 4, left: 4 }, 10)).toEqual({
    top: 10,
    right: 10,
    bottom: 10,
    left: 10,
  });
});

test("insets compare by value", () => {
  const a = { top: 59, right: 0, bottom: 34, left: 0 };
  expect(sameInsets(a, { ...a })).toBe(true);
  expect(sameInsets(a, { ...a, left: 1 })).toBe(false);
});
