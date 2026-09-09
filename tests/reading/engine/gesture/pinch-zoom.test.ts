import { describe, expect, test } from "bun:test";

import {
  IDLE_PINCH,
  PINCH_SLOP_PX,
  beginPinch,
  pinchCentre,
  pinchSpan,
  stepPinch,
} from "../../../../src/reading/engine/gesture/pinch-zoom";

describe("the span two fingers hold", () => {
  test("is the distance between them", () => {
    expect(pinchSpan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  test("and the centre is the point between them", () => {
    expect(pinchCentre({ x: 10, y: 20 }, { x: 30, y: 60 })).toEqual({ x: 20, y: 40 });
  });
});

describe("a pinch", () => {
  test("writes nothing until the span has moved past the slop", () => {
    const state = beginPinch(200, 1);
    expect(stepPinch(state, 200 + PINCH_SLOP_PX - 1).scale).toBeNull();
    expect(stepPinch(state, 200 - PINCH_SLOP_PX + 1).scale).toBeNull();
  });

  test("scales by the span, measured from where the fingers landed", () => {
    const started = beginPinch(200, 1.5);
    const r = stepPinch(started, 400);
    expect(r.scale).toBeCloseTo(3, 6);
    expect(r.state.active).toBe(true);
  });

  test("stays live inside the slop once it has started, so it can be undone", () => {
    const active = stepPinch(beginPinch(200, 1), 400).state;
    expect(stepPinch(active, 201).scale).toBeCloseTo(1.005, 6);
  });

  test("is absolute, so the same span always means the same scale", () => {
    const state = beginPinch(100, 2);
    const out = stepPinch(stepPinch(stepPinch(state, 300).state, 50).state, 150);
    expect(out.scale).toBeCloseTo(3, 6);
  });

  test("does nothing with no fingers on the glass", () => {
    expect(stepPinch(IDLE_PINCH, 300).scale).toBeNull();
    expect(beginPinch(0, 1).baseSpan).toBeNull();
    expect(stepPinch(beginPinch(200, 1), 0).scale).toBeNull();
  });
});
