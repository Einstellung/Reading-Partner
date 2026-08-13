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
// The one place the stand-in has to be more than a recorder is dispatchEvent.
// The router synthesizes a pointerup and sends it to the page div the finger
// landed on, which is a descendant of the container it is listening on, so that
// event comes straight back through its own listeners. A fake that only logged
// the call would leave the re-entry guards untested, and those guards are what
// keeps the router from reading its own synthetic event as a real lift
// (docs/pitfall/38). So the fake target walks the path: capture phase on the
// container, then bubble phase, then out.
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

interface Seen {
  type: string;
  pointerId: number;
}

interface FakeTarget {
  dispatched: Seen[];
  // What got past the scroll container on the way back out, i.e. what a
  // listener above the viewport would have seen.
  escaped: Seen[];
  dispatchEvent(e: DispatchedEvent): boolean;
}

// The page div a pointerdown landed on. It is a descendant of the scroll
// container, so dispatching here is not a dead drop: the event runs the
// container's capture-phase listeners on the way down, the target's own, then
// the container's bubble-phase listeners on the way back out, and carries on
// past the viewport unless something stops it. Modelling the whole path is the
// point — a dispatchEvent that only appends to an array lets every re-entry
// guard in the router be deleted without a test noticing, and those guards are
// the second half of docs/pitfall/38.
function makeTarget(el: FakeElement): FakeTarget {
  const dispatched: Seen[] = [];
  const escaped: Seen[] = [];
  const t: FakeTarget = {
    dispatched,
    escaped,
    dispatchEvent(e) {
      dispatched.push({ type: e.type, pointerId: e.pointerId });
      e.target = t;
      el.fire(e.type, e);
      if (e.stopped > 0 || !e.bubbles) return true;
      el.fireBubble(e.type, e);
      if (e.stopped > 0) return true;
      escaped.push({ type: e.type, pointerId: e.pointerId });
      return true;
    },
  };
  return t;
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
  // Deliver to the capture-phase listeners, which is where the gestures run.
  // A real event from a page div reaches these on its way down the tree.
  fire(type: string, e: FakeEvent): void {
    this.deliver(type, e, true);
  }
  // The way back out, where the router contains its own synthetic pointerup.
  fireBubble(type: string, e: FakeEvent): void {
    this.deliver(type, e, false);
  }
  private deliver(type: string, e: FakeEvent, capturePhase: boolean): void {
    for (const l of [...this.listeners]) {
      if (l.type !== type) continue;
      const capture = typeof l.opts === "object" && l.opts !== null && "capture" in l.opts;
      if (capture !== capturePhase) continue;
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

// What the router synthesizes and hands back to the page: a FakeEvent that also
// carries the two things a dispatch needs, its type and whether it bubbles.
interface DispatchedEvent extends FakeEvent {
  type: string;
  bubbles: boolean;
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
    // Event timestamps share their origin with performance.now() in a real
    // browser, and the router mixes the two (the pinch handover stamps its
    // synthesized pointerdown with performance.now() and then measures the
    // next real move against it). Offsetting by the same base keeps that
    // arithmetic honest while leaving every gap between two events unchanged.
    timeStamp: timeBase + t,
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
let timeBase = 0;

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
  timeBase = clock;
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
  // Enough of a PointerEvent for the router's synthetic up to travel the real
  // path: propagation control included, because the container stops it on the
  // way back out and a stand-in without stopPropagation would hide that.
  g.PointerEvent = class {
    type: string;
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    bubbles: boolean;
    cancelable: boolean;
    timeStamp = 0;
    width = 0;
    height = 0;
    target: unknown = null;
    prevented = 0;
    stopped = 0;
    constructor(type: string, init: Record<string, unknown>) {
      this.type = type;
      this.pointerId = init.pointerId as number;
      this.pointerType = init.pointerType as string;
      this.clientX = init.clientX as number;
      this.clientY = init.clientY as number;
      this.bubbles = init.bubbles === true;
      this.cancelable = init.cancelable === true;
    }
    preventDefault(): void {
      this.prevented++;
    }
    stopPropagation(): void {
      this.stopped++;
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
  const target = makeTarget(el);
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

  // That synthetic up really did run this router's own capture-phase pointerup
  // listener on its way to the page, and the finger is still down: the gesture
  // must have survived it untouched. A router that took it for a real lift
  // would have dropped the contact here and stopped following, and would have
  // handed the release to the fling.
  expect(h.el.scrollTop).toBe(20);
  expect(frames.length).toBe(0);

  // And it was contained on the way back out. Nothing above the viewport may
  // see a pointerup while the finger is still on the glass (docs/pitfall/38).
  expect(t.escaped).toEqual([]);

  // Later moves must not hand it a second one, and the gesture must still be
  // following.
  h.el.fire("pointermove", ev(1, 100, 460, 32, t));
  h.el.fire("pointermove", ev(1, 100, 440, 48, t));
  expect(t.dispatched.length).toBe(1);
  expect(h.el.scrollTop).toBe(60);

  h.el.fire("pointerup", ev(1, 100, 440, 64, t));
  expect(t.dispatched.length).toBe(1);
  expect(t.escaped).toEqual([]);

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

// The pinch: two fingers, both eaten per pointer, the content following the
// point between them. Every number below is the arithmetic of that midpoint, so
// a pan that stopped tracking it — or never started — shows up as a wrong
// scroll position rather than as nothing at all.
test("a second finger stops the scroll and the pair pans by the centroid", () => {
  const h = mount();
  const t = h.target;
  // Give the container horizontal range too, so the pan's other axis is a
  // number and not a clamp to zero.
  h.el.scrollWidth = 1600;

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

  // The first two-finger move only takes the baseline: fingers at (100,440) and
  // (300,480) put the centroid at (200,460), and nothing has moved relative to
  // it yet.
  const m2 = ev(2, 300, 480, 48, t);
  h.el.fire("pointermove", m2);
  expect(m2.stopped).toBe(1);
  expect(h.el.scrollTop).toBe(60);
  expect(h.el.scrollLeft).toBe(0);

  // Finger 1 to (60,400): centroid (180,440), so the midpoint moved 20 left and
  // 20 up and the content follows it 20 down and 20 right.
  h.el.fire("pointermove", ev(1, 60, 400, 64, t));
  expect(h.el.scrollTop).toBe(80);
  expect(h.el.scrollLeft).toBe(20);

  // Finger 2 to (260,420): centroid (160,410), another 20 left and 30 up. Both
  // fingers moved this gesture, and neither one of them is the centroid.
  h.el.fire("pointermove", ev(2, 260, 420, 80, t));
  expect(h.el.scrollTop).toBe(110);
  expect(h.el.scrollLeft).toBe(40);

  // Both fingers lift with the pair standing still. A pinch that ends at rest
  // hands nothing to the inertia — the survivor's velocity is re-seeded at the
  // handover, so it cannot inherit the speed the pair had two moves ago.
  h.el.fire("pointerup", ev(1, 60, 400, 96, t));
  h.el.fire("pointerup", ev(2, 260, 420, 112, t));
  expect(h.el.scrollTop).toBe(110);
  expect(frames.length).toBe(0);
  runFrames(5);
  expect(h.el.scrollTop).toBe(110);

  h.detach();
});

// The 2 -> 1 handover. The last finger of a pinch keeps moving the page as an
// ordinary one-finger pan, from where it stands: no jump, and no waiting for
// the glass to empty.
test("the survivor of a pinch inherits the pan and can still throw it", () => {
  const h = mount();
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 440, 16, t));
  expect(h.el.scrollTop).toBe(60);
  h.el.fire("pointerdown", ev(2, 300, 500, 32, t));
  h.el.fire("pointermove", ev(2, 300, 480, 48, t));
  expect(h.el.scrollTop).toBe(60);

  // One finger lifts. The survivor is at (300,480) and the content is at 60.
  h.el.fire("pointerup", ev(1, 100, 440, 64, t));

  // From here it is a one-finger follow measured from that position, with no
  // slop to clear: 60px up the glass is 60px further down the document.
  h.el.fire("pointermove", ev(2, 300, 420, 80, t));
  expect(h.el.scrollTop).toBe(120);
  h.el.fire("pointermove", ev(2, 300, 380, 96, t));
  expect(h.el.scrollTop).toBe(160);
  h.el.fire("pointermove", ev(2, 300, 340, 112, t));
  expect(h.el.scrollTop).toBe(200);

  // And releasing it throws the page, because what it inherited is a real
  // gesture and not a frozen one.
  h.el.fire("pointerup", ev(2, 300, 300, 128, t));
  expect(frames.length).toBe(1);
  const atRelease = h.el.scrollTop;
  runFrames(1);
  expect(h.el.scrollTop).toBeGreaterThan(atRelease);
  runFrames(200);
  expect(frames.length).toBe(0);

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
