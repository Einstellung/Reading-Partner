// The DOM half the phone's two gestures share (src/ui/components/phone/gesture-dom.ts).
//
// What these assertions are here for, in order of what breaks the real thing:
//
// - A claimed touch sequence must preventDefault on every move, not only the one
//   that earned the claim. Preventing the first and letting the rest through
//   ends in `pointercancel` and the gesture dies mid-swipe (docs/pitfall/70).
//   The threshold itself is not tested here: it lives in each machine's
//   `shouldClaimTouch`, and pitfall 70's 3px was measured under Chromium touch
//   emulation and is still unverified on iOS WKWebView.
// - A sequence that never meets the claim must never be prevented, or a plain
//   vertical scroll on the edge-back surface stops scrolling.
// - The animator must cut the running settle when a new gesture takes over, and
//   must not cancel a frame belonging to a run that already finished.
// - Teardown must remove exactly the listeners it installed, on the targets it
//   installed them on. The pointer listeners after pointerdown are on a
//   different target from the touch ones, which is the easy half to get wrong.
//
// There is no DOM in this runner, so the host, the pointer target and the events
// are stand-ins that record what was asked of them. That is enough for the
// bookkeeping above and proves nothing about what a browser does with it.

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  bindGesture,
  createAnimator,
  easeOut,
  type PointerPhase,
  type TouchClaim,
} from "../../../src/ui/components/phone/gesture-dom";

// A recording EventTarget. Options are kept verbatim so a removal that drops
// `capture` — which would leave the listener installed — shows up as a mismatch.
interface Call {
  type: string;
  fn: EventListenerOrEventListenerObject;
  options: unknown;
}

class FakeTarget implements EventTarget {
  readonly added: Call[] = [];
  readonly removed: Call[] = [];
  private readonly live = new Map<string, Set<EventListener>>();

  addEventListener(type: string, fn: EventListenerOrEventListenerObject, options?: unknown): void {
    this.added.push({ type, fn, options });
    const set = this.live.get(type) ?? new Set<EventListener>();
    set.add(fn as EventListener);
    this.live.set(type, set);
  }

  removeEventListener(
    type: string,
    fn: EventListenerOrEventListenerObject,
    options?: unknown,
  ): void {
    this.removed.push({ type, fn, options });
    this.live.get(type)?.delete(fn as EventListener);
  }

  dispatchEvent(event: Event): boolean {
    for (const fn of this.live.get(event.type) ?? []) fn(event);
    return true;
  }

  send(type: string, event: unknown): void {
    for (const fn of this.live.get(type) ?? []) fn(event as Event);
  }
}

interface FakeTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}

function touchEvent(type: string, touches: FakeTouch[]) {
  let prevented = 0;
  return {
    type,
    touches,
    target: null,
    preventDefault(): void {
      prevented += 1;
    },
    get prevented(): number {
      return prevented;
    },
  };
}

function pointerEvent(id = 1, isPrimary = true) {
  return { pointerId: id, isPrimary, clientX: 0, clientY: 0, timeStamp: 0, target: null };
}

// Claims everything that has moved at least 3px down, the shape both machines'
// `shouldClaimTouch` has.
const DOWN_CLAIM: TouchClaim = {
  starts: () => true,
  reached: (_dx, dy) => dy >= 3,
};

function bind(claim: TouchClaim = DOWN_CLAIM, enabled = () => true) {
  const host = new FakeTarget();
  const pointerTarget = new FakeTarget();
  const seen: Array<[PointerPhase, number]> = [];
  const unbind = bindGesture(host, {
    pointerTarget,
    claim,
    enabled,
    onPointer: (phase, e) => seen.push([phase, e.pointerId]),
  });
  return { host, pointerTarget, seen, unbind };
}

test("easeOut runs from 0 to 1 and decelerates", () => {
  expect(easeOut(0)).toBe(0);
  expect(easeOut(1)).toBe(1);
  expect(easeOut(0.5)).toBeGreaterThan(0.5);
});

test("a claimed sequence is prevented on every move, not only the first", () => {
  const { host } = bind();
  host.send("touchstart", touchEvent("touchstart", [{ identifier: 7, clientX: 0, clientY: 0 }]));

  // Under the claim distance: the browser still owns this touch.
  const small = touchEvent("touchmove", [{ identifier: 7, clientX: 0, clientY: 1 }]);
  host.send("touchmove", small);
  expect(small.prevented).toBe(0);

  // The move that earns the claim.
  const claiming = touchEvent("touchmove", [{ identifier: 7, clientX: 0, clientY: 4 }]);
  host.send("touchmove", claiming);
  expect(claiming.prevented).toBe(1);

  // Every move after it, including ones that would not have earned the claim on
  // their own: back inside the threshold, and sideways.
  for (const point of [
    { identifier: 7, clientX: 0, clientY: 1 },
    { identifier: 7, clientX: 40, clientY: 2 },
    { identifier: 7, clientX: 0, clientY: 200 },
  ]) {
    const later = touchEvent("touchmove", [point]);
    host.send("touchmove", later);
    expect(later.prevented).toBe(1);
  }
});

test("a sequence that never meets the claim is never prevented", () => {
  const { host } = bind();
  host.send("touchstart", touchEvent("touchstart", [{ identifier: 3, clientX: 0, clientY: 0 }]));
  for (const y of [1, 2, -40, 2, 1]) {
    const move = touchEvent("touchmove", [{ identifier: 3, clientX: 0, clientY: y }]);
    host.send("touchmove", move);
    expect(move.prevented).toBe(0);
  }
});

test("a touch the gesture refuses at touchstart is never prevented", () => {
  const { host } = bind({ starts: () => false, reached: () => true });
  host.send("touchstart", touchEvent("touchstart", [{ identifier: 1, clientX: 0, clientY: 0 }]));
  const move = touchEvent("touchmove", [{ identifier: 1, clientX: 0, clientY: 90 }]);
  host.send("touchmove", move);
  expect(move.prevented).toBe(0);
});

test("the claim does not survive the touch that earned it", () => {
  const { host } = bind();
  host.send("touchstart", touchEvent("touchstart", [{ identifier: 1, clientX: 0, clientY: 0 }]));
  const claiming = touchEvent("touchmove", [{ identifier: 1, clientX: 0, clientY: 9 }]);
  host.send("touchmove", claiming);
  expect(claiming.prevented).toBe(1);

  host.send("touchend", touchEvent("touchend", []));
  const orphan = touchEvent("touchmove", [{ identifier: 1, clientX: 0, clientY: 9 }]);
  host.send("touchmove", orphan);
  expect(orphan.prevented).toBe(0);

  // A second finger abandons the claim outright rather than tracking the first.
  host.send(
    "touchstart",
    touchEvent("touchstart", [
      { identifier: 1, clientX: 0, clientY: 0 },
      { identifier: 2, clientX: 30, clientY: 0 },
    ]),
  );
  const twoFinger = touchEvent("touchmove", [{ identifier: 1, clientX: 0, clientY: 9 }]);
  host.send("touchmove", twoFinger);
  expect(twoFinger.prevented).toBe(0);
});

test("moves of another finger do not carry the claim", () => {
  const { host } = bind();
  host.send("touchstart", touchEvent("touchstart", [{ identifier: 5, clientX: 0, clientY: 0 }]));
  const other = touchEvent("touchmove", [{ identifier: 6, clientX: 0, clientY: 40 }]);
  host.send("touchmove", other);
  expect(other.prevented).toBe(0);
});

test("disabled means neither channel starts", () => {
  const { host, seen } = bind(DOWN_CLAIM, () => false);
  host.send("pointerdown", pointerEvent());
  expect(seen).toEqual([]);

  host.send("touchstart", touchEvent("touchstart", [{ identifier: 1, clientX: 0, clientY: 0 }]));
  const move = touchEvent("touchmove", [{ identifier: 1, clientX: 0, clientY: 40 }]);
  host.send("touchmove", move);
  expect(move.prevented).toBe(0);
});

test("pointerdown is the host's, the rest of the sequence is the pointer target's", () => {
  const { host, pointerTarget, seen } = bind();
  host.send("pointerdown", pointerEvent(2));
  pointerTarget.send("pointermove", pointerEvent(2));
  pointerTarget.send("pointerup", pointerEvent(2));
  pointerTarget.send("pointercancel", pointerEvent(2));
  expect(seen).toEqual([
    ["pointerdown", 2],
    ["pointermove", 2],
    ["pointerup", 2],
    ["pointercancel", 2],
  ]);

  // A pointerdown the host never hears cannot start anything, and a secondary
  // pointer is not a gesture.
  const fresh = bind();
  fresh.pointerTarget.send("pointerdown", pointerEvent(3));
  fresh.host.send("pointerdown", pointerEvent(4, false));
  expect(fresh.seen).toEqual([]);
});

test("teardown removes every listener it installed, on the target it used", () => {
  const { host, pointerTarget, unbind } = bind();
  expect(host.added.map((c) => c.type).sort()).toEqual([
    "pointerdown",
    "touchcancel",
    "touchend",
    "touchmove",
    "touchstart",
  ]);
  expect(pointerTarget.added.map((c) => c.type).sort()).toEqual([
    "pointercancel",
    "pointermove",
    "pointerup",
  ]);
  // The touch listeners have to be non-passive or their preventDefault is
  // ignored; everything is on the capture phase (docs/pitfall/37).
  for (const call of host.added) {
    expect((call.options as { capture: boolean }).capture).toBe(true);
    const passive = (call.options as { passive?: boolean }).passive;
    if (call.type === "touchstart" || call.type === "touchmove") expect(passive).toBe(false);
  }

  unbind();
  for (const target of [host, pointerTarget]) {
    expect(target.removed.length).toBe(target.added.length);
    for (const call of target.added) {
      const match = target.removed.find(
        (r) => r.type === call.type && r.fn === call.fn && r.options === call.options,
      );
      expect(match).toBeDefined();
    }
  }

  // And nothing is left listening.
  host.send("pointerdown", pointerEvent());
  const move = touchEvent("touchmove", [{ identifier: 1, clientX: 0, clientY: 40 }]);
  host.send("touchmove", move);
  expect(move.prevented).toBe(0);
});

// The animator runs on rAF and there is none in this runner, so the frames are
// pumped by hand.
let frames = new Map<number, (t: number) => void>();
let cancelled: number[] = [];
let clock = 0;
let nextFrameId = 1;
const realNow = performance.now.bind(performance);

beforeEach(() => {
  frames = new Map();
  cancelled = [];
  clock = 0;
  nextFrameId = 1;
  performance.now = () => clock;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void): number => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number): void => {
    cancelled.push(id);
    frames.delete(id);
  }) as typeof cancelAnimationFrame;
});

afterEach(() => {
  performance.now = realNow;
});

function advance(ms: number): void {
  clock += ms;
  const due = [...frames.values()];
  frames.clear();
  for (const cb of due) cb(clock);
}

test("a run walks the value to its end and then reports itself finished", () => {
  const painted: number[] = [];
  const a = createAnimator((v) => painted.push(v));
  let done = 0;
  a.run(0, 100, 100, () => {
    done += 1;
  });
  expect(a.animating).toBe(true);

  advance(50);
  expect(painted.length).toBe(1);
  expect(painted[0]).toBeGreaterThan(50); // eased out, so past halfway at half time
  expect(painted[0]).toBeLessThan(100);
  expect(a.animating).toBe(true);
  expect(done).toBe(0);

  advance(50);
  expect(painted[painted.length - 1]).toBe(100);
  expect(a.animating).toBe(false);
  expect(done).toBe(1);

  // The last frame scheduled nothing, and the finished run has no frame left to
  // cancel: a stop now must not cancel some later gesture's frame.
  advance(50);
  expect(painted.length).toBe(2);
  a.stop();
  expect(cancelled).toEqual([]);
});

test("a new gesture cuts the run in flight without finishing it", () => {
  const painted: number[] = [];
  const a = createAnimator((v) => painted.push(v));
  let done = 0;
  a.run(0, 100, 100, () => {
    done += 1;
  });
  advance(50);
  const cutFrame = [...frames.keys()][0];
  expect(cutFrame).toBeDefined();

  a.run(200, 0, 100);
  expect(cancelled).toEqual([cutFrame as number]);
  expect(a.animating).toBe(true);

  advance(100);
  expect(painted[painted.length - 1]).toBe(0);
  expect(a.animating).toBe(false);
  // The cut run never reached its end, so its callback never ran.
  expect(done).toBe(0);
});

test("stop clears itself, so stopping twice cancels one frame", () => {
  const a = createAnimator(() => {});
  a.run(0, 10, 100);
  const id = [...frames.keys()][0] as number;
  a.stop();
  expect(a.animating).toBe(false);
  a.stop();
  expect(cancelled).toEqual([id]);
});

test("a zero-length run lands on its end in one frame", () => {
  const painted: number[] = [];
  const a = createAnimator((v) => painted.push(v));
  a.run(30, 0, 0);
  advance(0);
  expect(painted).toEqual([0]);
  expect(a.animating).toBe(false);
});
