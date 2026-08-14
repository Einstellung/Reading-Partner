// The chat window's zoom arithmetic (src/ui/components/base/chat-scale.ts).
// What has to hold: a value read off disk can be anything and still has to land
// on the grid inside the range, and a trackpad pinch — fractional deltas, dozens
// of events a second — has to move one step at a time rather than cross the
// whole range in a flick. Run: bun test.

import { expect, test } from "bun:test";
import {
  accumulateWheel,
  CHAT_SCALE_DEFAULT,
  CHAT_SCALE_MAX,
  CHAT_SCALE_MIN,
  clampChatScale,
  shiftChatScale,
  stepChatScale,
  wheelDeltaPixels,
} from "../../../src/ui/components/base/chat-scale";

test("a value out of range is pulled to the nearest end", () => {
  expect(clampChatScale(0.1)).toBe(CHAT_SCALE_MIN);
  // A hand-edited device.json is the input here, so nothing about it is trusted.
  expect(clampChatScale(99)).toBe(CHAT_SCALE_MAX);
  expect(clampChatScale(CHAT_SCALE_MIN)).toBe(CHAT_SCALE_MIN);
  expect(clampChatScale(CHAT_SCALE_MAX)).toBe(CHAT_SCALE_MAX);
});

test("anything that is not a finite number is the default", () => {
  for (const value of ["1.2", null, undefined, {}, [], true, NaN, Infinity, -Infinity]) {
    expect(clampChatScale(value)).toBe(CHAT_SCALE_DEFAULT);
  }
});

test("a value off the grid snaps onto it", () => {
  expect(clampChatScale(1.23)).toBe(1.2);
  expect(clampChatScale(1.26)).toBe(1.3);
});

test("stepping stays exactly on the grid", () => {
  // 0.9 + 0.1 is 0.9999999999999999 in binary floating point. Left alone it
  // would never equal the default it just passed through, and the store's
  // "already this value" check would keep missing.
  expect(stepChatScale(CHAT_SCALE_MIN, 1)).toBe(1);
  let value = CHAT_SCALE_MIN;
  for (let i = 0; i < 20; i += 1) value = stepChatScale(value, 1);
  expect(value).toBe(CHAT_SCALE_MAX);
  for (let i = 0; i < 20; i += 1) value = stepChatScale(value, -1);
  expect(value).toBe(CHAT_SCALE_MIN);
});

test("stepping stops at the ends instead of running past them", () => {
  expect(stepChatScale(CHAT_SCALE_MAX, 1)).toBe(CHAT_SCALE_MAX);
  expect(stepChatScale(CHAT_SCALE_MIN, -1)).toBe(CHAT_SCALE_MIN);
});

test("several steps at once land where the same number of single steps would", () => {
  expect(shiftChatScale(1, 3)).toBe(1.3);
  expect(shiftChatScale(1.3, -2)).toBe(1.1);
  expect(shiftChatScale(1, 0)).toBe(1);
  // A stored value that is out of range is clamped before it is moved.
  expect(shiftChatScale(99, -1)).toBe(1.7);
});

test("a pinch's fractional deltas are gathered, not spent one step each", () => {
  let acc = 0;
  let taken = 0;
  // Six events of -6 is 36, one short of a notch: still nothing.
  for (let i = 0; i < 6; i += 1) {
    const out = accumulateWheel(acc, -6, 0);
    acc = out.acc;
    taken += out.steps;
  }
  expect(taken).toBe(0);
  const seventh = accumulateWheel(acc, -6, 0);
  expect(seventh.steps).toBe(1);
  // What was spent comes off the accumulator; the remainder counts toward the
  // next step, so a slow pinch keeps its pace instead of restarting each time.
  expect(seventh.acc).toBeCloseTo(-2, 10);
});

test("scrolling up zooms in and down zooms out", () => {
  expect(accumulateWheel(0, -40, 0).steps).toBe(1);
  expect(accumulateWheel(0, 40, 0).steps).toBe(-1);
});

test("one big delta is worth every notch inside it", () => {
  const out = accumulateWheel(0, -100, 0);
  expect(out.steps).toBe(2);
  expect(out.acc).toBeCloseTo(-20, 10);
});

test("reversing drops what was gathered the other way", () => {
  const gathered = accumulateWheel(0, -30, 0);
  expect(gathered.acc).toBe(-30);
  // Without the reset the 30 already gathered would be one event away from
  // zooming in, and the first push of a zoom-out would zoom in instead.
  const reversed = accumulateWheel(gathered.acc, 12, 0);
  expect(reversed.acc).toBe(12);
  expect(reversed.steps).toBe(0);
});

test("a delta that is not a number leaves the accumulator alone", () => {
  expect(accumulateWheel(-12, NaN, 0)).toEqual({ acc: -12, steps: 0 });
});

test("a sideways scroll leaves the accumulator alone rather than resetting it", () => {
  // deltaY 0 has no sign, so the reversal test would match it and drop what a
  // pinch had gathered one event before it completed a step.
  expect(accumulateWheel(-36, 0, 0)).toEqual({ acc: -36, steps: 0 });
});

test("the same scroll is worth the same however the engine measures it", () => {
  // Which of the three units an engine reports in is its own business, and this
  // app runs on three engines. 240px, 15 lines and 0.3 of a page are the same
  // gesture, and a mode left unconverted is a zoom that does not answer.
  expect(accumulateWheel(0, -240, 0).steps).toBe(6);
  expect(accumulateWheel(0, -15, 1).steps).toBe(6);
  expect(accumulateWheel(0, -0.3, 2).steps).toBe(6);
});

test("one notch of a line-mode wheel is worth a step", () => {
  // A line-mode engine reports about 3 per notch: read as pixels that is a
  // fourteenth of a step, and the wheel would feel dead.
  expect(accumulateWheel(0, -3, 1).steps).toBe(1);
  expect(accumulateWheel(0, -3, 0).steps).toBe(0);
});

test("an unknown mode is read as pixels", () => {
  expect(wheelDeltaPixels(-40, 0)).toBe(-40);
  expect(wheelDeltaPixels(-40, 7)).toBe(-40);
});
