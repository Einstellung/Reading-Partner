// Headless coverage of the vertical-mode touch gesture state machine
// (src/reading/engine/vertical-gesture.ts): follow-finger scrolling and the
// inertia fling. Pure functions, no DOM, no engine — run with `bun test`.
//
// The cases here are the ones real devices have broken before: a horizontal pan
// leaking through to the drawing layer, the fling running past an edge or never
// stopping, an annotation tool inking under a scrolling finger, and a gesture
// surviving a layout switch or a second finger.

import { test, expect } from "bun:test";
import {
  bandOffsetFor,
  clampScroll,
  flingDecayFactor,
  flingFrom,
  initVerticalState,
  smoothVelocity,
  splitOvershoot,
  stepVertical,
  verticalNeedsFrames,
  VERTICAL_BAND_LIMIT,
  VERTICAL_BAND_OVERSHOOT_CAP,
  VERTICAL_FLING_DECAY,
  VERTICAL_FLING_MIN_SPEED,
  VERTICAL_SCROLL_SLOP,
  VERTICAL_VELOCITY_SMOOTHING,
  type VerticalCommand,
  type VerticalInput,
  type VerticalState,
} from "../../../src/reading/engine/vertical-gesture";
import { pinchHandsOff, planPointer } from "../../../src/reading/engine/touch-routing";

// The four plans that can reach (or be refused by) the machine.
const FINGER = planPointer("none", "touch", false); // no tool: finger scrolls
const ANNOTATE = planPointer("annotate", "touch", false); // tool, finger still scrolls, pauses at down
const DRAW = planPointer("annotate", "touch", true); // "draw with your finger" on: finger draws
const NAVLOCK_PEN = planPointer("navlock", "pen", false); // palm toggle: the stylus is a finger

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
// A lift the host could not position (pointercancel's sibling in the old
// shape). The throw then rests on the moves alone.
const up = (): VerticalInput => ({ type: "pointerup", id: 1 });
// The lift as the host really sends it: the last few px before the finger left
// the glass are part of the throw.
const upAt = (x: number, y: number, t: number): VerticalInput => ({
  type: "pointerup",
  id: 1,
  x,
  y,
  t,
});

// Run every frame the machine still wants — inertia, band spring, or both —
// to a standstill (or give up), returning the frame count.
function coast(state: VerticalState, vp: Viewport, frames = 600): { state: VerticalState; n: number } {
  let n = 0;
  let s = state;
  while (verticalNeedsFrames(s) && n < frames) {
    s = step(s, { type: "flingFrame", dt: 16 }, vp).state;
    n += 1;
  }
  return { state: s, n };
}

// The last band offset a run asked the host to paint.
function lastBand(cmds: VerticalCommand[]): { x: number; y: number } | null {
  for (let i = cmds.length - 1; i >= 0; i -= 1) {
    const c = cmds[i];
    if (c.type === "band") return { x: c.x, y: c.y };
  }
  return null;
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

test("a fling into the bottom edge pins the scroll, bounces, and settles", () => {
  // The throw is released well before the edge so the coast, not the finger,
  // is what arrives there.
  const vp = viewport({ top: 0, maxTop: 60 });
  const r = run([down(100, 300), move(100, 280, 16), move(100, 240, 32), upAt(100, 200, 48)], vp);
  expect(r.state.fling).not.toBeNull();
  const done = coast(r.state, vp);
  expect(vp.top).toBe(60); // the scroll position never leaves the range
  expect(done.state.fling).toBeNull();
  expect(done.state.over).toEqual({ x: 0, y: 0 }); // and the band came home
  expect(done.n).toBeGreaterThan(2); // it bounced rather than stopping dead
  expect(done.n).toBeLessThan(120);
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

// --- rubber band: the ends of the document ----------------------------------

test("splitOvershoot: the scroll position keeps what it can hold, the rest is overshoot", () => {
  expect(splitOvershoot(120, 500)).toEqual({ scroll: 120, over: 0 });
  expect(splitOvershoot(-40, 500)).toEqual({ scroll: 0, over: -40 });
  expect(splitOvershoot(560, 500)).toEqual({ scroll: 500, over: 60 });
});

test("splitOvershoot: an axis with no range at all never bands", () => {
  // A document that fits the screen should sit still, not wobble.
  expect(splitOvershoot(-40, 0)).toEqual({ scroll: 0, over: 0 });
  expect(splitOvershoot(80, 0)).toEqual({ scroll: 0, over: 0 });
});

test("splitOvershoot: the raw overshoot is capped, so the spring is never long", () => {
  // The drawn offset saturates well before the cap; what the cap bounds is how
  // much the spring (and the drag back in) has to undo.
  expect(splitOvershoot(-4000, 500).over).toBe(-VERTICAL_BAND_OVERSHOOT_CAP);
  expect(splitOvershoot(9000, 500).over).toBe(VERTICAL_BAND_OVERSHOOT_CAP);
});

test("bandOffsetFor: opposite the overshoot, damped, and bounded by the limit", () => {
  expect(bandOffsetFor({ x: 0, y: 0 }, VERTICAL_BAND_LIMIT)).toEqual({ x: -0, y: -0 });
  // Pushing the scroll past the bottom moves the content up.
  expect(bandOffsetFor({ x: 0, y: 60 }, VERTICAL_BAND_LIMIT).y).toBeLessThan(0);
  expect(bandOffsetFor({ x: 0, y: -60 }, VERTICAL_BAND_LIMIT).y).toBeGreaterThan(0);
  // Damped: 60px of pull is worth less than 60px of movement.
  expect(Math.abs(bandOffsetFor({ x: 0, y: 60 }, VERTICAL_BAND_LIMIT).y)).toBeLessThan(60);
  // And no pull at all reaches past the limit.
  expect(Math.abs(bandOffsetFor({ x: 0, y: 1e6 }, VERTICAL_BAND_LIMIT).y)).toBeLessThan(
    VERTICAL_BAND_LIMIT,
  );
});

test("pulling past the top pins the scroll at 0 and bands the content instead", () => {
  const vp = viewport({ top: 0 });
  const r = run([down(100, 100), move(100, 200, 16), move(100, 300, 32)], vp);
  expect(vp.top).toBe(0);
  const b = lastBand(r.commands);
  expect(b).not.toBeNull();
  expect(b!.y).toBeGreaterThan(0); // content follows the finger down
  expect(b!.y).toBeLessThan(VERTICAL_BAND_LIMIT);
  expect(r.state.over.y).toBe(-200);
});

test("the band grows with the pull but gives less and less", () => {
  const vp = viewport({ top: 0 });
  const a = run([down(100, 100), move(100, 160, 16)], vp);
  const b = run([move(100, 220, 32)], vp, a.state);
  const first = lastBand(a.commands)!.y;
  const second = lastBand(b.commands)!.y;
  expect(second).toBeGreaterThan(first);
  expect(second - first).toBeLessThan(first); // the second 60px buys less than the first
});

test("dragging back into the document zeroes the band and scrolls again, with no jump", () => {
  const vp = viewport({ top: 0 });
  const pulled = run([down(100, 100), move(100, 260, 16)], vp);
  expect(pulled.state.over.y).toBe(-160);
  // The follow measures a virtual position, so the 160px of pull has to be
  // paid back before the document moves at all.
  const back = run([move(100, 180, 32)], vp, pulled.state);
  expect(vp.top).toBe(0);
  expect(back.state.over.y).toBe(-80);
  const past = run([move(100, 40, 48)], vp, back.state);
  expect(past.state.over).toEqual({ x: 0, y: 0 });
  expect(vp.top).toBe(60); // 100 - 40, measured from the same origin throughout
  expect(lastBand(past.commands)).toEqual({ x: -0, y: -0 });
});

test("a release from inside the band springs home instead of flinging", () => {
  const vp = viewport({ top: 0 });
  const r = run([down(100, 100), move(100, 200, 16), move(100, 300, 32), upAt(100, 400, 48)], vp);
  expect(r.state.fling).toBeNull(); // the band is already holding the motion
  expect(types(r.commands)).toContain("startFling"); // but frames are still owed
  const done = coast(r.state, vp);
  expect(done.state.over).toEqual({ x: 0, y: 0 });
  expect(done.n).toBeGreaterThan(1);
  expect(done.n).toBeLessThan(60);
  expect(vp.top).toBe(0);
});

test("the last band frame paints exactly rest, so the transform is cleared", () => {
  const vp = viewport({ top: 0 });
  const r = run([down(100, 100), move(100, 260, 16), upAt(100, 260, 32)], vp);
  let s = r.state;
  const cmds: VerticalCommand[] = [];
  for (let i = 0; i < 200 && verticalNeedsFrames(s); i += 1) {
    const f = step(s, { type: "flingFrame", dt: 16 }, vp);
    s = f.state;
    cmds.push(...f.commands);
  }
  expect(lastBand(cmds)).toEqual({ x: -0, y: -0 });
  expect(types(cmds)).toContain("stopFling");
});

test("a document with no scroll range never bands, however hard it is pulled", () => {
  const vp = viewport({ top: 0, maxTop: 0, maxLeft: 0 });
  const r = run([down(100, 100), move(100, 400, 16), move(100, 20, 32), upAt(100, 20, 48)], vp);
  expect(types(r.commands)).not.toContain("band");
  expect(r.state.over).toEqual({ x: 0, y: 0 });
});

test("the horizontal axis bands only when it has somewhere to scroll", () => {
  const pinned = viewport({ maxLeft: 0 });
  const scrollable = viewport({ maxLeft: 400 });
  expect(types(run([down(200, 100), move(400, 100, 16)], pinned).commands)).not.toContain("band");
  const r = run([down(200, 100), move(400, 100, 16)], scrollable);
  expect(lastBand(r.commands)!.x).toBeGreaterThan(0);
});

test("a fling into the top edge bounces back to exactly rest", () => {
  // Released while there is still room, so it is the coast that reaches the
  // top, not the finger.
  const vp = viewport({ top: 400, maxTop: 5000 });
  const r = run([down(100, 100), move(100, 150, 16), move(100, 250, 32), upAt(100, 350, 48)], vp);
  expect(r.state.fling).not.toBeNull();
  const done = coast(r.state, vp);
  expect(vp.top).toBe(0);
  expect(done.state.over).toEqual({ x: 0, y: 0 });
});

test("a faster fling into the edge pulls the band out further", () => {
  const slow = viewport({ top: 0, maxTop: 40 });
  const fast = viewport({ top: 0, maxTop: 40 });
  const slowRun = run([down(100, 300), move(100, 292, 16), upAt(100, 284, 32)], slow);
  const fastRun = run([down(100, 300), move(100, 260, 16), upAt(100, 220, 32)], fast);
  const peak = (from: VerticalState, vp: Viewport) => {
    let s = from;
    let max = 0;
    for (let i = 0; i < 200 && verticalNeedsFrames(s); i += 1) {
      s = step(s, { type: "flingFrame", dt: 16 }, vp).state;
      max = Math.max(max, Math.abs(s.over.y));
    }
    return max;
  };
  expect(peak(fastRun.state, fast)).toBeGreaterThan(peak(slowRun.state, slow));
});

test("reset while banded tells the host to drop the offset", () => {
  const vp = viewport({ top: 0 });
  const pulled = run([down(100, 100), move(100, 260, 16)], vp);
  const r = run([{ type: "reset" }], vp, pulled.state);
  expect(r.commands).toContainEqual({ type: "band", x: 0, y: 0 });
  expect(r.state.over).toEqual({ x: 0, y: 0 });
});

test("cancelFling drops the inertia but still brings the band home", () => {
  const vp = viewport({ top: 0, maxTop: 40 });
  const flung = run([down(100, 300), move(100, 260, 16), upAt(100, 220, 32)], vp);
  const banded = step(flung.state, { type: "flingFrame", dt: 16 }, vp).state;
  expect(banded.over.y).not.toBe(0);
  const r = run([{ type: "cancelFling" }], vp, banded.state);
  expect(r.state.fling).toBeNull();
  expect(types(r.commands)).not.toContain("stopFling"); // frames are still owed
  expect(coast(r.state, vp).state.over).toEqual({ x: 0, y: 0 });
});

// --- release velocity -------------------------------------------------------

test("smoothVelocity: the quoted weight is the weight at one 16ms frame", () => {
  expect(smoothVelocity(1, 0, VERTICAL_VELOCITY_SMOOTHING, 16)).toBeCloseTo(0.3, 10);
  expect(smoothVelocity(0, 1, VERTICAL_VELOCITY_SMOOTHING, 16)).toBeCloseTo(0.7, 10);
});

test("smoothVelocity: independent of the sample rate", () => {
  const once = smoothVelocity(1, 0, VERTICAL_VELOCITY_SMOOTHING, 16);
  const twice = smoothVelocity(smoothVelocity(1, 0, VERTICAL_VELOCITY_SMOOTHING, 8), 0, VERTICAL_VELOCITY_SMOOTHING, 8);
  expect(twice).toBeCloseTo(once, 10);
});

test("smoothVelocity: a long gap all but replaces the history", () => {
  expect(smoothVelocity(5, 0, VERTICAL_VELOCITY_SMOOTHING, 1000)).toBeCloseTo(0, 6);
});

test("one jittery sample does not decide how far the throw goes", () => {
  // The same steady drag, one sample of which stalls and the next of which
  // catches up. Total displacement is identical; the release velocity has to be
  // too. Taking the last sample raw would have made the throw twice as long.
  const steady = viewport({ top: 2000 });
  const jittery = viewport({ top: 2000 });
  const a = run(
    [
      down(100, 500),
      move(100, 480, 16),
      move(100, 460, 32),
      move(100, 440, 48),
      move(100, 420, 64),
      move(100, 400, 80),
      upAt(100, 380, 96),
    ],
    steady,
  );
  const b = run(
    [
      down(100, 500),
      move(100, 480, 16),
      move(100, 460, 32),
      move(100, 460, 48), // the sample that stalled
      move(100, 420, 64), // and the one that caught up
      move(100, 400, 80),
      upAt(100, 380, 96),
    ],
    jittery,
  );
  const ay = a.state.fling!.vy;
  const by = b.state.fling!.vy;
  expect(Math.abs(by - ay) / ay).toBeLessThan(0.1);
});

test("the movement between the last sample and the lift counts towards the throw", () => {
  const withLift = viewport({ top: 2000 });
  const without = viewport({ top: 2000 });
  const a = run([down(100, 400), move(100, 380, 16), upAt(100, 300, 32)], withLift);
  const b = run([down(100, 400), move(100, 380, 16), upAt(100, 380, 32)], without);
  expect(a.state.fling!.vy).toBeGreaterThan(b.state.fling!.vy * 2);
});

test("a finger that stops before lifting does not fling", () => {
  const vp = viewport({ top: 2000 });
  const r = run([down(100, 400), move(100, 300, 16), move(100, 299, 400), upAt(100, 299, 500)], vp);
  expect(r.state.fling).toBeNull();
  expect(types(r.commands)).not.toContain("startFling");
});

// --- taking over content that is still moving --------------------------------

test("a finger landing on a live coast follows it at once, with no slop", () => {
  const vp = viewport({ top: 2000 });
  const flung = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), upAt(100, 120, 48)], vp);
  const grab = run([down(100, 400, 100)], vp, flung.state);
  expect(grab.state.phase).toBe("scroll");
  expect(types(grab.commands)).toEqual(["stopFling", "pause", "dropSelection", "capture"]);
  // A move smaller than the slop already scrolls.
  const top = vp.top;
  run([move(100, 398, 116)], vp, grab.state);
  expect(vp.top).toBe(top + 2);
});

test("a finger landing on a coast that is all but over is still an ordinary tap", () => {
  const vp = viewport({ top: 2000 });
  // Released just above the coast threshold, then left to decay to a crawl.
  const flung = run([down(100, 300), move(100, 299, 16), upAt(100, 298, 32)], vp);
  const slowed = coast(flung.state, vp);
  const tap = run([down(100, 400, 900)], vp, slowed.state);
  expect(tap.state.phase).toBe("pending");
  expect(tap.commands).toEqual([]);
});

test("a finger landing on a bouncing document picks the band up where it was", () => {
  const vp = viewport({ top: 0 });
  const pulled = run([down(100, 100), move(100, 260, 16), upAt(100, 260, 32)], vp);
  const springing = step(pulled.state, { type: "flingFrame", dt: 16 }, vp).state;
  expect(springing.over.y).toBeLessThan(0);
  const grab = run([down(100, 500, 100)], vp, springing);
  expect(grab.state.phase).toBe("scroll");
  // Holding still leaves the band exactly where the spring had got to: the
  // content does not snap out from under the finger.
  const held = run([move(100, 500, 116)], vp, grab.state);
  expect(held.state.over.y).toBe(springing.over.y);
  expect(types(held.commands)).not.toContain("band");
});

test("a pointer planned as draw never takes a coast over", () => {
  const vp = viewport({ top: 2000 });
  const flung = run([down(100, 300), move(100, 280, 16), move(100, 200, 32), upAt(100, 120, 48)], vp);
  const r = run([down(100, 400, 100, DRAW)], vp, flung.state);
  expect(r.commands).toEqual([]);
  expect(r.state.fling).not.toBeNull();
});

// --- the finger a pinch leaves behind ----------------------------------------

test("pinchHandsOff: only when a multi-finger gesture comes down to one live finger", () => {
  expect(pinchHandsOff(true, 1, false)).toBe(true);
  expect(pinchHandsOff(true, 2, false)).toBe(false); // 3 -> 2 is still a pinch
  expect(pinchHandsOff(true, 0, false)).toBe(false); // the glass emptied
  expect(pinchHandsOff(false, 1, false)).toBe(false); // never was a pinch
  expect(pinchHandsOff(true, 1, true)).toBe(false); // a pen holds it dead
});

test("an explicit takeover follows from the finger's current position, no slop", () => {
  const vp = viewport({ top: 900 });
  const r = run(
    [{ type: "pointerdown", id: 1, x: 100, y: 300, t: 0, plan: FINGER, takeover: true }],
    vp,
  );
  expect(r.state.phase).toBe("scroll");
  expect(types(r.commands)).toEqual(["pause", "dropSelection", "capture"]);
  run([move(100, 297, 16)], vp, r.state);
  expect(vp.top).toBe(903); // 3px of movement, 3px of scroll
});

test("a takeover under an annotation tool pauses the engine once, at down", () => {
  const vp = viewport({ top: 900 });
  const r = run(
    [{ type: "pointerdown", id: 1, x: 100, y: 300, t: 0, plan: ANNOTATE, takeover: true }],
    vp,
  );
  expect(types(r.commands)).toEqual(["pause", "dropSelection", "capture"]);
  expect(r.state.phase).toBe("scroll");
});
