// Headless coverage of the paged-mode touch gesture state machine
// (src/reader-embedpdf/paged-gesture.ts) and the rubber band it hands the host
// (src/reader-embedpdf/rubber-band.ts). Pure functions, no DOM, no engine —
// run with `bun test`. Mirrors the style of tests/reader-embedpdf-convert.test.ts.

import { test, expect } from "bun:test";
import {
  accumulateEdgePull,
  canTurn,
  edgeOf,
  initGestureState,
  lockAxis,
  pageCenterAlign,
  resolveSwipe,
  rubberBand,
  stepGesture,
  turnDirection,
  type GestureCommand,
  type GestureInput,
  type GestureState,
  type PagedGestureConfig,
} from "../src/reader-embedpdf/paged-gesture";
import {
  BAND_SPRING_DECAY,
  BAND_SPRING_MIN_PX,
  bandAtRest,
  bandTransform,
  stepBandSpring,
} from "../src/reader-embedpdf/rubber-band";

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

test("vertical drag at fit-page rubber-bands and springs back, never turns", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 402, y: 360, t: 16 },
      { type: "pointermove", id: 1, x: 404, y: 240, t: 60 },
      { type: "pointerup", id: 1, x: 404, y: 240, t: 76 },
    ],
    base(),
  );
  expect(types(commands)).toContain("capture");
  const bands = commands.filter((c) => c.type === "bandMove") as { dx: number; dy: number }[];
  expect(bands.length).toBeGreaterThan(0);
  // Follows the finger upward, damped and only on the locked axis.
  expect(bands[bands.length - 1].dy).toBeLessThan(0);
  expect(bands[bands.length - 1].dy).toBeGreaterThan(-48);
  expect(bands[bands.length - 1].dx).toBe(0);
  expect(types(commands)).toContain("bandEnd");
  expect(commands.find((c) => c.type === "dragEnd")).toBeUndefined();
  expect(commands.find((c) => c.type === "dragMove")).toBeUndefined();
});

test("the vertical band is captured, so a swipe never reaches the text layer", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 400, y: 340, t: 16 },
    ],
    base(),
  );
  expect(types(commands)[0]).toBe("capture");
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

// --- rubber band ----------------------------------------------------------

test("rubberBand: no offset at rest, damped and bounded by the limit", () => {
  expect(rubberBand(0, 48)).toBe(0);
  expect(rubberBand(48, 48)).toBeCloseTo(24, 6);
  expect(rubberBand(480, 48)).toBeLessThan(48);
  expect(rubberBand(4800, 48)).toBeLessThan(48);
  expect(rubberBand(1e6, 48)).toBeGreaterThan(47);
});

test("rubberBand: keeps the finger's direction and grows with it", () => {
  expect(rubberBand(-60, 48)).toBeLessThan(0);
  expect(rubberBand(-60, 48)).toBe(-rubberBand(60, 48));
  expect(rubberBand(30, 48)).toBeLessThan(rubberBand(60, 48));
  expect(rubberBand(30, 0)).toBe(0);
});

// --- turn availability ----------------------------------------------------

test("turnDirection: finger left asks for the next page, right for the previous", () => {
  expect(turnDirection(-40)).toBe(1);
  expect(turnDirection(40)).toBe(-1);
});

test("canTurn: reads the side the drag is asking for", () => {
  expect(canTurn(1, { canTurnPrev: true, canTurnNext: false })).toBe(false);
  expect(canTurn(1, { canTurnPrev: false, canTurnNext: true })).toBe(true);
  expect(canTurn(-1, { canTurnPrev: false, canTurnNext: true })).toBe(false);
});

test("on the last page a leftward swipe bands instead of turning", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 340, y: 402, t: 16 },
      { type: "pointermove", id: 1, x: 120, y: 404, t: 60 },
      { type: "pointerup", id: 1, x: 120, y: 404, t: 76 },
    ],
    base({ canTurnNext: false }),
  );
  const bands = commands.filter((c) => c.type === "bandMove") as { dx: number; dy: number }[];
  expect(bands.length).toBeGreaterThan(0);
  expect(bands[bands.length - 1].dx).toBeLessThan(0);
  expect(bands[bands.length - 1].dx).toBeGreaterThan(-48); // damped, not the raw -280
  expect(types(commands)).toContain("bandEnd");
  expect(commands.find((c) => c.type === "dragEnd")).toBeUndefined();
});

test("on the first page a rightward swipe bands; the other direction still turns", () => {
  const cfg = base({ canTurnPrev: false });
  const backwards = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 460, y: 400, t: 16 },
      { type: "pointerup", id: 1, x: 460, y: 400, t: 60 },
    ],
    cfg,
  );
  expect(types(backwards.commands)).toContain("bandMove");
  const forwards = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 340, y: 400, t: 16 },
      { type: "pointermove", id: 1, x: 150, y: 400, t: 60 },
      { type: "pointerup", id: 1, x: 150, y: 400, t: 76 },
    ],
    cfg,
  );
  expect((forwards.commands.find((c) => c.type === "dragEnd") as { turn: number }).turn).toBe(1);
});

test("a flick back towards a page that does not exist springs back instead", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 200, y: 400, t: 16 }, // dragged far left
      { type: "pointermove", id: 1, x: 260, y: 400, t: 24 }, // flicked back right
      { type: "pointerup", id: 1, x: 300, y: 400, t: 30 },
    ],
    base({ canTurnPrev: false }),
  );
  const end = commands.find((c) => c.type === "dragEnd") as { turn: number };
  expect(end.turn).toBe(0);
});

// --- zoomed: pan to the edge, then turn -----------------------------------

test("zoomed in: panning with room left never turns", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 340, y: 400, t: 16 },
      { type: "pointermove", id: 1, x: 200, y: 400, t: 32 },
      { type: "pointermove", id: 1, x: 60, y: 400, t: 48 },
    ],
    base({ zoomedIn: true }),
  );
  expect(commands.find((c) => c.type === "dragEnd")).toBeUndefined();
  expect(types(commands)).toContain("panMove");
});

test("zoomed in: pulling past the right edge turns to the next page", () => {
  const { state, commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 360, y: 400, t: 16 },
      { type: "pointermove", id: 1, x: 320, y: 400, t: 32 },
      { type: "pointermove", id: 1, x: 260, y: 400, t: 48 }, // 100px of pull, past 60
    ],
    base({ zoomedIn: true, canPanRight: false }),
  );
  const end = commands.find((c) => c.type === "dragEnd") as { turn: number };
  expect(end.turn).toBe(1);
  expect(state.phase).toBe("off"); // one turn per gesture
});

test("zoomed in: a reversal restarts the edge pull, so a wobble never turns", () => {
  expect(accumulateEdgePull(-40, -30, true)).toBe(-70);
  expect(accumulateEdgePull(-40, 25, true)).toBe(25);
  expect(accumulateEdgePull(-40, -30, false)).toBe(0);
  expect(accumulateEdgePull(0, -12, true)).toBe(-12);
});

test("zoomed in: no page on that side means the edge pull never turns", () => {
  const { commands } = run(
    [
      { type: "pointerdown", id: 1, x: 400, y: 400, t: 0 },
      { type: "pointermove", id: 1, x: 360, y: 400, t: 16 },
      { type: "pointermove", id: 1, x: 240, y: 400, t: 32 },
    ],
    base({ zoomedIn: true, canPanRight: false, canTurnNext: false }),
  );
  expect(commands.find((c) => c.type === "dragEnd")).toBeUndefined();
});

// --- page centring --------------------------------------------------------

test("pageCenterAlign: centres a page narrower than the viewport, 0 once it fills it", () => {
  expect(pageCenterAlign(500, 1000)).toBeCloseTo(25, 6);
  expect(pageCenterAlign(1000, 1000)).toBe(0);
  expect(pageCenterAlign(1600, 1000)).toBe(0);
  expect(pageCenterAlign(0, 1000)).toBe(0);
  expect(pageCenterAlign(500, 0)).toBe(0);
});

// --- rubber band spring (rubber-band.ts) ----------------------------------

test("bandTransform: rest clears the property instead of writing an identity", () => {
  expect(bandTransform({ x: 0, y: 0 })).toBe("");
  expect(bandTransform({ x: -12, y: 0 })).toBe("translate3d(-12px, 0px, 0)");
});

test("stepBandSpring: sheds the quoted fraction per 16ms frame", () => {
  expect(stepBandSpring({ x: 100, y: 0 }, 16).x).toBeCloseTo(100 * BAND_SPRING_DECAY, 6);
  // Two 8ms frames shed as much as one 16ms frame.
  const half = stepBandSpring(stepBandSpring({ x: 100, y: 0 }, 8), 8);
  expect(half.x).toBeCloseTo(stepBandSpring({ x: 100, y: 0 }, 16).x, 6);
});

test("stepBandSpring: snaps to exact rest under the threshold, on both axes at once", () => {
  const nearly = { x: BAND_SPRING_MIN_PX * 0.9, y: BAND_SPRING_MIN_PX * 0.9 };
  expect(stepBandSpring(nearly, 16)).toEqual({ x: 0, y: 0 });
  // One axis still moving keeps the other alive.
  const mixed = stepBandSpring({ x: 40, y: BAND_SPRING_MIN_PX * 0.9 }, 16);
  expect(bandAtRest(mixed)).toBe(false);
});

test("stepBandSpring: always lands, from any offset", () => {
  let o = { x: -220, y: 180 };
  let frames = 0;
  while (!bandAtRest(o) && frames < 200) {
    o = stepBandSpring(o, 16);
    frames += 1;
  }
  expect(bandAtRest(o)).toBe(true);
  expect(frames).toBeLessThan(40);
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
