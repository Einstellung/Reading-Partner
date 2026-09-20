// Lumen's one gesture (src/ui/components/lumen/hold-toggle.ts): a hold long
// enough to charge the body fires once, a shorter one fires never, and the
// charge is what the corner paints either way.
//
// Run: bun test.

import { expect, test } from "bun:test";

import {
  HOLD_FADE_MS,
  HOLD_MOVE_PX,
  HOLD_MS,
  HOLD_REST,
  holdCharge,
  holdMoving,
  holdStep,
  type HoldInput,
  type HoldState,
} from "../../../../src/ui/components/lumen/hold-toggle";

/** Feed a timeline in and collect what fired and when. */
function run(inputs: HoldInput[]): { state: HoldState; fires: number } {
  let state = HOLD_REST;
  let fires = 0;
  for (const input of inputs) {
    const step = holdStep(state, input);
    state = step.state;
    if (step.fired) fires++;
  }
  return { state, fires };
}

test("the charge is the fraction of the hold that has passed", () => {
  const { state } = run([{ kind: "down", x: 0, y: 0, at: 1000 }]);
  expect(holdCharge(state, 1000)).toBe(0);
  expect(holdCharge(state, 1000 + HOLD_MS / 2)).toBeCloseTo(0.5, 5);
  expect(holdCharge(state, 1000 + HOLD_MS)).toBe(1);
  // It never goes past full: the body is as bright as it gets and stays there
  // under a finger that has not let go.
  expect(holdCharge(state, 1000 + HOLD_MS * 4)).toBe(1);
});

test("a hold that reaches full charge fires, once", () => {
  const { fires } = run([
    { kind: "down", x: 0, y: 0, at: 0 },
    { kind: "tick", at: HOLD_MS - 1 },
    { kind: "tick", at: HOLD_MS },
    { kind: "tick", at: HOLD_MS + 16 },
    { kind: "tick", at: HOLD_MS + 32 },
    { kind: "up", at: HOLD_MS + 900 },
  ]);
  expect(fires).toBe(1);
});

test("a release before full charge fires nothing and drains", () => {
  const { state, fires } = run([
    { kind: "down", x: 0, y: 0, at: 0 },
    { kind: "tick", at: 200 },
    { kind: "up", at: 250 },
  ]);
  expect(fires).toBe(0);
  expect(holdCharge(state, 250)).toBeCloseTo(0.5, 5);
  expect(holdCharge(state, 250 + HOLD_FADE_MS / 2)).toBeCloseTo(0.25, 5);
  expect(holdCharge(state, 250 + HOLD_FADE_MS)).toBe(0);
  expect(holdMoving(state, 250 + HOLD_FADE_MS)).toBe(false);
});

test("a release exactly at full charge still fires", () => {
  // No tick saw the crossing — a throttled frame loop, or a finger that lifted
  // between two frames.
  const { fires } = run([
    { kind: "down", x: 0, y: 0, at: 0 },
    { kind: "up", at: HOLD_MS },
  ]);
  expect(fires).toBe(1);
});

test("a finger that wanders far enough is a scroll, not a hold", () => {
  const { state, fires } = run([
    { kind: "down", x: 100, y: 100, at: 0 },
    { kind: "move", x: 100 + HOLD_MOVE_PX, y: 100, at: 100 },
    { kind: "move", x: 100 + HOLD_MOVE_PX + 1, y: 100, at: 150 },
    { kind: "tick", at: HOLD_MS + 50 },
    { kind: "up", at: HOLD_MS + 60 },
  ]);
  expect(fires).toBe(0);
  // The charge it had at the moment it was cancelled, draining from there.
  expect(holdCharge(state, 150)).toBeCloseTo(0.3, 5);
  expect(holdCharge(state, 150 + HOLD_FADE_MS)).toBe(0);
});

test("a cancelled press never fires, however long it lasted", () => {
  const { fires } = run([
    { kind: "down", x: 0, y: 0, at: 0 },
    { kind: "cancel", at: HOLD_MS * 2 },
  ]);
  expect(fires).toBe(0);
});

test("a second finger does not restart the press", () => {
  const { fires } = run([
    { kind: "down", x: 0, y: 0, at: 0 },
    { kind: "down", x: 40, y: 40, at: 300 },
    { kind: "tick", at: HOLD_MS },
  ]);
  expect(fires).toBe(1);
});

test("the corner runs its loop exactly while something is moving", () => {
  expect(holdMoving(HOLD_REST, 0)).toBe(false);
  const down = holdStep(HOLD_REST, { kind: "down", x: 0, y: 0, at: 0 }).state;
  expect(holdMoving(down, 10_000)).toBe(true);
  const up = holdStep(down, { kind: "up", at: 200 }).state;
  expect(holdMoving(up, 200)).toBe(true);
  expect(holdMoving(up, 200 + HOLD_FADE_MS)).toBe(false);
});

test("a press that never charged leaves nothing to drain", () => {
  const { state } = run([
    { kind: "down", x: 0, y: 0, at: 0 },
    { kind: "up", at: 0 },
  ]);
  expect(state.fade).toBeNull();
  expect(holdMoving(state, 0)).toBe(false);
});
