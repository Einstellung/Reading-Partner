// Where the case stands beside Lumen (docs/68), which is a set of ratios read
// off the generation the two were drawn in together rather than a number
// somebody liked. The test states the composition: about half the body's
// height, leaning in over the body's lower left, feet on the same line, and a
// finger still gets 44px at the 72px corner.
//
// Run: bun test.

import { expect, test } from "bun:test";

import {
  CASE_ASPECT,
  CASE_HIT_PAD_PX,
  CASE_OF_BODY,
  caseHitPx,
  caseRect,
  caseRectPx,
} from "../../../../src/ui/components/lumen/case-box";

test("the case is a little over half the body, and about as wide as it is tall", () => {
  expect(CASE_OF_BODY.height).toBeCloseTo(0.572, 2);
  expect(CASE_OF_BODY.width).toBeCloseTo(0.521, 2);
  expect(CASE_ASPECT).toBeCloseTo(0.96, 2);
});

test("it leans in over the body's lower left and stands on the body's line", () => {
  // Its right edge is inside the body's own box, which is the overlap the
  // generation has; its own left edge is outside it.
  expect(CASE_OF_BODY.rightFromBodyLeft).toBeGreaterThan(0);
  expect(CASE_OF_BODY.rightFromBodyLeft).toBeLessThan(0.2);
  expect(CASE_OF_BODY.bottomAboveBodyBottom).toBeCloseTo(0, 2);

  const rect = caseRect();
  expect(rect.left).toBeLessThan(0);
  expect(rect.left + rect.width).toBeGreaterThan(0);
  expect(rect.bottom).toBeGreaterThan(0);
  expect(rect.width / rect.height).toBeCloseTo(CASE_ASPECT, 6);
});

test("at the 72px corner the case draws about 24 by 25 and is not clipped", () => {
  const rect = caseRectPx(72);
  expect(rect.width).toBeCloseTo(24, 0);
  expect(rect.height).toBeCloseTo(25, 0);
  // It hangs off the left of the body's square by a few pixels: the corner's
  // footprint is wider than the body, which is what the shell must not clip.
  expect(rect.left).toBeLessThan(0);
  expect(rect.left).toBeGreaterThan(-8);
  // Its feet are in the pool of light, not on the bottom of the box.
  expect(rect.bottom).toBeGreaterThan(4);
});

test("the hit area is a thumb even though the drawing is not", () => {
  const hit = caseHitPx(72);
  expect(hit.width).toBeGreaterThanOrEqual(44);
  expect(hit.height).toBeGreaterThanOrEqual(44);
  expect(CASE_HIT_PAD_PX).toBeGreaterThan(0);
});
