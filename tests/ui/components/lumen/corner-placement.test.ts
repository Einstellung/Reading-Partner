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
  expect(composerLift(1000, { top: bottom - 80, bottom })).toBe(
    BOTTOM_BAND_PX + 80 + CORNER_GAP_PX,
  );
});

test("nothing measured yet is no lift, not a guess", () => {
  expect(cornerPlacement({ ...BASE, composer: null }).liftPx).toBe(0);
});

// A phone is the same rule with a shorter window and a taller safe area: the
// measured box carries both.
test("the lift follows the measured box, on any width", () => {
  expect(composerLift(700, { top: 590, bottom: 666 })).toBe(110 + CORNER_GAP_PX);
});
