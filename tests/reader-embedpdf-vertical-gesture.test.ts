// Headless coverage of the vertical-mode touch gesture state machine
// (src/reader-embedpdf/vertical-gesture.ts): follow-finger scrolling and the
// inertia fling. Pure functions, no DOM, no engine — run with `bun test`.
//
// The cases here are the ones real devices have broken before: a horizontal pan
// leaking through to the drawing layer, the fling running past an edge or never
// stopping, an annotation tool inking under a scrolling finger, and a gesture
// surviving a layout switch or a second finger.

import { test, expect } from "bun:test";
import {
  clampScroll,
  flingDecayFactor,
  flingFrom,
  initVerticalState,
  stepVertical,
  VERTICAL_FLING_DECAY,
  VERTICAL_FLING_MIN_SPEED,
  VERTICAL_SCROLL_SLOP,
  type VerticalCommand,
  type VerticalInput,
  type VerticalState,
} from "../src/reader-embedpdf/vertical-gesture";
import { planPointer } from "../src/reader-embedpdf/touch-routing";

// The four plans that can reach (or be refused by) the machine.
const FINGER = planPointer("none", "touch", true); // no tool: finger scrolls
const ANNOTATE = planPointer("annotate", "touch", true); // tool + stylus seen: scrolls, pauses at down
const DRAW = planPointer("annotate", "touch", false); // stylus-less device: finger draws
const NAVLOCK_PEN = planPointer("navlock", "pen", true); // palm toggle: the stylus is a finger

// A stand-in scroll container: the machine reads its geometry, the harness
// writes back every scrollTo, exactly as the host does on the real element.
interface Viewport {
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
}
const viewport = (over: Partial<Viewport> = {}): Viewport => ({
  top: 0,
  left: 0,
  maxTop: 5000,
  maxLeft: 0,
  ...over,
});

function step(
  state: VerticalState,
  input: VerticalInput,
  vp: Viewport,
): { state: VerticalState; commands: VerticalCommand[] } {
  const r = stepVertical(state, input, {
    scrollTop: vp.top,
    scrollLeft: vp.left,
    maxScrollTop: vp.maxTop,
    maxScrollLeft: vp.maxLeft,
  });
  for (const c of r.commands) {
    if (c.type === "scrollTo") {
      vp.top = c.top;
      vp.left = c.left;
    }
  }
  return r;
}

// Drive a whole sequence, collecting every command.
function run(
  inputs: VerticalInput[],
  vp: Viewport,
  from: VerticalState = initVerticalState(),
): { state: VerticalState; commands: VerticalCommand[] } {
  let state = from;
  const commands: VerticalCommand[] = [];
  for (const input of inputs) {
    const r = step(state, input, vp);
    state = r.state;
    commands.push(...r.commands);
  }
  return { state, commands };
}

const types = (cmds: VerticalCommand[]) => cmds.map((c) => c.type);
const down = (x: number, y: number, t = 0, plan = FINGER): VerticalInput => ({
  type: "pointerdown",
  id: 1,
  x,
  y,
  t,
  plan,
});
const move = (x: number, y: number, t: number): VerticalInput => ({
  type: "pointermove",
  id: 1,
  x,
  y,
  t,
});
const up = (): VerticalInput => ({ type: "pointerup", id: 1 });

// Coast to a standstill (or give up), returning the frame count.
function coast(state: VerticalState, vp: Viewport, frames = 600): { state: VerticalState; n: number } {
  let n = 0;
  let s = state;
  while (s.fling && n < frames) {
    s = step(s, { type: "flingFrame", dt: 16 }, vp).state;
    n += 1;
  }
  return { state: s, n };
}

// --- helpers ---------------------------------------------------------------

test("clampScroll: pins to the range, and to 0 when there is no room", () => {
  expect(clampScroll(-40, 500)).toBe(0);
  expect(clampScroll(900, 500)).toBe(500);
  expect(clampScroll(120, 500)).toBe(120);
  expect(clampScroll(120, 0)).toBe(0);
  expect(clampScroll(120, -10)).toBe(0);
});

test("flingFrom: the scroll coasts opposite the finger", () => {
  expect(flingFrom(0, -1.2, VERTICAL_FLING_MIN_SPEED)).toEqual({ vx: -0, vy: 1.2 });
});

test("flingFrom: a slow release does not coast at all", () => {
  expect(flingFrom(0.01, -0.01, VERTICAL_FLING_MIN_SPEED)).toBeNull();
});

test("flingFrom: one fast axis is enough", () => {
  expect(flingFrom(0.01, -0.9, VERTICAL_FLING_MIN_SPEED)).not.toBeNull();
});

test("flingDecayFactor: quoted per 16ms frame, independent of the frame rate", () => {
  expect(flingDecayFactor(0.95, 16)).toBeCloseTo(0.95, 10);
  // Two 8ms frames must shed exactly as much as one 16ms frame.
  expect(flingDecayFactor(0.95, 8) ** 2).toBeCloseTo(flingDecayFactor(0.95, 16), 10);
});

// --- commit: any direction past the slop -----------------------------------

test("no capture, no pause, no scroll before the slop is passed", () => {
  const vp = viewport();
  const r = run([down(100, 100), move(102, 103, 16), move(104, 105, 32)], vp);
  expect(r.commands).toEqual([]);
  expect(r.state.phase).toBe("pending");
  expect(vp.top).toBe(0);
});

test("a purely horizontal move past the slop commits the scroll (never falls through to drawing)", () => {
  const vp = viewport({ maxLeft: 400 });
  const r = run([down(100, 100), move(100 - VERTICAL_SCROLL_SLOP, 100, 16)], vp);
  expect(types(r.commands)).toEqual(["pause", "dropSelection", "capture", "scrollTo", "preventDefault"]);
  expect(r.state.phase).toBe("scroll");
});

test("a purely vertical move past the slop commits the scroll", () => {
  const vp = viewport();
  const r = run([down(100, 100), move(100, 100 - VERTICAL_SCROLL_SLOP, 16)], vp);
  expect(types(r.commands)).toContain("capture");
  expect(r.state.phase).toBe("scroll");
});

test("a diagonal move under the slop on both axes stays pending", () => {
  const vp = viewport();
  const r = run([down(100, 100), move(104, 104, 16)], vp);
  expect(r.commands).toEqual([]);
  expect(r.state.phase).toBe("pending");
});

test("the pause comes before the selection drop and the capture", () => {
  const vp = viewport();
  const r = run([down(100, 100), move(100, 80, 16)], vp);
  expect(types(r.commands).slice(0, 3)).toEqual(["pause", "dropSelection", "capture"]);
  expect(r.commands.find((c) => c.type === "capture")).toEqual({ type: "capture", id: 1 });
});

// --- follow-finger scrolling ------------------------------------------------

test("the follow measures from the scroll position latched at pointerdown", () => {
  const vp = viewport({ top: 300 });
  run([down(100, 200), move(100, 150, 16), move(100, 120, 32)], vp);
  expect(vp.top).toBe(300 + 80); // finger up 80px -> content down 80px
});

test("horizontal follow moves scrollLeft when the container can scroll sideways", () => {
  const vp = viewport({ maxLeft: 400 });
  run([down(200, 100), move(160, 100, 16)], vp);
  expect(vp.left).toBe(40);
  expect(vp.top).toBe(0);
});

test("horizontal follow is pinned when there is nothing to scroll sideways", () => {
  const vp = viewport({ maxLeft: 0 });
  run([down(200, 200), move(120, 160, 16)], vp);
  expect(vp.left).toBe(0); // no room: the axis holds still
  expect(vp.top).toBe(40); // the vertical axis still follows
});

test("the follow clamps at both ends and does not accumulate the clamp", () => {
  const vp = viewport({ top: 20, maxTop: 500 });
  const r = run([down(100, 100), move(100, 400, 16)], vp);
  expect(vp.top).toBe(0); // pushed past the top
  // Coming back the other way still measures from the pointerdown origin.
  run([move(100, 60, 32)], vp, r.state);
  expect(vp.top).toBe(60);
});

test("every follow frame asks the host to preventDefault", () => {
  const vp = viewport();
  const r = run([down(100, 100), move(100, 80, 16), move(100, 60, 32)], vp);
  expect(types(r.commands).filter((t) => t === "preventDefault").length).toBe(2);
});

// --- release: pause / capture handed back ----------------------------------

test("release resumes the engine and releases the captured pointer", () => {
  const vp = viewport();
  const r = run([down(100, 100), move(100, 80, 16), up()], vp);
  const release = r.commands.find((c) => c.type === "releaseCapture");
  expect(release).toEqual({ type: "releaseCapture", id: 1 });
  expect(types(r.commands)).toContain("resume");
  expect(r.state.phase).toBe("idle");
  expect(r.state.capturedId).toBeNull();
});

test("a tap that never committed still resumes, and releases nothing", () => {
  const vp = viewport();
  const r = run([down(100, 100), up()], vp);
  expect(types(r.commands)).toEqual(["resume", "releaseCapture"]);
  expect(r.commands.find((c) => c.type === "releaseCapture")).toEqual({
    type: "releaseCapture",
    id: null,
  });
});

test("events from a pointer the machine is not following are ignored", () => {
  const vp = viewport();
  const r = run(
    [
      down(100, 100),
      { type: "pointermove", id: 2, x: 100, y: 20, t: 16 },
      { type: "pointerup", id: 2 },
    ],
    vp,
  );
  expect(r.commands).toEqual([]);
  expect(r.state.phase).toBe("pending");
  expect(vp.top).toBe(0);
});

// --- fling ------------------------------------------------------------------

test("a slow release does not fling", () => {
  const vp = viewport();
  const r = run([down(100, 300), move(100, 280, 16), move(100, 279, 1016), up()], vp);
  expect(types(r.commands)).not.toContain("startFling");
  expect(r.state.fling).toBeNull();
});

test("a fast release flings, decays and stops on its own", () => {
  const vp = viewport({ top: 2000 });
  const r = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), up()], vp);
  expect(types(r.commands)).toContain("startFling");
  expect(r.state.fling).not.toBeNull();
  const before = vp.top;
  const first = step(r.state, { type: "flingFrame", dt: 16 }, vp);
  const firstStep = vp.top - before;
  expect(firstStep).toBeGreaterThan(0);
  const second = step(first.state, { type: "flingFrame", dt: 16 }, vp);
  const secondStep = vp.top - (before + firstStep);
  // Each frame carries less than the one before it.
  expect(secondStep).toBeLessThan(firstStep);
  expect(secondStep / firstStep).toBeCloseTo(VERTICAL_FLING_DECAY, 6);
  const done = coast(second.state, vp);
  expect(done.state.fling).toBeNull();
  expect(done.n).toBeGreaterThan(10);
  expect(done.n).toBeLessThan(200);
});

test("the last fling frame tells the host to stop the loop", () => {
  const vp = viewport({ top: 2000 });
  let s = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), up()], vp).state;
  let stops = 0;
  for (let i = 0; i < 600 && s.fling; i += 1) {
    const r = step(s, { type: "flingFrame", dt: 16 }, vp);
    s = r.state;
    stops += types(r.commands).filter((t) => t === "stopFling").length;
  }
  expect(stops).toBe(1);
});

test("a diagonal fling coasts on both axes", () => {
  const vp = viewport({ top: 2000, left: 200, maxLeft: 400 });
  const r = run([down(300, 300), move(280, 280, 16), move(200, 200, 32)], vp);
  const after = run([up()], vp, r.state);
  expect(after.state.fling).not.toBeNull();
  const before = { top: vp.top, left: vp.left };
  coast(after.state, vp);
  expect(vp.top).toBeGreaterThan(before.top);
  expect(vp.left).toBeGreaterThan(before.left);
});

test("a fling stops at the bottom edge instead of grinding there", () => {
  const vp = viewport({ top: 190, maxTop: 200 });
  const r = run([down(100, 300), move(100, 280, 16), move(100, 100, 32), up()], vp);
  const done = coast(r.state, vp);
  expect(vp.top).toBe(200);
  expect(done.state.fling).toBeNull();
  expect(done.n).toBeLessThan(5); // it hits the edge almost immediately
});

test("an axis stuck at its edge does not stop the axis that still has room", () => {
  // No horizontal room at all, a diagonal throw: the vertical coast must survive
  // the horizontal axis being stuck from the first frame.
  const vp = viewport({ top: 1000, maxLeft: 0 });
  const r = run([down(300, 300), move(280, 280, 16), move(200, 200, 32), up()], vp);
  const done = coast(r.state, vp);
  expect(vp.left).toBe(0);
  expect(vp.top).toBeGreaterThan(1000);
  expect(done.n).toBeGreaterThan(10);
});

test("a fling with nowhere to go on either axis ends on its first frame", () => {
  const vp = viewport({ top: 0, maxTop: 0, maxLeft: 0 });
  const r = run([down(100, 300), move(100, 280, 16), move(100, 100, 32), up()], vp);
  const one = step(r.state, { type: "flingFrame", dt: 16 }, vp);
  expect(one.state.fling).toBeNull();
  expect(types(one.commands)).toContain("stopFling");
});

test("pointercancel never flings", () => {
  const vp = viewport({ top: 2000 });
  const r = run(
    [down(100, 300), move(100, 280, 16), move(100, 200, 32), { type: "pointercancel", id: 1 }],
    vp,
  );
  expect(types(r.commands)).not.toContain("startFling");
  expect(r.state.fling).toBeNull();
});

test("a new scroll pointer landing stops the coast", () => {
  const vp = viewport({ top: 2000 });
  const flung = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), up()], vp);
  const next = run([down(100, 400, 100)], vp, flung.state);
  expect(types(next.commands)).toContain("stopFling");
  expect(next.state.fling).toBeNull();
  expect(next.state.phase).toBe("pending");
});

test("cancelFling drops the coast and touches nothing else", () => {
  const vp = viewport({ top: 2000 });
  const flung = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), up()], vp);
  const r = run([{ type: "cancelFling" }], vp, flung.state);
  expect(types(r.commands)).toEqual(["stopFling"]);
  expect(r.state.fling).toBeNull();
  // Nothing left to cancel: no second stop goes out.
  expect(run([{ type: "cancelFling" }], vp, r.state).commands).toEqual([]);
});

// --- tool and device routing ------------------------------------------------

test("an annotation tool pauses the engine at pointerdown, before any movement", () => {
  const vp = viewport();
  const r = run([down(100, 100, 0, ANNOTATE)], vp);
  expect(types(r.commands)).toEqual(["pause"]);
});

test("with no tool the pause waits for the commit, so a stationary tap reaches the engine", () => {
  const vp = viewport();
  const r = run([down(100, 100, 0, FINGER), up()], vp);
  expect(types(r.commands)).not.toContain("pause");
});

test("a pointer planned as draw never enters the machine", () => {
  const vp = viewport();
  const r = run([down(100, 100, 0, DRAW), move(100, 20, 16), up()], vp);
  expect(r.commands).toEqual([]);
  expect(r.state).toEqual(initVerticalState());
  expect(vp.top).toBe(0);
});

test("a draw pointer landing does not stop a coast in flight", () => {
  // Current behaviour, kept deliberately: the draw branch returns before the
  // machine sees anything. Only reachable if the tool changes mid-fling.
  const vp = viewport({ top: 2000 });
  const flung = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), up()], vp);
  const r = run([down(100, 400, 100, DRAW)], vp, flung.state);
  expect(r.commands).toEqual([]);
  expect(r.state.fling).not.toBeNull();
});

test("under the navigation lock a stylus is routed exactly like a finger", () => {
  const pen = viewport();
  const finger = viewport();
  const penRun = run([down(100, 300, 0, NAVLOCK_PEN), move(100, 260, 16), up()], pen);
  const fingerRun = run([down(100, 300, 0, FINGER), move(100, 260, 16), up()], finger);
  expect(penRun.commands).toEqual(fingerRun.commands);
  expect(pen).toEqual(finger);
});

// --- takeover and layout switch ---------------------------------------------

test("reset drops an in-flight scroll: capture released, engine resumed, phase idle", () => {
  const vp = viewport();
  const scrolling = run([down(100, 300), move(100, 260, 16)], vp);
  const r = run([{ type: "reset" }], vp, scrolling.state);
  expect(types(r.commands)).toEqual(["stopFling", "resume", "releaseCapture"]);
  expect(r.commands.find((c) => c.type === "releaseCapture")).toEqual({
    type: "releaseCapture",
    id: 1,
  });
  expect(r.state).toEqual(initVerticalState());
});

test("after a takeover the abandoned pointer moves nothing, and its up emits nothing", () => {
  const vp = viewport();
  const scrolling = run([down(100, 300), move(100, 260, 16)], vp);
  const taken = run([{ type: "reset" }], vp, scrolling.state);
  const top = vp.top;
  const after = run([move(100, 100, 32), up()], vp, taken.state);
  expect(after.commands).toEqual([]);
  expect(vp.top).toBe(top);
});

test("the finger that outlives a takeover starts a fresh gesture, not the old one", () => {
  const vp = viewport();
  const scrolling = run([down(100, 300), move(100, 260, 16)], vp);
  const taken = run([{ type: "reset" }], vp, scrolling.state);
  const fresh = run([down(100, 500, 100), move(100, 460, 116)], vp, taken.state);
  expect(types(fresh.commands)).toContain("capture");
  expect(fresh.state.startScrollTop).toBe(vp.top - 40); // measured from the takeover position
});

test("a layout switch drops a coast in flight", () => {
  const vp = viewport({ top: 2000 });
  const flung = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), up()], vp);
  const r = run([{ type: "reset" }], vp, flung.state);
  expect(types(r.commands)).toContain("stopFling");
  expect(r.state.fling).toBeNull();
});

test("reset on an idle machine is harmless and idempotent", () => {
  const vp = viewport();
  const a = run([{ type: "reset" }], vp);
  const b = run([{ type: "reset" }], vp, a.state);
  expect(a.state).toEqual(initVerticalState());
  expect(b.state).toEqual(initVerticalState());
  expect(types(b.commands)).toEqual(["stopFling", "resume", "releaseCapture"]);
});
