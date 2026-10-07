// The Display sheet's stepped tracks without React (docs/70): the rung a value
// is on, the end buttons, a slider value snapped into the ladder, and where the
// ticks go. Run: bun test.

import { expect, test } from "bun:test";
import {
  FLOW_FONT_STEPS,
  FLOW_LINE_STEPS,
  FLOW_PAD_STEPS,
} from "../../../../../src/reading/epub/flow/flow-display";
import {
  clampStep,
  stepFromEnd,
  stepFromSlider,
  stepIndexOf,
  tickFraction,
} from "../../../../../src/ui/components/phone/reader/stepped-track";

test("a value on the ladder is its own rung, one off it falls back to the default's", () => {
  const lines = FLOW_LINE_STEPS.map((s) => s.value);
  expect(stepIndexOf(lines, 1.85, 1.6)).toBe(2);
  expect(stepIndexOf(lines, 1.7, 1.6)).toBe(1);
  expect(stepIndexOf(FLOW_FONT_STEPS, 16, 17)).toBe(2);
  // A fallback that is itself off the ladder still lands on a rung.
  expect(stepIndexOf(FLOW_FONT_STEPS, 16, 99)).toBe(0);
});

test("a step is rounded and held inside the ladder", () => {
  expect(clampStep(-1, 5)).toBe(0);
  expect(clampStep(7, 5)).toBe(4);
  expect(clampStep(2.4, 5)).toBe(2);
  expect(clampStep(2.6, 5)).toBe(3);
  expect(clampStep(Number.NaN, 5)).toBe(0);
  expect(clampStep(3, 1)).toBe(0);
});

test("the end buttons move one rung toward their end and stop there", () => {
  const n = FLOW_FONT_STEPS.length;
  expect(stepFromEnd(2, n, "start")).toBe(1);
  expect(stepFromEnd(2, n, "end")).toBe(3);
  expect(stepFromEnd(0, n, "start")).toBe(0);
  expect(stepFromEnd(n - 1, n, "end")).toBe(n - 1);
  // Margins have two rungs: each end button is the rung at its end.
  const pads = FLOW_PAD_STEPS.length;
  expect(stepFromEnd(0, pads, "end")).toBe(1);
  expect(stepFromEnd(1, pads, "start")).toBe(0);
});

test("a slider value lands on a rung", () => {
  expect(stepFromSlider([3], 5)).toBe(3);
  expect(stepFromSlider([0.7], 3)).toBe(1);
  expect(stepFromSlider([9], 3)).toBe(2);
  expect(stepFromSlider([], 3)).toBe(0);
});

test("the ticks run from one end of the track to the other, evenly", () => {
  expect([0, 1, 2, 3, 4].map((i) => tickFraction(i, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  expect([0, 1, 2].map((i) => tickFraction(i, 3))).toEqual([0, 0.5, 1]);
  expect([0, 1].map((i) => tickFraction(i, 2))).toEqual([0, 1]);
  expect(tickFraction(0, 1)).toBe(0.5);
});
