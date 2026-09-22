// Where Lumen stands in the full-window chat (src/ui/components/lumen/
// corner-placement). Run: scripts/t.sh.

import { expect, test } from "bun:test";
import {
  BOTTOM_BAND_PX,
  CORNER_GAP_PX,
  composerLift,
  cornerPlacement,
} from "../../../../src/ui/components/lumen/corner-placement";

const BASE = {
  shown: true,
  chatMain: true,
  holding: false,
  viewportHeight: 1000,
  visibleBottom: 1000,
  composer: { top: 900, bottom: 976 },
};

test("the corner is drawn in the full-window chat, above the composer", () => {
  const placement = cornerPlacement(BASE);
  expect(placement.shown).toBe(true);
  expect(placement.liftPx).toBe(100 + CORNER_GAP_PX);
});

test("anywhere else it sits on the bottom edge", () => {
  expect(cornerPlacement({ ...BASE, chatMain: false })).toEqual({ shown: true, liftPx: 0 });
});

test("the logo's own switch still wins", () => {
  expect(cornerPlacement({ ...BASE, shown: false })).toEqual({ shown: false, liftPx: 0 });
});

// The hold overlay is a panel over the whole width of the composer with its
// Edit zone on the right — under the lifted corner.
test("a hold-to-talk press takes the corner away for as long as it lasts", () => {
  expect(cornerPlacement({ ...BASE, holding: true })).toEqual({ shown: false, liftPx: 0 });
  expect(cornerPlacement({ ...BASE, holding: false }).shown).toBe(true);
});

// The empty conversation centres its composer; the bottom edge is free.
test("a composer nowhere near the bottom edge lifts nothing", () => {
  const centred = { top: 400, bottom: 480 };
  expect(cornerPlacement({ ...BASE, composer: centred }).liftPx).toBe(0);
});

test("a composer still inside the band lifts the corner clear of it", () => {
  const bottom = 1000 - BOTTOM_BAND_PX;
  expect(composerLift(1000, 1000, { top: bottom - 80, bottom })).toBe(
    BOTTOM_BAND_PX + 80 + CORNER_GAP_PX,
  );
});

test("nothing measured yet is no lift, not a guess", () => {
  expect(cornerPlacement({ ...BASE, composer: null }).liftPx).toBe(0);
});

// A phone is the same rule with a shorter window and a taller safe area: the
// measured box carries both.
test("the lift follows the measured box, on any width", () => {
  expect(composerLift(700, 700, { top: 590, bottom: 666 })).toBe(110 + CORNER_GAP_PX);
});

// An iPad that has been switched away from and come back to keeps the webview
// at full height and lets the keyboard shrink the visual viewport alone
// (docs/pitfall/392). Measured on an iPad Air 13 in portrait: the window stays
// 1366, the visible bottom lands on 963, and the composer — padded clear of the
// keyboard — sits at 874-910. Judged against the window it is 456px clear of
// the bottom and the corner drops onto the bar; judged against what is visible
// it is 53px clear, which is the band, and the corner rises above it.
test("the keyboard's own viewport is what says whether the composer is in the way", () => {
  const composer = { top: 874, bottom: 910 };
  expect(composerLift(1366, 1366, composer)).toBe(0);
  expect(composerLift(1366, 963, composer)).toBe(1366 - 874 + CORNER_GAP_PX);
});

// The lift itself is still counted off the layout viewport: the corner is fixed
// and its `bottom` offset is measured from that edge, keyboard or no keyboard.
test("the lift is counted off the window, not off the visible part of it", () => {
  expect(composerLift(1366, 963, { top: 900, bottom: 960 })).toBe(1366 - 900 + CORNER_GAP_PX);
});
