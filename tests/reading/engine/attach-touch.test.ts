// The touch router's WIRING (src/reading/engine/attach-touch.ts): which element
// the listeners go on, with which passive flags, what the gesture machines'
// commands do to that element, and what the teardown puts back. The physics
// itself is tested next door (vertical-gesture / paged-gesture / rubber-band /
// touch-routing); nothing here re-checks a curve.
//
// There is no DOM in this project's test runner, so the router is attached to a
// hand-written stand-in for the scroll container — the same approach as
// tests/platform/wake-lock.test.ts. That fake is exactly the surface the router
// actually touches: listeners, style, the four scroll numbers, pointer capture
// and the first child the paged band rides on. Frames and timers are driven by
// hand so a fling can be stepped one frame at a time.
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { attachTouchRouter } from "../../../src/reading/engine/attach-touch";
import type { PagedGestureCtx } from "../../../src/reading/engine/types";

// --- the fake glass ---------------------------------------------------------

interface Listener {
  type: string;
  fn: (e: unknown) => void;
  opts: unknown;
}

interface FakeTarget {
  dispatched: { type: string; pointerId: number }[];
  dispatchEvent(e: { type: string; pointerId: number }): boolean;
}

function makeTarget(): FakeTarget {
  const dispatched: { type: string; pointerId: number }[] = [];
  return {
    dispatched,
    dispatchEvent(e) {
      dispatched.push({ type: e.type, pointerId: e.pointerId });
      return true;
    },
  };
}

class FakeElement {
  style: Record<string, string> = { touchAction: "", transform: "", visibility: "" };
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 10000;
  clientHeight = 1000;
  scrollWidth = 800;
  clientWidth = 800;
  firstElementChild: { style: Record<string, string> } = { style: { transform: "" } };
  listeners: Listener[] = [];
  captured: number[] = [];
  released: number[] = [];

  addEventListener(type: string, fn: (e: unknown) => void, opts?: unknown): void {
    this.listeners.push({ type, fn, opts });
  }
  removeEventListener(type: string, fn: (e: unknown) => void, opts?: unknown): void {
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) this.listeners.splice(i, 1);
    void opts;
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  releasePointerCapture(id: number): void {
    this.released.push(id);
  }
  // Deliver to the capture-phase listener, which is the only one the gestures
  // run on (the bubble-phase pointerup listener only contains the synthetic up).
  fire(type: string, e: FakeEvent): void {
    for (const l of [...this.listeners]) {
      if (l.type !== type) continue;
      const capture = typeof l.opts === "object" && l.opts !== null && "capture" in l.opts;
      if (!capture) continue;
      l.fn(e);
    }
  }
  optsFor(type: string): unknown[] {
    return this.listeners.filter((l) => l.type === type).map((l) => l.opts);
  }
}

interface FakeEvent {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  timeStamp: number;
  width: number;
  height: number;
  cancelable: boolean;
  target: FakeTarget;
  prevented: number;
  stopped: number;
  preventDefault(): void;
  stopPropagation(): void;
}

function ev(
  id: number,
  x: number,
  y: number,
  t: number,
  target: FakeTarget,
  pointerType = "touch",
): FakeEvent {
  const e: FakeEvent = {
    pointerId: id,
    pointerType,
    clientX: x,
    clientY: y,
    timeStamp: t,
    width: 20,
    height: 20,
    cancelable: true,
    target,
    prevented: 0,
    stopped: 0,
    preventDefault() {
      e.prevented++;
    },
    stopPropagation() {
      e.stopped++;
    },
  };
  return e;
}

// --- frames and timers ------------------------------------------------------

let frames: { id: number; cb: (t: number) => void }[] = [];
let nextFrameId = 1;
let clock = 0;

function runFrames(n: number, dt = 16): void {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    clock += dt;
    for (const f of due) f.cb(clock);
  }
}

const saved: Record<string, unknown> = {};
const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  frames = [];
  nextFrameId = 1;
  clock = performance.now();
  for (const k of ["requestAnimationFrame", "cancelAnimationFrame", "window", "PointerEvent"]) {
    saved[k] = g[k];
  }
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    const id = nextFrameId++;
    frames.push({ id, cb });
    return id;
  };
  g.cancelAnimationFrame = (id: number) => {
    frames = frames.filter((f) => f.id !== id);
  };
  g.window = { setTimeout, clearTimeout, innerWidth: 800 };
  g.PointerEvent = class {
    type: string;
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    constructor(type: string, init: Record<string, unknown>) {
      this.type = type;
      this.pointerId = init.pointerId as number;
      this.pointerType = init.pointerType as string;
      this.clientX = init.clientX as number;
      this.clientY = init.clientY as number;
    }
  };
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

// --- the context the router reads -------------------------------------------

interface Harness {
  el: FakeElement;
  ctx: { current: PagedGestureCtx };
  detach: () => void;
  pauses: number;
  resumes: number;
  clears: number;
  target: FakeTarget;
}

function mount(over: Partial<PagedGestureCtx> = {}): Harness {
  const el = new FakeElement();
  const target = makeTarget();
  const h = { pauses: 0, resumes: 0, clears: 0 } as Harness;
  const ctx = {
    current: {
      paged: false,
      tool: "pointer",
      zoomedIn: false,
      fingerDraw: false,
      scroll: null,
      interaction: {
        pause: () => void h.pauses++,
        resume: () => void h.resumes++,
      },
      selection: {
        getBoundingRects: () => [],
        clear: () => void h.clears++,
      },
      setTouchLock: null,
      viewport: null,
      indicator: null,
      resetGestures: null,
      turnToPage: null,
      ...over,
    } as unknown as PagedGestureCtx,
  };
  const detach = attachTouchRouter(el as unknown as HTMLDivElement, { documentId: "main", ctx });
  h.el = el;
  h.ctx = ctx;
  h.detach = detach;
  h.target = target;
  return h;
}

// --- one finger: follow, then coast -----------------------------------------

test("one finger drags scrollTop with it and the release leaves inertia behind", () => {
  const h = mount();
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  expect(h.el.scrollTop).toBe(0);

  // Past the 6px slop on the first move: the gesture commits and follows from
  // the position it was pressed at.
  h.el.fire("pointermove", ev(1, 100, 480, 16, t));
  expect(h.el.scrollTop).toBe(20);
  expect(h.el.captured).toEqual([1]);
  expect(h.pauses).toBe(1);

  h.el.fire("pointermove", ev(1, 100, 440, 32, t));
  expect(h.el.scrollTop).toBe(60);
  h.el.fire("pointermove", ev(1, 100, 400, 48, t));
  expect(h.el.scrollTop).toBe(100);

  // The lift itself scrolls nothing — it only feeds the throw's last few px
  // into the velocity the coast starts from.
  h.el.fire("pointerup", ev(1, 100, 380, 64, t));
  const atRelease = h.el.scrollTop;
  expect(atRelease).toBe(100);

  // A frame was asked for, and the content keeps moving the same way without a
  // finger on it.
  expect(frames.length).toBe(1);
  runFrames(1);
  expect(h.el.scrollTop).toBeGreaterThan(atRelease);
  const afterOne = h.el.scrollTop;
  runFrames(3);
  expect(h.el.scrollTop).toBeGreaterThan(afterOne);

  // And it dies out on its own rather than coasting forever.
  runFrames(200);
  expect(frames.length).toBe(0);

  h.detach();
});

test("a tap that never passes the slop scrolls nothing and never pauses the engine", () => {
  const h = mount();
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 102, 497, 16, t));
  h.el.fire("pointerup", ev(1, 102, 497, 32, t));
  expect(h.el.scrollTop).toBe(0);
  expect(h.pauses).toBe(0);
  expect(h.el.captured).toEqual([]);
  expect(frames.length).toBe(0);
  h.detach();
});

// --- pitfall 70/71: the whole sequence is claimed, not just its first move ---

test("every move of a committed scroll calls preventDefault, not only the first", () => {
  const h = mount();
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));

  const moves: FakeEvent[] = [];
  for (let i = 1; i <= 6; i++) {
    const m = ev(1, 100, 500 - i * 20, i * 16, t);
    moves.push(m);
    h.el.fire("pointermove", m);
  }
  for (const m of moves) expect(m.prevented).toBe(1);

  h.detach();
});

// --- pitfall 37: any direction past the slop commits ------------------------

test("a horizontal drag commits as a scroll instead of leaking to the page", () => {
  const h = mount();
  const t = h.target;
  // A container with no horizontal range at all — the vertical reading layout.
  h.el.scrollWidth = h.el.clientWidth;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  const m1 = ev(1, 360, 500, 16, t);
  h.el.fire("pointermove", m1);

  // Committed: engine off, pointer captured, the browser told to keep its hands
  // off — even though the axis the finger picked has nowhere to go.
  expect(h.pauses).toBe(1);
  expect(h.el.captured).toEqual([1]);
  expect(m1.prevented).toBe(1);
  expect(h.el.scrollLeft).toBe(0);

  // And it stays committed: a horizontal gesture that later turns vertical
  // scrolls, it does not hand the pointer back.
  const m2 = ev(1, 360, 460, 32, t);
  h.el.fire("pointermove", m2);
  expect(m2.prevented).toBe(1);
  expect(h.el.scrollTop).toBe(40);

  h.detach();
});

// --- pitfall 38: the engine is handed its pointerup, exactly once ------------

test("the pointer the engine saw is closed out once, and the synthetic up does not re-enter", () => {
  const h = mount();
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  expect(t.dispatched).toEqual([]);

  h.el.fire("pointermove", ev(1, 100, 480, 16, t));
  expect(t.dispatched).toEqual([{ type: "pointerup", pointerId: 1 }]);

  // Later moves must not hand it a second one, and the gesture must still be
  // following (the synthetic event travelling back through this router's own
  // listeners is ignored, not taken for a real lift).
  h.el.fire("pointermove", ev(1, 100, 460, 32, t));
  h.el.fire("pointermove", ev(1, 100, 440, 48, t));
  expect(t.dispatched.length).toBe(1);
  expect(h.el.scrollTop).toBe(60);

  h.el.fire("pointerup", ev(1, 100, 440, 64, t));
  expect(t.dispatched.length).toBe(1);

  h.detach();
});

test("a pointer the engine never heard gets no synthetic up", () => {
  // An annotation tool pauses at pointerdown, so the engine never sees the down
  // and is owed nothing.
  const h = mount({ tool: "ink" });
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  expect(h.pauses).toBe(1);
  h.el.fire("pointermove", ev(1, 100, 480, 16, t));
  expect(t.dispatched).toEqual([]);
  expect(h.el.scrollTop).toBe(20);
  h.detach();
});

// --- two fingers ------------------------------------------------------------

test("a second finger stops the scroll, and the last finger lifting leaves nothing coasting", () => {
  const h = mount();
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 440, 16, t));
  expect(h.el.scrollTop).toBe(60);

  // Second finger: the one-finger gesture is dropped, both fingers are eaten
  // per pointer (the engine's own pinch-zoom runs on the touch channel, which
  // this router never touches).
  const down2 = ev(2, 300, 500, 32, t);
  h.el.fire("pointerdown", down2);
  expect(down2.stopped).toBe(1);
  expect(frames.length).toBe(0);

  // Two-finger pan follows the centroid.
  const m2 = ev(2, 300, 480, 48, t);
  h.el.fire("pointermove", m2);
  expect(m2.stopped).toBe(1);
  const panned = h.el.scrollTop;

  // One finger lifts: the survivor inherits the gesture where it stands.
  h.el.fire("pointerup", ev(1, 100, 440, 64, t));
  // The survivor lifts straight away, having moved nowhere since the handover.
  h.el.fire("pointerup", ev(2, 300, 480, 72, t));

  expect(h.el.scrollTop).toBe(panned);
  expect(frames.length).toBe(0);
  runFrames(5);
  expect(h.el.scrollTop).toBe(panned);

  h.detach();
});

test("a fling in flight is killed by a second finger landing", () => {
  const h = mount();
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 440, 16, t));
  h.el.fire("pointermove", ev(1, 100, 380, 32, t));
  h.el.fire("pointerup", ev(1, 100, 320, 48, t));
  expect(frames.length).toBe(1);

  h.el.fire("pointerdown", ev(2, 300, 500, 64, t));
  expect(frames.length).toBe(0);
  const stopped = h.el.scrollTop;
  runFrames(5);
  expect(h.el.scrollTop).toBe(stopped);

  h.detach();
});

// --- the wiring itself ------------------------------------------------------

test("the listeners land on the scroll container with the flags the router needs", () => {
  const h = mount();
  const types = h.el.listeners.map((l) => l.type);
  expect(types.filter((x) => x === "pointerdown").length).toBe(1);
  expect(types.filter((x) => x === "pointermove").length).toBe(1);
  expect(types.filter((x) => x === "pointercancel").length).toBe(1);
  expect(types.filter((x) => x === "scroll").length).toBe(1);
  // Two pointerup listeners: the capture-phase gesture one, and the bubble-phase
  // one that contains the synthetic up.
  expect(types.filter((x) => x === "pointerup").length).toBe(2);

  expect(h.el.optsFor("pointerdown")).toEqual([{ capture: true }]);
  // Non-passive: the committed sequence has to be able to preventDefault.
  expect(h.el.optsFor("pointermove")).toEqual([{ capture: true, passive: false }]);
  expect(h.el.optsFor("pointercancel")).toEqual([{ capture: true }]);
  expect(h.el.optsFor("pointerup")).toEqual([{ capture: true }, undefined]);
  expect(h.el.optsFor("scroll")).toEqual([{ passive: true }]);

  h.detach();
});

test("teardown removes every listener and puts the element back the way it was", () => {
  const h = mount({ paged: true });
  // Paged locks the container's touch-action; the settle may have been holding
  // the page area back (pitfall 63) and nothing else would clear it.
  expect(h.el.style.touchAction).toBe("none");
  h.el.style.visibility = "hidden";
  expect(h.ctx.current.viewport).toBe(h.el as unknown as HTMLElement);
  expect(h.ctx.current.setTouchLock).not.toBeNull();
  expect(h.ctx.current.resetGestures).not.toBeNull();

  h.detach();

  expect(h.el.listeners).toEqual([]);
  expect(h.el.style.visibility).toBe("");
  expect(h.el.style.touchAction).toBe("");
  expect(h.el.style.transform).toBe("");
  expect(h.ctx.current.viewport).toBeNull();
  expect(h.ctx.current.setTouchLock).toBeNull();
  expect(h.ctx.current.resetGestures).toBeNull();
});

test("teardown cancels a fling in flight", () => {
  const h = mount();
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 440, 16, t));
  h.el.fire("pointermove", ev(1, 100, 380, 32, t));
  h.el.fire("pointerup", ev(1, 100, 320, 48, t));
  expect(frames.length).toBe(1);

  h.detach();
  const stopped = h.el.scrollTop;
  runFrames(5);
  expect(h.el.scrollTop).toBe(stopped);
});

test("resetGestures drops a live drag: capture released, engine resumed", () => {
  const h = mount();
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 440, 16, t));
  expect(h.pauses).toBe(1);

  h.ctx.current.resetGestures?.();
  expect(h.resumes).toBe(1);
  expect(h.el.released).toContain(1);
  expect(h.el.style.transform).toBe("");

  h.detach();
});
