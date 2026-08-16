// The hold-to-talk overlay's arithmetic (src/ui/components/chat/hold-zones.ts):
// the zone under a finger, the meter's bars, and the line each zone shows.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  METER_BARS,
  RELEASE_LABEL,
  SLOP,
  barHeights,
  zoneAt,
  type Box,
} from "../../../src/ui/components/chat/hold-zones";

// A phone-sized layout: two 56px targets at the top of the overlay, the bar
// they were dragged from below.
const CANCEL: Box = { left: 20, top: 400, right: 76, bottom: 456 };
const EDIT: Box = { left: 300, top: 400, right: 356, bottom: 456 };
const BOXES = { cancel: CANCEL, edit: EDIT };

test("a finger still on the bar is in the send zone", () => {
  expect(zoneAt(180, 600, BOXES)).toBe("send");
});

test("a finger on a target is in that target's zone", () => {
  expect(zoneAt(48, 428, BOXES)).toBe("cancel");
  expect(zoneAt(328, 428, BOXES)).toBe("edit");
});

test("a target takes a thumb's worth of slop around it", () => {
  expect(zoneAt(76 + SLOP - 1, 428, BOXES)).toBe("cancel");
  expect(zoneAt(76 + SLOP + 1, 428, BOXES)).toBe("send");
});

test("unmeasured targets do not swallow the whole screen", () => {
  expect(zoneAt(48, 428, { cancel: null, edit: null })).toBe("send");
  expect(zoneAt(48, 428, {})).toBe("send");
});

test("silence still draws a meter, and it is the same for every bar", () => {
  const bars = barHeights(0);
  expect(bars).toHaveLength(METER_BARS);
  expect(new Set(bars).size).toBe(1);
  expect(bars[0]).toBeGreaterThan(0);
});

test("a louder level raises every bar and never overflows the row", () => {
  const quiet = barHeights(0.2);
  const loud = barHeights(0.9);
  for (let i = 0; i < METER_BARS; i++) {
    expect(loud[i]).toBeGreaterThan(quiet[i]);
    expect(loud[i]).toBeLessThanOrEqual(1);
  }
});

test("the row is tallest in the middle, so it reads as a voice", () => {
  const bars = barHeights(1);
  const mid = (METER_BARS - 1) / 2;
  expect(bars[mid]).toBeGreaterThan(bars[0]);
  expect(bars[0]).toBeCloseTo(bars[METER_BARS - 1]);
});

test("a level outside 0..1 or missing entirely is clamped rather than drawn", () => {
  expect(barHeights(5)).toEqual(barHeights(1));
  expect(barHeights(-1)).toEqual(barHeights(0));
  expect(barHeights(Number.NaN)).toEqual(barHeights(0));
});

test("the release line names the outcome and never the words", () => {
  expect(RELEASE_LABEL).toEqual({
    send: "Release to send",
    cancel: "Release to cancel",
    edit: "Release to edit",
  });
});
