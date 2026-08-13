// The touch router's WIRING (src/reading/engine/gesture/attach-touch.ts): which element
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
import { attachTouchRouter } from "../../../../src/reading/engine/gesture/attach-touch";
import type { PagedGestureCtx } from "../../../../src/reading/engine/gesture/context";

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
  // What actually travelled the way back out, i.e. what the ancestors between
  // the page and the scroll container would have seen. An event that does not
  // bubble never gets here, and that is a different thing from one the router
  // contained: both leave `escaped` empty.
  bubbled: Seen[];
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
  const bubbled: Seen[] = [];
  const escaped: Seen[] = [];
  const t: FakeTarget = {
    dispatched,
    bubbled,
    escaped,
    dispatchEvent(e) {
      dispatched.push({ type: e.type, pointerId: e.pointerId });
      e.target = t;
      el.fire(e.type, e);
      if (e.stopped > 0 || !e.bubbles) return true;
      bubbled.push({ type: e.type, pointerId: e.pointerId });
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
  // `unknown` rather than FakeEvent because not everything the router listens
  // for is a pointer event: the scroll event it paints the indicator from
  // carries nothing it reads, and a stand-in with pointer fields on it would
  // say otherwise.
  fire(type: string, e: unknown): void {
    this.deliver(type, e, true);
  }
  // The way back out, where the router contains its own synthetic pointerup —
  // and where a non-capture listener like the scroll one lives.
  fireBubble(type: string, e: unknown): void {
    this.deliver(type, e, false);
  }
  private deliver(type: string, e: unknown, capturePhase: boolean): void {
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

// window.setTimeout stands in too, for the same reason the frames do: the paged
// long press (450ms) and the indicator's fade (700ms) are decisions the router
// takes on a timer, and a test that had to wait out the real thing could only
// ever assert what happens before it. Firing them by hand is the only way to
// reach the other side.
let timers: { id: number; fn: () => void; ms: number }[] = [];
let nextTimerId = 1;

// Fire everything currently due, once. Returns what was fired, so a test can
// say "the timer was cancelled" by asserting nothing was.
function fireTimers(): { ms: number }[] {
  const due = timers;
  timers = [];
  for (const t of due) t.fn();
  return due.map((t) => ({ ms: t.ms }));
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
  timers = [];
  nextTimerId = 1;
  g.window = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextTimerId++;
      timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
    innerWidth: 800,
  };
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
  // What the engine's selection plugin would report. Writing to it is how a
  // test says "the engine dragged a selection out from under this finger";
  // clear() empties it, so a router that never clears leaves it standing.
  rects: unknown[];
  target: FakeTarget;
}

function mount(over: Partial<PagedGestureCtx> = {}): Harness {
  const el = new FakeElement();
  const target = makeTarget(el);
  const h = { pauses: 0, resumes: 0, clears: 0, rects: [] as unknown[] } as Harness;
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
        getBoundingRects: () => h.rects,
        clear: () => {
          h.clears++;
          h.rects = [];
        },
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
  // Nowhere to go, so the clamp holds it at 0. This container was set up with no
  // horizontal range, so a zero here is also the harness's starting value — the
  // test below is the one that reads the horizontal axis as a number.
  expect(h.el.scrollLeft).toBe(0);

  // And it stays committed: a horizontal gesture that later turns vertical
  // scrolls, it does not hand the pointer back.
  const m2 = ev(1, 360, 460, 32, t);
  h.el.fire("pointermove", m2);
  expect(m2.prevented).toBe(1);
  expect(h.el.scrollTop).toBe(40);

  h.detach();
});

// A magnified continuous layout scrolls on both axes, and the one-finger follow
// carries both. Nothing above proves it: the horizontal case there is a
// container with no horizontal range, where a scrollLeft of 0 is the value the
// element was mounted with. This one gives it range, so the number has to have
// been written.
test("one finger drags scrollLeft too when the continuous layout has range", () => {
  const h = mount();
  const t = h.target;
  // Magnified: 800px of horizontal range, parked in the middle of it so neither
  // direction is against a stop.
  h.el.scrollWidth = 1600;
  h.el.scrollLeft = 400;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  // Past the slop on the horizontal axis: the content follows the finger left.
  h.el.fire("pointermove", ev(1, 360, 500, 16, t));
  expect(h.el.scrollLeft).toBe(440);
  expect(h.el.scrollTop).toBe(0);

  // Both axes at once, each measured from where the finger was pressed.
  h.el.fire("pointermove", ev(1, 340, 470, 32, t));
  expect(h.el.scrollLeft).toBe(460);
  expect(h.el.scrollTop).toBe(30);

  // And the far edge clamps instead of running past it: 1600 - 800 = 800.
  h.el.fire("pointermove", ev(1, -600, 470, 48, t));
  expect(h.el.scrollLeft).toBe(800);

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

  // It did travel the way back out — that path is where the engine's own
  // per-page handler sits, and an up that stops at the page div it was
  // dispatched on never reaches it — and the scroll container stopped it there.
  // Nothing above the viewport may see a pointerup while the finger is still on
  // the glass (docs/pitfall/38).
  expect(t.bubbled).toEqual([{ type: "pointerup", pointerId: 1 }]);
  expect(t.escaped).toEqual([]);

  // Later moves must not hand it a second one, and the gesture must still be
  // following.
  h.el.fire("pointermove", ev(1, 100, 460, 32, t));
  h.el.fire("pointermove", ev(1, 100, 440, 48, t));
  expect(t.dispatched.length).toBe(1);
  expect(h.el.scrollTop).toBe(60);

  h.el.fire("pointerup", ev(1, 100, 440, 64, t));
  expect(t.dispatched.length).toBe(1);
  expect(t.bubbled.length).toBe(1);
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

// --- selection hygiene ------------------------------------------------------

// The engine is still live through the slop, so it can start a text drag in the
// few px before the gesture commits. That selection is this gesture's doing and
// goes; one that was already on screen is the reader's and stays. Which of the
// two it is, is decided at pointerdown and can only be decided there.
test("a selection the gesture caused in the slop is dropped when it commits", () => {
  const h = mount();
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  // Between the down and the commit the engine drags a word out.
  h.rects = [{ x: 0, y: 0 }];

  h.el.fire("pointermove", ev(1, 100, 480, 16, t));
  expect(h.el.scrollTop).toBe(20);
  expect(h.clears).toBe(1);
  expect(h.rects).toEqual([]);

  h.detach();
});

test("a selection that predates the gesture survives it", () => {
  const h = mount();
  const t = h.target;
  h.rects = [{ x: 0, y: 0 }];

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 480, 16, t));
  h.el.fire("pointermove", ev(1, 100, 440, 32, t));
  h.el.fire("pointerup", ev(1, 100, 440, 48, t));

  expect(h.el.scrollTop).toBe(60);
  expect(h.clears).toBe(0);
  expect(h.rects).toEqual([{ x: 0, y: 0 }]);

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

  // Both fingers lift with the pair standing still. Neither lift reaches the
  // engine: finger 1 already got its synthetic up when the one-finger gesture
  // committed, and a second one would re-arm the anchor pitfall 38 is about;
  // finger 2 was eaten at its own pointerdown, so the engine has no down to
  // match. A pinch that ends at rest also hands nothing to the inertia — the
  // survivor's velocity is re-seeded at the handover, so it cannot inherit the
  // speed the pair had two moves ago.
  const up1 = ev(1, 60, 400, 96, t);
  h.el.fire("pointerup", up1);
  expect(up1.stopped).toBe(1);
  const up2 = ev(2, 260, 420, 112, t);
  h.el.fire("pointerup", up2);
  expect(up2.stopped).toBe(1);
  expect(t.dispatched.length).toBe(1);
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

  // From here it is a one-finger follow measured from that position, and the
  // inherited gesture is already past its slop: a 4px move — well under the 6px
  // a fresh press has to clear before it commits — moves the page 4px. That is
  // the only place the handover's `takeover` shows up as a number; every move
  // after it is large enough to have committed a fresh gesture too.
  h.el.fire("pointermove", ev(2, 300, 476, 72, t));
  expect(h.el.scrollTop).toBe(64);

  // And it keeps following from the position it was handed, not from where the
  // slop would have re-anchored it: 60px up the glass is 60px further down the
  // document.
  h.el.fire("pointermove", ev(2, 300, 420, 80, t));
  expect(h.el.scrollTop).toBe(120);
  h.el.fire("pointermove", ev(2, 300, 380, 96, t));
  expect(h.el.scrollTop).toBe(160);
  h.el.fire("pointermove", ev(2, 300, 340, 112, t));
  expect(h.el.scrollTop).toBe(200);

  // And releasing it throws the page, because what it inherited is a real
  // gesture and not a frozen one. The lift itself is swallowed: the engine
  // never saw this pointer's down (the pinch ate it), so a bare pointerup would
  // reach a text handler holding no anchor for it (docs/pitfall/38).
  const up2 = ev(2, 300, 300, 128, t);
  h.el.fire("pointerup", up2);
  expect(up2.stopped).toBe(1);
  expect(frames.length).toBe(1);
  const atRelease = h.el.scrollTop;
  runFrames(1);
  expect(h.el.scrollTop).toBeGreaterThan(atRelease);
  runFrames(200);
  expect(frames.length).toBe(0);

  h.detach();
});

// The same handover on the other layout. A magnified paged view pans instead of
// scrolling, and the survivor of a pinch there has to keep panning from where it
// stands — the paged machine reads `takeover` only when the page is magnified,
// so this is the only shape in which that half of the handover is a number.
test("the survivor of a pinch on a magnified page keeps panning without re-clearing the slop", () => {
  const h = mount({ paged: true, zoomedIn: true });
  const t = h.target;
  // Magnified: room to pan on both axes, and parked away from either edge so
  // neither direction is blocked.
  h.el.scrollWidth = 1600;
  h.el.scrollLeft = 400;
  h.el.scrollTop = 300;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 460, 16, t));
  expect(h.el.scrollTop).toBe(340);

  // Second finger: the pan is dropped and the pair takes over by the centroid.
  h.el.fire("pointerdown", ev(2, 300, 500, 32, t));
  h.el.fire("pointermove", ev(2, 300, 480, 48, t));
  expect(h.el.scrollTop).toBe(340);
  h.el.fire("pointermove", ev(1, 100, 440, 64, t));
  expect(h.el.scrollTop).toBe(350);

  // One finger lifts. The survivor is at (300,480).
  h.el.fire("pointerup", ev(1, 100, 440, 80, t));

  // 4px, under the 6px a fresh press has to clear: it pans anyway, because the
  // gesture it inherited was already committed.
  h.el.fire("pointermove", ev(2, 300, 476, 96, t));
  expect(h.el.scrollTop).toBe(354);

  // And it goes on panning from there rather than from a re-anchored origin.
  h.el.fire("pointermove", ev(2, 260, 436, 112, t));
  expect(h.el.scrollTop).toBe(394);
  expect(h.el.scrollLeft).toBe(440);

  // Its lift is swallowed for the same reason as on the vertical layout: the
  // pinch ate this pointer's down, so the engine is owed no up.
  const up2 = ev(2, 260, 436, 128, t);
  h.el.fire("pointerup", up2);
  expect(up2.stopped).toBe(1);

  h.detach();
});

// The handover re-decides whose selection is on screen. The pinch dropped
// whatever its fingers selected on the way in, so anything standing at the
// moment the survivor takes over predates this gesture and is the reader's.
test("the survivor of a pinch does not clear a selection that outlived the pinch", () => {
  const h = mount();
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 100, 500, 0, t));
  h.el.fire("pointermove", ev(1, 100, 440, 16, t));
  h.el.fire("pointerdown", ev(2, 300, 500, 32, t));
  h.el.fire("pointermove", ev(2, 300, 480, 48, t));
  expect(h.clears).toBe(0);

  // What is on screen when the pinch comes down to one finger.
  h.rects = [{ x: 0, y: 0 }];

  h.el.fire("pointerup", ev(1, 100, 440, 64, t));
  h.el.fire("pointermove", ev(2, 300, 420, 80, t));
  expect(h.el.scrollTop).toBe(120);

  // The survivor inherits a committed gesture, which drops selections — but
  // this one is not its own doing.
  expect(h.clears).toBe(0);
  expect(h.rects).toEqual([{ x: 0, y: 0 }]);

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
  const t = h.target;
  // Paged locks the container's touch-action; the settle may have been holding
  // the page area back (pitfall 63) and nothing else would clear it.
  expect(h.el.style.touchAction).toBe("none");
  h.el.style.visibility = "hidden";
  expect(h.ctx.current.viewport).toBe(h.el as unknown as HTMLElement);
  expect(h.ctx.current.setTouchLock).not.toBeNull();
  expect(h.ctx.current.resetGestures).not.toBeNull();

  // Leave a rubber band standing on the page area: the only page there is, so
  // the drag bands instead of turning. Teardown has to take it off — this is
  // the paged band, painted on the scroll content, and nothing else clears it.
  // Asserting an empty transform without first putting one there asserts the
  // harness's own initial value.
  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  h.el.fire("pointermove", ev(1, 340, 500, 16, t));
  h.el.fire("pointermove", ev(1, 300, 500, 32, t));
  expect(h.el.firstElementChild.style.transform).not.toBe("");

  h.detach();

  expect(h.el.listeners).toEqual([]);
  expect(h.el.style.visibility).toBe("");
  expect(h.el.style.touchAction).toBe("");
  expect(h.el.firstElementChild.style.transform).toBe("");
  expect(h.ctx.current.viewport).toBeNull();
  expect(h.ctx.current.setTouchLock).toBeNull();
  expect(h.ctx.current.resetGestures).toBeNull();
});

// The other band. Vertical cannot translate the scroll content (pitfall 45), so
// its overscroll rides on the container itself — a different element from the
// paged band's, and the one a stale transform would offset the engine's zoom
// anchor against.
test("teardown takes a vertical overscroll band off the container", () => {
  const h = mount();
  const t = h.target;
  // Pulling down at the top of the document: nowhere to scroll, so it bands.
  h.el.fire("pointerdown", ev(1, 100, 300, 0, t));
  h.el.fire("pointermove", ev(1, 100, 340, 16, t));
  h.el.fire("pointermove", ev(1, 100, 400, 32, t));
  expect(h.el.scrollTop).toBe(0);
  expect(h.el.style.transform).not.toBe("");

  h.detach();
  expect(h.el.style.transform).toBe("");
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

// The paged band rides on the scroll content, and a band left standing there
// offsets the anchor the engine resolves its zoom against. The layout switch
// that calls resetGestures is exactly when that happens.
test("resetGestures takes the paged band off the page area", () => {
  const h = mount({ paged: true });
  const t = h.target;
  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  h.el.fire("pointermove", ev(1, 340, 500, 16, t));
  h.el.fire("pointermove", ev(1, 300, 500, 32, t));
  expect(h.el.firstElementChild.style.transform).not.toBe("");

  h.ctx.current.resetGestures?.();
  expect(h.el.firstElementChild.style.transform).toBe("");

  h.detach();
});

test("resetGestures drops a live drag: capture released, engine resumed", () => {
  const h = mount();
  const t = h.target;
  // Dragged into overscroll, so there is a band standing when the reset lands
  // and the transform below is a value the reset had to clear.
  h.el.fire("pointerdown", ev(1, 100, 300, 0, t));
  h.el.fire("pointermove", ev(1, 100, 340, 16, t));
  h.el.fire("pointermove", ev(1, 100, 400, 32, t));
  expect(h.pauses).toBe(1);
  expect(h.el.style.transform).not.toBe("");

  h.ctx.current.resetGestures?.();
  expect(h.resumes).toBe(1);
  expect(h.el.released).toContain(1);
  expect(h.el.style.transform).toBe("");

  h.detach();
});

// --- paged (horizontal flip) ------------------------------------------------
//
// Everything above drives the continuous layout, which means the paged command
// executor — `apply` in attach-touch.ts — was never entered: the whole of the
// page-turn wiring could be deleted a line at a time without a test going red.
// The section below drives it. What it can prove and what it cannot is set by
// the harness: these are synthesized pointer events, so the arithmetic, the
// element writes, the engine calls and their order are all real, while anything
// that depends on WebKit deciding the gesture first (whether the browser hands
// the sequence over at all, whether a `pointercancel` arrives instead) is not
// reachable here and is measured in the simulator instead (docs/pitfall/118).

// The two engine handles the paged executor reads: the page a turn is counted
// from, sampled once when the drag is captured, and where a turn is asked to
// land. `turns` is every page turnToPage was asked for, in order.
//
// The reported page is a variable, not the constant it reads like: the engine's
// current page is the most visible one, recomputed from the container's scroll
// event, so a follow-drag that slides the content past the half-page mark moves
// it while the finger is still down. `setPage` is that move, and it is what
// separates the page the executor sampled at the capture from a live read at
// the release.
function pagedMount(
  page: number,
  total: number,
  over: Partial<PagedGestureCtx> = {},
): { h: Harness; turns: number[]; setPage: (n: number) => void } {
  const turns: number[] = [];
  let current = page;
  const h = mount({
    paged: true,
    scroll: {
      getCurrentPage: () => current,
      getTotalPages: () => total,
    } as unknown as PagedGestureCtx["scroll"],
    turnToPage: (n: number) => void turns.push(n),
    ...over,
  });
  // `total` pages of 800px side by side, parked on `page`: a scrollLeft the
  // follow-drag has to have written rather than left at the value it started
  // with. clientWidth is the harness's 800, which is also the machine's turn
  // width, so the commit distance below is 0.22 * 800 = 176px.
  h.el.scrollWidth = 800 * total;
  h.el.scrollLeft = 800 * (page - 1);
  return {
    h,
    turns,
    setPage: (n: number) => {
      current = n;
    },
  };
}

// The px the paged band is holding the page area at, and a check that what was
// written is a band transform at all rather than some other string.
function bandX(transform: string): number {
  const m = /^translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\)$/.exec(transform);
  if (!m) throw new Error(`not a band transform: ${JSON.stringify(transform)}`);
  return Number(m[1]);
}

test("a paged swipe follows the finger and lands the turn on the next page", () => {
  const { h, turns } = pagedMount(6, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 600, 500, 0, t));
  expect(h.el.scrollLeft).toBe(4000);
  expect(h.pauses).toBe(0);

  // Past the 10px slop, horizontal: the drag commits. The capture arrives in
  // the same batch as the first dragMove, and it is the capture that samples
  // the scrollLeft everything after is measured from — 4000 - (-40) = 4040.
  const m1 = ev(1, 560, 500, 16, t);
  h.el.fire("pointermove", m1);
  expect(h.el.captured).toEqual([1]);
  expect(h.pauses).toBe(1);
  expect(h.el.scrollLeft).toBe(4040);
  expect(m1.prevented).toBe(1);

  // Still measured from the press, not from the previous sample: 600 - 400 is
  // 200px of finger, so 4000 + 200.
  const m2 = ev(1, 400, 500, 32, t);
  h.el.fire("pointermove", m2);
  expect(h.el.scrollLeft).toBe(4200);
  expect(m2.prevented).toBe(1);
  // The page area is not banded — there is a page on that side, so the gesture
  // is a turn and the content rides on scrollLeft alone.
  expect(h.el.firstElementChild.style.transform).toBe("");

  // 200px is past the 176px commit distance, so the release turns the page.
  // The target is counted from the page the capture sampled, not from the page
  // the engine happens to report at the release.
  const lift = ev(1, 400, 500, 48, t);
  h.el.fire("pointerup", lift);
  expect(turns).toEqual([7]);
  // The drag is over the moment the turn is issued, so the lift itself is not
  // claimed. Only the moves the router was actually following are (pitfall 70).
  expect(lift.prevented).toBe(0);
  // And the gesture is handed back whole: the engine resumed, the pointer
  // released, nothing left asking for frames.
  expect(h.resumes).toBe(1);
  expect(h.el.released).toEqual([1]);
  expect(frames.length).toBe(0);

  h.detach();
});

test("a paged swipe the other way lands on the previous page", () => {
  const { h, turns } = pagedMount(6, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 200, 500, 0, t));
  h.el.fire("pointermove", ev(1, 240, 500, 16, t));
  // Dragging right pulls the previous page in, so scrollLeft goes down.
  expect(h.el.scrollLeft).toBe(3960);
  h.el.fire("pointermove", ev(1, 440, 500, 32, t));
  expect(h.el.scrollLeft).toBe(3760);

  h.el.fire("pointerup", ev(1, 440, 500, 48, t));
  expect(turns).toEqual([5]);

  h.detach();
});

// The turn is counted from the page the capture sampled, not from the one the
// engine reports at the release. The follow-drag scrolls the content itself, so
// by the release the engine's counter can already be on the page being pulled
// in — counting from that would turn two pages on one swipe.
test("a paged turn counts from the page the capture sampled, not the one at the release", () => {
  const { h, turns, setPage } = pagedMount(6, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 600, 500, 0, t));
  h.el.fire("pointermove", ev(1, 560, 500, 16, t));
  expect(h.el.captured).toEqual([1]);

  // The engine's counter catches up with the content the drag has pulled
  // across, while the finger is still down and nothing has turned yet.
  setPage(7);
  h.el.fire("pointermove", ev(1, 400, 500, 32, t));
  expect(h.el.scrollLeft).toBe(4200);

  h.el.fire("pointerup", ev(1, 400, 500, 48, t));
  // 6 + 1. A live read here would ask for 8, and the machine would not stop it:
  // its own canTurn gate is recomputed from that same live counter.
  expect(turns).toEqual([7]);

  h.detach();
});

// pitfall 38, on the paged path this time: the router's takeover cuts the
// engine off from the pointer for good (capture retargets every later event,
// and the pause drops them anyway), so the engine has to be handed the
// pointerup it is owed first — while it is still listening.
test("the paged capture hands the engine its pointerup, before the pause and the capture", () => {
  const { h } = pagedMount(6, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 600, 500, 0, t));
  expect(t.dispatched).toEqual([]);

  h.el.fire("pointermove", ev(1, 560, 500, 16, t));
  // Dispatched at all: a pause that ran first would have made it pointless, and
  // the router knows it and skips it, so this assertion is the ordering.
  expect(t.dispatched).toEqual([{ type: "pointerup", pointerId: 1 }]);
  // It reached the way back out, where the engine's per-page handler sits, and
  // stopped at the scroll container: nothing above may see a lift while the
  // finger is still down.
  expect(t.bubbled).toEqual([{ type: "pointerup", pointerId: 1 }]);
  expect(t.escaped).toEqual([]);
  expect(h.el.captured).toEqual([1]);
  expect(h.pauses).toBe(1);

  // That synthetic up ran this router's own capture-phase pointerup listener on
  // the way past. The drag has to have survived it: a router that took it for a
  // real lift would have turned the page here and stopped following.
  h.el.fire("pointermove", ev(1, 400, 500, 32, t));
  expect(h.el.scrollLeft).toBe(4200);
  expect(t.dispatched.length).toBe(1);

  h.detach();
});

// pitfall 41: the band is written straight onto the page area's transform, with
// no CSS transition, and it comes off as an empty string rather than an
// identity transform — the engine's pinch preview writes the same property, and
// a transform of any kind there changes what it composes against.
test("a paged swipe with no page on that side bands the page area and springs back", () => {
  const { h, turns } = pagedMount(1, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 300, 500, 0, t));
  // Dragging right on the first page: nothing to turn to, so it bands. 48px of
  // finger against a 48px limit gives half of it.
  h.el.fire("pointermove", ev(1, 348, 500, 16, t));
  expect(h.el.firstElementChild.style.transform).toBe("translate3d(24px, 0px, 0)");
  // The band is on the page area, not on the scroll container: the container is
  // the vertical band's element (pitfall 45), and the two must not swap.
  expect(h.el.style.transform).toBe("");
  // And nothing scrolled — this is the whole point of the band.
  expect(h.el.scrollLeft).toBe(0);

  // Damped: three times the pull buys one and a half times the offset.
  h.el.fire("pointermove", ev(1, 444, 500, 32, t));
  expect(h.el.firstElementChild.style.transform).toBe("translate3d(36px, 0px, 0)");

  // The release springs it home on rAF rather than turning anything.
  h.el.fire("pointerup", ev(1, 444, 500, 48, t));
  expect(turns).toEqual([]);
  expect(frames.length).toBe(1);
  runFrames(1);
  const afterOne = bandX(h.el.firstElementChild.style.transform);
  expect(afterOne).toBeLessThan(36);
  expect(afterOne).toBeGreaterThan(0);

  runFrames(60);
  expect(h.el.firstElementChild.style.transform).toBe("");
  expect(frames.length).toBe(0);

  h.detach();
});

// A spring in flight belongs to the gesture that started it. A second swipe
// landing on top of it takes the band over from where the finger puts it, and
// the old spring must not go on decaying the new offset behind it.
test("a second band cancels the spring the last one left in flight", () => {
  const { h } = pagedMount(1, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 300, 500, 0, t));
  h.el.fire("pointermove", ev(1, 348, 500, 16, t));
  h.el.fire("pointerup", ev(1, 348, 500, 32, t));
  expect(frames.length).toBe(1); // springing home

  // Straight back down and pulled further, before the spring has run a frame.
  h.el.fire("pointerdown", ev(2, 300, 500, 48, t));
  h.el.fire("pointermove", ev(2, 444, 500, 64, t));
  expect(h.el.firstElementChild.style.transform).toBe("translate3d(36px, 0px, 0)");
  expect(frames.length).toBe(0);

  // Nothing is left to run it back down under the finger.
  runFrames(3);
  expect(h.el.firstElementChild.style.transform).toBe("translate3d(36px, 0px, 0)");

  h.detach();
});

test("a magnified paged page pans on both axes instead of turning", () => {
  const { h, turns } = pagedMount(6, 12, { zoomedIn: true });
  const t = h.target;
  // Magnified: room on both axes, parked away from every edge.
  h.el.scrollWidth = 1600;
  h.el.scrollHeight = 2000;
  h.el.scrollLeft = 400;
  h.el.scrollTop = 300;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  // Past the slop on either axis: a pan, not a turn, and it starts from the
  // press so the first step is the whole of the movement so far.
  h.el.fire("pointermove", ev(1, 370, 480, 16, t));
  expect(h.el.captured).toEqual([1]);
  expect(h.pauses).toBe(1);
  expect(h.el.scrollLeft).toBe(430);
  expect(h.el.scrollTop).toBe(320);

  // Every step after is measured from the previous sample, not from the press.
  h.el.fire("pointermove", ev(1, 350, 460, 32, t));
  expect(h.el.scrollLeft).toBe(450);
  expect(h.el.scrollTop).toBe(340);

  h.el.fire("pointerup", ev(1, 350, 460, 48, t));
  expect(turns).toEqual([]);
  expect(h.resumes).toBe(1);
  expect(h.el.released).toEqual([1]);

  h.detach();
});

// A magnified page turns by being pushed past its own edge: 60px of pull with
// nowhere left to pan. This is the second way into dragEnd, and the only one
// that reaches it from a move rather than from a release.
test("pushing a magnified page past its edge turns it and drops the gesture", () => {
  const { h, turns } = pagedMount(3, 12, { zoomedIn: true });
  const t = h.target;
  // Magnified but with no horizontal room at all: every leftward step is
  // against the stop.
  h.el.scrollWidth = 800;
  h.el.scrollLeft = 0;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  h.el.fire("pointermove", ev(1, 380, 500, 16, t)); // pan starts
  h.el.fire("pointermove", ev(1, 360, 500, 32, t)); // 20px of pull
  h.el.fire("pointermove", ev(1, 340, 500, 48, t)); // 40px
  expect(turns).toEqual([]);
  expect(h.el.scrollLeft).toBe(60);

  h.el.fire("pointermove", ev(1, 320, 500, 64, t)); // 60px: the turn
  expect(turns).toEqual([3 + 1]);
  // The turn replaces that step's pan, so the scroll position stands still.
  expect(h.el.scrollLeft).toBe(60);
  // And the gesture is over while the finger is still down: engine back,
  // pointer released.
  expect(h.resumes).toBe(1);
  expect(h.el.released).toEqual([1]);

  // The rest of the finger's travel does nothing, and the lift turns nothing.
  h.el.fire("pointermove", ev(1, 200, 500, 80, t));
  h.el.fire("pointerup", ev(1, 200, 500, 96, t));
  expect(turns).toEqual([4]);
  expect(h.el.scrollLeft).toBe(60);

  h.detach();
});

// The long press is the router's own timer, not the machine's: it hands a
// finger that dwells in place to native text selection, so a later drag of a
// selection handle is not stolen as a page turn.
test("a finger that dwells in paged mode is given up to native text selection", () => {
  const { h, turns } = pagedMount(6, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  expect(fireTimers()).toEqual([{ ms: 450 }]);

  // From here the machine is off: the same swipe that turned the page above
  // does nothing at all.
  const m = ev(1, 200, 500, 500, t);
  h.el.fire("pointermove", m);
  expect(h.el.captured).toEqual([]);
  expect(h.pauses).toBe(0);
  expect(h.el.scrollLeft).toBe(4000);
  expect(m.prevented).toBe(0);

  h.el.fire("pointerup", ev(1, 200, 500, 520, t));
  expect(turns).toEqual([]);

  h.detach();
});

test("a drag that commits cancels the long press, so a slow swipe still turns", () => {
  const { h, turns } = pagedMount(6, 12);
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 600, 500, 0, t));
  h.el.fire("pointermove", ev(1, 400, 500, 16, t));
  // Committed, and the timer that would have handed this pointer away is gone.
  expect(h.el.captured).toEqual([1]);
  expect(fireTimers()).toEqual([]);

  h.el.fire("pointerup", ev(1, 400, 500, 600, t));
  expect(turns).toEqual([7]);

  h.detach();
});

// pitfall 37's second rule, on the paged path: an annotation tool's engine
// pipeline is shut off at pointerdown, before the stroke's lead-in can leave
// ink. The finger still turns the page — with "draw with your finger" off, an
// annotation tool means the stylus marks and the finger moves the book.
test("an annotation tool shuts the engine off at the paged pointerdown", () => {
  const { h, turns } = pagedMount(6, 12, { tool: "ink" });
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  expect(h.pauses).toBe(1);
  // No long press either: with a tool active there is nothing to hand the
  // pointer to, the engine is already off.
  expect(fireTimers()).toEqual([]);

  h.el.fire("pointermove", ev(1, 200, 500, 16, t));
  expect(h.el.captured).toEqual([1]);
  expect(h.el.scrollLeft).toBe(4200);
  // And the engine is handed nothing on the way: it never saw the down, so it
  // is owed no up (pitfall 38's second rule).
  expect(t.dispatched).toEqual([]);

  h.el.fire("pointerup", ev(1, 200, 500, 32, t));
  expect(turns).toEqual([7]);
  expect(h.resumes).toBe(1);

  h.detach();
});

// With "draw with your finger" on, the finger marks the page, so a turn has to
// announce itself: it must start inside a 32px band at the screen edge. A swipe
// from the middle is a stroke and is left to the annotation layer untouched.
test("with the finger set to draw, only a swipe from the screen edge turns the page", () => {
  const { h, turns } = pagedMount(6, 12, { tool: "ink", fingerDraw: true });
  const t = h.target;

  h.el.fire("pointerdown", ev(1, 400, 500, 0, t));
  const m = ev(1, 200, 500, 16, t);
  h.el.fire("pointermove", m);
  expect(h.el.captured).toEqual([]);
  expect(h.el.scrollLeft).toBe(4000);
  // Nothing claimed: the browser and the engine keep the whole sequence.
  expect(m.prevented).toBe(0);
  h.el.fire("pointerup", ev(1, 200, 500, 32, t));
  expect(turns).toEqual([]);

  // The same swipe, started inside the left edge band.
  h.el.fire("pointerdown", ev(2, 20, 500, 48, t));
  h.el.fire("pointermove", ev(2, 100, 500, 64, t));
  expect(h.el.captured).toEqual([2]);
  expect(h.el.scrollLeft).toBe(3920);
  h.el.fire("pointerup", ev(2, 300, 500, 80, t));
  expect(turns).toEqual([5]);

  h.detach();
});

// --- the scroll indicator ---------------------------------------------------
//
// The strip is painted from the container's own scroll event, so it follows the
// engine's programmatic scrolls as well as a finger. Its geometry is
// scroll-indicator.ts's; what is checked here is that the router hands that
// function the live element and writes the answer back in px.
test("the indicator is painted from the container's geometry and fades out", () => {
  const bar = { style: {} as Record<string, string> };
  const h = mount({ indicator: bar as unknown as HTMLElement });
  // 1000px of viewport, 10000px of document: a 992px track and a tenth of the
  // book on screen, so a 99.2px thumb 4px from the top.
  h.el.fireBubble("scroll", {});
  expect(bar.style.height).toBe("99.2px");
  expect(bar.style.transform).toBe("translateY(4px)");
  expect(bar.style.opacity).toBe("1");

  // Half way down: 4 + (992 - 99.2) / 2 = 450.4.
  h.el.scrollTop = 4500;
  h.el.fireBubble("scroll", {});
  expect(bar.style.transform).toBe("translateY(450.4px)");

  // And it is furniture only while the scroll is moving.
  expect(fireTimers()).toEqual([{ ms: 700 }]);
  expect(bar.style.opacity).toBe("0");

  h.detach();
});

test("a document that fits the screen shows no indicator at all", () => {
  const bar = { style: { opacity: "1" } as Record<string, string> };
  const h = mount({ indicator: bar as unknown as HTMLElement });
  h.el.scrollHeight = h.el.clientHeight;
  h.el.fireBubble("scroll", {});
  expect(bar.style.opacity).toBe("0");
  expect(bar.style.height).toBeUndefined();
  h.detach();
});
