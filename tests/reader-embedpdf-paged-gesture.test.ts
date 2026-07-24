// Headless coverage of the paged-mode touch gesture state machine
// (src/reader-embedpdf/paged-gesture.ts). Pure functions, no DOM, no engine —
// run with `bun test`. Mirrors the style of tests/reader-embedpdf-convert.test.ts.

import { test, expect } from "bun:test";
import {
  edgeOf,
  initGestureState,
  lockAxis,
  resolveSwipe,
  stepGesture,
  type GestureCommand,
  type GestureInput,
  type GestureState,
  type PagedGestureConfig,
} from "../src/reader-embedpdf/paged-gesture";

const WIDTH = 800;
const base = (over: Partial<PagedGestureConfig> = {}): PagedGestureConfig => ({
  tool: "pointer",
  zoomedIn: false,
  width: WIDTH,
  ...over,
});

// Drive a sequence of inputs, collecting every command, ending state.
function run(
  inputs: GestureInput[],
  config: PagedGestureConfig,
): { state: GestureState; commands: GestureCommand[] } {
  let state = initGestureState();
  const commands: GestureCommand[] = [];
  for (const input of inputs) {
    const r = stepGesture(state, input, config);
    state = r.state;
    commands.push(...r.commands);
  }
  return { state, commands };
}

const types = (cmds: GestureCommand[]) => cmds.map((c) => c.type);

// --- lockAxis -------------------------------------------------------------

test("lockAxis: within slop is none", () => {
  expect(lockAxis(4, 3, 10, 1.2)).toBe("none");
});
test("lockAxis: dominant horizontal locks x", () => {
  expect(lockAxis(40, 5, 10, 1.2)).toBe("x");
});
test("lockAxis: dominant vertical locks y", () => {
  expect(lockAxis(5, 40, 10, 1.2)).toBe("y");
});
test("lockAxis: diagonal stays undecided", () => {
  expect(lockAxis(30, 30, 10, 1.2)).toBe("none");
});

// --- resolveSwipe ---------------------------------------------------------

test("resolveSwipe: left past threshold -> next (+1)", () => {
  expect(resolveSwipe(-0.3 * WIDTH, 0, WIDTH, 0.22, 0.45)).toBe(1);
});
test("resolveSwipe: right past threshold -> prev (-1)", () => {
  expect(resolveSwipe(0.3 * WIDTH, 0, WIDTH, 0.22, 0.45)).toBe(-1);
});
test("resolveSwipe: short drag springs back (0)", () => {
  expect(resolveSwipe(-0.1 * WIDTH, 0, WIDTH, 0.22, 0.45)).toBe(0);
});
test("resolveSwipe: fast left fling turns even on tiny displacement", () => {
  expect(resolveSwipe(-20, -0.8, WIDTH, 0.22, 0.45)).toBe(1);
});
test("resolveSwipe: fling wins over displacement (flick-back cancels a long drag)", () => {
  // Dragged far left, then flicked right on release -> prev, not next.
  expect(resolveSwipe(-0.4 * WIDTH, 0.6, WIDTH, 0.22, 0.45)).toBe(-1);
});

// --- edgeOf ---------------------------------------------------------------

test("edgeOf: near left / right / middle", () => {
  expect(edgeOf(10, WIDTH, 32)).toBe("left");
  expect(edgeOf(WIDTH - 5, WIDTH, 32)).toBe("right");
  expect(edgeOf(WIDTH / 2, WIDTH, 32)).toBeNull();
});

// --- machine: pointer-tool swipe turns page -------------------------------

test("horizontal swipe left captures, follows the finger, commits next", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 360, y: 402, t: 16 }, // past slop, horizontal
      { type: "pointermove", id: 1, x: 200, y: 404, t: 60 }, // dragged well left
      { type: "pointerup", id: 1, x: 200, y: 404, t: 76 },
    ],
    base(),
  );
  expect(types(commands)).toContain("capture");
  const drags = commands.filter((c) => c.type === "dragMove");
  expect(drags.length).toBeGreaterThan(0);
  // Follows the finger: dx is negative and grows.
  expect((drags[drags.length - 1] as { dx: number }).dx).toBeLessThan(-100);
  const end = commands.find((c) => c.type === "dragEnd") as { turn: number };
  expect(end.turn).toBe(1);
});

test("short horizontal drag springs back (turn 0)", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 380, y: 401, t: 16 },
      { type: "pointermove", id: 1, x: 360, y: 402, t: 400 }, // slow, small, no fling
      { type: "pointerup", id: 1, x: 360, y: 402, t: 800 },
    ],
    base(),
  );
  const end = commands.find((c) => c.type === "dragEnd") as { turn: number };
  expect(end.turn).toBe(0);
});

// --- machine: taps and vertical drags stay hands-off ----------------------

test("a tap emits nothing (native click passes through)", () => {
  const { state, commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointerup", id: 1, x: 401, y: 400, t: 40 },
    ],
    base(),
  );
  expect(commands.length).toBe(0);
  expect(state.phase).toBe("idle");
});

test("vertical drag at fit-page goes hands-off, never captures", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 402, y: 360, t: 16 },
      { type: "pointermove", id: 1, x: 404, y: 240, t: 60 },
      { type: "pointerup", id: 1, x: 404, y: 240, t: 76 },
    ],
    base(),
  );
  expect(commands.length).toBe(0);
});

test("long press hands off to native selection; a later drag does not turn", () => {
  const { state, commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "longpress", id: 1 },
      { type: "pointermove", id: 1, x: 300, y: 400, t: 500 }, // handle drag
      { type: "pointerup", id: 1, x: 300, y: 400, t: 600 },
    ],
    base(),
  );
  expect(state.phase).toBe("idle");
  expect(commands.length).toBe(0);
});

// --- machine: pen tool ----------------------------------------------------

test("pen tool: one-finger drag in the page body draws (hands-off, no turn)", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 340, y: 402, t: 16 },
      { type: "pointerup", id: 1, x: 340, y: 402, t: 60 },
    ],
    base({ tool: "pen" }),
  );
  expect(commands.length).toBe(0);
});

test("pen tool: edge swipe from the left turns the page", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 12, y: 400, t: 0 }, // inside left edge band
      { type: "pointermove", id: 1, x: 120, y: 402, t: 16 },
      { type: "pointermove", id: 1, x: 320, y: 404, t: 60 }, // dragged right
      { type: "pointerup", id: 1, x: 320, y: 404, t: 76 },
    ],
    base({ tool: "pen" }),
  );
  expect(types(commands)).toContain("capture");
  const end = commands.find((c) => c.type === "dragEnd") as { turn: number };
  expect(end.turn).toBe(-1); // rightward drag -> previous page
});

// --- machine: zoomed-in pans, never turns ---------------------------------

test("zoomed in: one finger pans and never turns a page", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 360, y: 380, t: 16 },
      { type: "pointermove", id: 1, x: 320, y: 360, t: 32 },
      { type: "pointerup", id: 1, x: 320, y: 360, t: 48 },
    ],
    base({ zoomedIn: true }),
  );
  expect(types(commands)).toContain("capture");
  expect(types(commands)).toContain("panMove");
  expect(commands.find((c) => c.type === "dragEnd")).toBeUndefined();
  expect(commands.find((c) => c.type === "dragMove")).toBeUndefined();
});

// --- machine: second finger yields to the engine's pinch ------------------

test("a second finger yields (goes off) and springs an in-flight drag back", () => {
  const { state, commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 340, y: 400, t: 16 }, // drag started
      { type: "pointerdown", id: 2, x: 500, y: 400, t: 24 }, // second finger
    ],
    base(),
  );
  expect(state.phase).toBe("off");
  // The in-flight drag is released as a spring-back, not a turn.
  const end = commands.find((c) => c.type === "dragEnd") as { turn: number };
  expect(end.turn).toBe(0);
});

test("after a two-finger gesture, lifting both fingers resets to idle", () => {
  const { state } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointerdown", id: 2, x: 500, y: 400, t: 8 },
      { type: "pointermove", id: 1, x: 380, y: 400, t: 16 },
      { type: "pointerup", id: 1, x: 380, y: 400, t: 40 },
      { type: "pointerup", id: 2, x: 500, y: 400, t: 48 },
    ],
    base(),
  );
  expect(state.phase).toBe("idle");
  expect(state.order.length).toBe(0);
});
