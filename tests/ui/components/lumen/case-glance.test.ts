// The one glance the corner has (docs/68): the count goes up, the eyes drop to
// the case and come back, once. The transition is here and not in the component
// because that is the whole of it — a number arrives, and either it is a glance
// or it is not.
//
// Run: bun test.

import { expect, test } from "bun:test";

import {
  GLANCE_HOLD_MS,
  GLANCE_MS,
  GLANCE_TARGET,
  NO_GLANCE,
  glanceGaze,
  glanceOver,
  stepGlance,
} from "../../../../src/ui/components/lumen/case-glance";

test("a count that goes up is a glance, and a count that stays is not", () => {
  const first = stepGlance(NO_GLANCE, 1);
  expect(first.nonce).toBe(1);
  expect(first.seen).toBe(1);
  // The corner reads the count twice over, on the store's announcement and on
  // the sync tick. The second reading must not glance again.
  expect(stepGlance(first, 1)).toBe(first);
  expect(stepGlance(stepGlance(first, 1), 1)).toBe(first);
});

test("each new item is its own glance", () => {
  let state = stepGlance(NO_GLANCE, 1);
  state = stepGlance(state, 2);
  expect(state.nonce).toBe(2);
  state = stepGlance(state, 5);
  expect(state.nonce).toBe(3);
  expect(state.seen).toBe(5);
});

test("a count that falls is remembered and not looked at", () => {
  const two = stepGlance(NO_GLANCE, 2);
  const one = stepGlance(two, 1);
  expect(one.nonce).toBe(two.nonce);
  expect(one.seen).toBe(1);
  // Emptying the box and filling it again is a glance, not a second silence.
  const empty = stepGlance(one, 0);
  expect(empty.nonce).toBe(two.nonce);
  expect(stepGlance(empty, 1).nonce).toBe(two.nonce + 1);
});

test("nothing a store can hand back makes a glance out of nothing", () => {
  expect(stepGlance(NO_GLANCE, 0)).toBe(NO_GLANCE);
  expect(stepGlance(NO_GLANCE, -3)).toBe(NO_GLANCE);
  expect(stepGlance(NO_GLANCE, Number.NaN)).toBe(NO_GLANCE);
});

test("the eyes go to the case, hold, and come back inside the glance", () => {
  expect(GLANCE_TARGET.x).toBeLessThan(0);
  expect(GLANCE_TARGET.y).toBeGreaterThan(0);
  // Clamped to the socket: the case is off to the lower left, which is the
  // corner of the eye and no further.
  expect(Math.hypot(GLANCE_TARGET.x, GLANCE_TARGET.y)).toBeCloseTo(1, 6);

  expect(glanceGaze(0)).toEqual(GLANCE_TARGET);
  expect(glanceGaze(GLANCE_HOLD_MS - 1)).toEqual(GLANCE_TARGET);
  expect(glanceGaze(GLANCE_HOLD_MS)).toEqual({ x: 0, y: 0 });

  expect(glanceOver(GLANCE_MS - 1)).toBe(false);
  expect(glanceOver(GLANCE_MS)).toBe(true);
  expect(GLANCE_HOLD_MS).toBeLessThan(GLANCE_MS);
});
