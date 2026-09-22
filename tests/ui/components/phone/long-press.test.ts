// The hold that opens an aside on the phone lesson (docs/74): the four ways it
// is called off, and the one way it lands. Run: bun test.

import { expect, test } from "bun:test";
import {
  LONG_PRESS_SLOP,
  stepLongPress,
  type LongPressState,
} from "../../../../src/ui/components/phone/long-press";

const AT = (x: number, y: number): LongPressState => ({ pointerId: 1, x, y });

test("a finger down arms the watch", () => {
  expect(stepLongPress(null, { type: "down", pointerId: 1, x: 10, y: 20 })).toEqual({
    state: { pointerId: 1, x: 10, y: 20 },
    action: "arm",
  });
});

test("the clock running out on an armed watch is the gesture", () => {
  expect(stepLongPress(AT(10, 20), { type: "elapsed" })).toEqual({ state: null, action: "fire" });
});

test("it fires once — a second tick has nothing left to fire", () => {
  const { state } = stepLongPress(AT(10, 20), { type: "elapsed" });
  expect(stepLongPress(state, { type: "elapsed" }).action).toBe("none");
});

test("the clock running out on nothing does nothing", () => {
  expect(stepLongPress(null, { type: "elapsed" })).toEqual({ state: null, action: "none" });
});

test("drift inside the slop is still a hold", () => {
  const move = { type: "move", pointerId: 1, x: 10 + LONG_PRESS_SLOP, y: 20 } as const;
  expect(stepLongPress(AT(10, 20), move)).toEqual({ state: AT(10, 20), action: "none" });
});

test("movement past the slop is a drag, and the watch is off", () => {
  const move = { type: "move", pointerId: 1, x: 10 + LONG_PRESS_SLOP + 1, y: 20 } as const;
  expect(stepLongPress(AT(10, 20), move)).toEqual({ state: null, action: "disarm" });
});

test("the slop is a distance, not an axis", () => {
  // 8 across and 8 down is 11.3 away: inside on either axis alone, outside
  // together.
  const move = { type: "move", pointerId: 1, x: 18, y: 28 } as const;
  expect(stepLongPress(AT(10, 20), move).action).toBe("disarm");
});

test("a second finger cancels the first", () => {
  expect(stepLongPress(AT(10, 20), { type: "down", pointerId: 2, x: 90, y: 90 })).toEqual({
    state: null,
    action: "disarm",
  });
});

test("another pointer moving cancels it too", () => {
  expect(stepLongPress(AT(10, 20), { type: "move", pointerId: 2, x: 10, y: 20 })).toEqual({
    state: null,
    action: "disarm",
  });
});

test("the finger coming off early is a tap, not a hold", () => {
  expect(stepLongPress(AT(10, 20), { type: "up", pointerId: 1 })).toEqual({
    state: null,
    action: "disarm",
  });
});

test("a scroll under the finger calls it off", () => {
  expect(stepLongPress(AT(10, 20), { type: "cancel" })).toEqual({
    state: null,
    action: "disarm",
  });
});

test("events with nothing being watched are inert", () => {
  expect(stepLongPress(null, { type: "move", pointerId: 1, x: 0, y: 0 }).action).toBe("none");
  expect(stepLongPress(null, { type: "up", pointerId: 1 }).action).toBe("none");
  expect(stepLongPress(null, { type: "cancel" }).action).toBe("none");
});
