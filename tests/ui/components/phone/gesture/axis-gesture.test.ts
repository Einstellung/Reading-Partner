// The drag machine both phone gestures are made of: what claims a finger, what
// hands it back, and that the axis is the only thing the two gestures differ by.
// The gestures' own tests cover their thresholds and the commands they emit;
// what is here is tested once, on both axes, instead of twice.

import { expect, test } from "bun:test";
import {
  classifyAxisMove,
  initAxisGestureState,
  shouldClaimAxisTouch,
  stepAxisGesture,
  type AxisGestureInput,
  type AxisGestureSpec,
  type AxisGestureState,
  type CaptureCommand,
  type GestureAxis,
} from "../../../../../src/ui/components/phone/gesture/axis-gesture";

const SLOP = 10;
const RATIO = 1.2;

type TestCommand = { type: "move"; d: number } | { type: "end"; done: boolean };

// A spec with nothing in it but the axis: every threshold is the plain one, so
// what a case proves is the machine and not a gesture's tuning.
function spec(axis: GestureAxis): AxisGestureSpec<{ ok: boolean }, TestCommand> {
  return {
    axis,
    slop: SLOP,
    axisRatio: RATIO,
    canStart: (down) => down.ok,
    moveCommand: (d) => ({ type: "move", d }),
    endCommand: (d, v, cancelled) => ({ type: "end", done: !cancelled && (d >= 50 || v >= 0.5) }),
  };
}

function drive(
  axis: GestureAxis,
  inputs: AxisGestureInput<{ ok: boolean }>[],
): { state: AxisGestureState; commands: (CaptureCommand | TestCommand)[] } {
  let state = initAxisGestureState();
  const commands: (CaptureCommand | TestCommand)[] = [];
  for (const input of inputs) {
    const next = stepAxisGesture(state, input, spec(axis));
    state = next.state;
    commands.push(...next.commands);
  }
  return { state, commands };
}

// The same gesture written along each axis: a finger that lands, drags 120px in
// the gesture's direction one sample every 100ms, and lifts.
function pull(axis: GestureAxis, ok = true): AxisGestureInput<{ ok: boolean }>[] {
  const at = (d: number, t: number) =>
    axis === "x" ? { x: 100 + d, y: 400, t } : { x: 400, y: 100 + d, t };
  const inputs: AxisGestureInput<{ ok: boolean }>[] = [
    { type: "pointerdown", id: 1, ...at(0, 0), ok },
  ];
  for (let i = 1; i <= 6; i++) inputs.push({ type: "pointermove", id: 1, ...at(i * 20, i * 100) });
  inputs.push({ type: "pointerup", id: 1, ...at(120, 600) });
  return inputs;
}

const AXES: GestureAxis[] = ["x", "y"];

test("a move resolves only once one axis wins by the ratio", () => {
  expect(classifyAxisMove(2, 2, SLOP, RATIO)).toBe("wait");
  expect(classifyAxisMove(SLOP + 4, 0, SLOP, RATIO)).toBe("go");
  // The gesture's own direction is the only one that goes.
  expect(classifyAxisMove(-(SLOP + 4), 0, SLOP, RATIO)).toBe("abandon");
  // The other axis dominating is the page scrolling, whichever way it runs.
  expect(classifyAxisMove(0, SLOP + 4, SLOP, RATIO)).toBe("abandon");
  expect(classifyAxisMove(0, -(SLOP + 4), SLOP, RATIO)).toBe("abandon");
  // Diagonal: neither axis wins by the ratio, so the move has not resolved yet.
  expect(classifyAxisMove(20, 19, SLOP, RATIO)).toBe("wait");
});

test("a touch is claimed early, and only by a clearly on-axis move", () => {
  expect(shouldClaimAxisTouch(3, 0, 3, RATIO)).toBe(true);
  expect(shouldClaimAxisTouch(2.5, 0, 3, RATIO)).toBe(false);
  expect(shouldClaimAxisTouch(-20, 0, 3, RATIO)).toBe(false);
  // As much across as along belongs to the page, either way across.
  expect(shouldClaimAxisTouch(6, 6, 3, RATIO)).toBe(false);
  expect(shouldClaimAxisTouch(6, -6, 3, RATIO)).toBe(false);
  expect(shouldClaimAxisTouch(20, 4, 3, RATIO)).toBe(true);
});

for (const axis of AXES) {
  test(`${axis}: a drag past the slop captures the finger and follows it`, () => {
    const { commands } = drive(axis, pull(axis));
    expect(commands[0]).toEqual({ type: "capture", id: 1 });
    const moves = commands.filter((c) => c.type === "move") as { d: number }[];
    expect(moves.length).toBeGreaterThan(1);
    expect(moves.map((m) => m.d)).toEqual(moves.map((m) => m.d).sort((a, b) => a - b));
    expect(commands[commands.length - 1]).toEqual({ type: "end", done: true });
  });

  test(`${axis}: a pointer the spec will not start from is never taken`, () => {
    const { commands, state } = drive(axis, pull(axis, false));
    expect(commands).toEqual([]);
    expect(state).toEqual(initAxisGestureState());
  });

  test(`${axis}: a cancelled pointer ends the drag without committing`, () => {
    const at = (d: number, t: number) =>
      axis === "x" ? { x: 100 + d, y: 400, t } : { x: 400, y: 100 + d, t };
    const { commands } = drive(axis, [
      { type: "pointerdown", id: 1, ...at(0, 0), ok: true },
      { type: "pointermove", id: 1, ...at(60, 100) },
      { type: "pointermove", id: 1, ...at(200, 200) },
      { type: "pointercancel", id: 1 },
    ]);
    expect(commands[commands.length - 1]).toEqual({ type: "end", done: false });
  });

  test(`${axis}: dragging back past the start only undoes the drag`, () => {
    const at = (d: number, t: number) =>
      axis === "x" ? { x: 100 + d, y: 400, t } : { x: 400, y: 100 + d, t };
    const { commands } = drive(axis, [
      { type: "pointerdown", id: 1, ...at(0, 0), ok: true },
      { type: "pointermove", id: 1, ...at(60, 100) },
      { type: "pointermove", id: 1, ...at(-80, 200) },
      { type: "pointerup", id: 1, ...at(-80, 300) },
    ]);
    const moves = commands.filter((c) => c.type === "move") as { d: number }[];
    expect(Math.min(...moves.map((m) => m.d))).toBe(0);
  });

  test(`${axis}: a second finger abandons a drag in flight and the first cannot restart it`, () => {
    const at = (d: number, t: number) =>
      axis === "x" ? { x: 100 + d, y: 400, t } : { x: 400, y: 100 + d, t };
    const { commands, state } = drive(axis, [
      { type: "pointerdown", id: 1, ...at(0, 0), ok: true },
      { type: "pointermove", id: 1, ...at(60, 100) },
      { type: "pointerdown", id: 2, ...at(300, 150), ok: true },
      { type: "pointermove", id: 1, ...at(200, 200) },
      { type: "pointerup", id: 2, ...at(300, 250) },
    ]);
    expect(commands[commands.length - 1]).toEqual({ type: "end", done: false });
    expect(state.phase).toBe("off");
    const after = stepAxisGesture(state, { type: "pointermove", id: 1, ...at(300, 300) }, spec(axis));
    expect(after.commands).toEqual([]);
  });

  test(`${axis}: every pointer lifting returns the machine to rest`, () => {
    const { state } = drive(axis, pull(axis));
    expect(state).toEqual(initAxisGestureState());
  });
}
