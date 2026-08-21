// The ctrl/cmd + wheel step (wheel-zoom.ts): the size of one mouse notch, the
// continuity of a trackpad pinch, and the wiring's one-apply-per-frame. The
// container and the zoom plugin are both injected, so none of this needs a real
// engine. Run: bun test.

import { expect, test } from "bun:test";
import {
  attachWheelZoom,
  clampZoom,
  foldWheelZoom,
  IDLE_WHEEL_ZOOM,
  isZoomWheel,
  wheelZoomFactor,
  WHEEL_GESTURE_IDLE_MS,
  ZOOM_MAX,
  ZOOM_MIN,
  type WheelZoomHost,
  type WheelZoomState,
} from "./wheel-zoom";

test("one mouse notch is a small step, not a doubling", () => {
  // Chromium reports 100px per notch. The plugin's own handler made that a 2x
  // jump (docs/pitfall/137); mainstream readers move 10-15% per notch.
  const factor = wheelZoomFactor(-100, 0);
  expect(factor).toBeGreaterThan(1.1);
  expect(factor).toBeLessThan(1.15);
  // And out is exactly the way back in, which is what makes a wheel aimable.
  expect(wheelZoomFactor(100, 0) * factor).toBeCloseTo(1, 10);
});

test("a smaller notch is a smaller step rather than a dead one", () => {
  // WebKitGTK's ~53px and Firefox's three lines both land here; no device check
  // decides it, the curve does.
  expect(wheelZoomFactor(-53, 0)).toBeGreaterThan(1.05);
  expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(1.05);
  expect(wheelZoomFactor(-3, 1)).toBeLessThan(1.1);
});

test("a pinch's dozens of small events compose into the one notch", () => {
  // The point of the exponential: sum the deltas or multiply the factors and the
  // answer is the same, so a mouse and a trackpad share one curve.
  let product = 1;
  for (let i = 0; i < 20; i++) product *= wheelZoomFactor(-5, 0);
  expect(product).toBeCloseTo(wheelZoomFactor(-100, 0), 10);
});

test("the accumulator carries a gesture and forgets it when it ends", () => {
  const one = foldWheelZoom(IDLE_WHEEL_ZOOM, { deltaY: -100, deltaMode: 0, time: 1000 }, 1);
  expect(one.target).toBeCloseTo(wheelZoomFactor(-100, 0), 10);
  // Still the same gesture: it builds on its own target, not on what the plugin
  // stored (which is rounded to three decimals and would quantize a pinch away).
  const two = foldWheelZoom(one, { deltaY: -100, deltaMode: 0, time: 1050 }, 1);
  expect(two.target).toBeCloseTo(wheelZoomFactor(-100, 0) ** 2, 10);
  // A gap long enough to be a new gesture starts from whatever the zoom is now,
  // which is how a toolbar press or a fit in between is picked up.
  const later = foldWheelZoom(two, { deltaY: -100, deltaMode: 0, time: 1050 + WHEEL_GESTURE_IDLE_MS + 1 }, 3);
  expect(later.target).toBeCloseTo(3 * wheelZoomFactor(-100, 0), 10);
});

test("the target is held inside the plugin's own range", () => {
  expect(clampZoom(50)).toBe(ZOOM_MAX);
  expect(clampZoom(0.01)).toBe(ZOOM_MIN);
  let state: WheelZoomState = { target: ZOOM_MAX, at: 0 };
  for (let i = 0; i < 20; i++) {
    state = foldWheelZoom(state, { deltaY: -100, deltaMode: 0, time: i * 10 }, ZOOM_MAX);
  }
  expect(state.target).toBe(ZOOM_MAX);
  // And one notch back out moves immediately, rather than unwinding twenty
  // notches of overshoot first.
  state = foldWheelZoom(state, { deltaY: 100, deltaMode: 0, time: 300 }, ZOOM_MAX);
  expect(state.target).toBeLessThan(ZOOM_MAX);
});

test("only a modifier press is a zoom", () => {
  expect(isZoomWheel({ ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
  expect(isZoomWheel({ ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
  // A bare wheel scrolls the page.
  expect(isZoomWheel({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  // AltGr arrives with ctrlKey set on the layouts that have it.
  expect(isZoomWheel({ ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
});

// A container that records what was bound to it and can send events back.
function fakeContainer() {
  let handler: ((e: unknown) => void) | null = null;
  return {
    listeners: () => (handler ? 1 : 0),
    addEventListener(_type: string, h: (e: unknown) => void) {
      handler = h;
    },
    removeEventListener() {
      handler = null;
    },
    getBoundingClientRect: () => ({ left: 20, top: 30 }),
    send(e: unknown) {
      handler?.(e);
    },
  } as unknown as HTMLElement & { listeners(): number; send(e: unknown): void };
}

function wheel(deltaY: number, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) {
  return {
    deltaY,
    deltaMode: 0,
    clientX: 120,
    clientY: 230,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function fakeHost() {
  let pending: (() => void) | null = null;
  let next = 1;
  const host: WheelZoomHost = {
    now: () => 1000,
    schedule: (run) => {
      pending = run;
      return next++;
    },
    cancel: () => {
      pending = null;
    },
  };
  return { host, frame: () => {
    const run = pending;
    pending = null;
    run?.();
  } };
}

test("dozens of events in a frame become one applied zoom", () => {
  const container = fakeContainer();
  const applied: { level: number; center: { vx: number; vy: number } }[] = [];
  const { host, frame } = fakeHost();
  const detach = attachWheelZoom(
    container,
    { currentZoom: () => 1, requestZoom: (level, center) => applied.push({ level, center }) },
    host,
  );

  for (let i = 0; i < 20; i++) container.send(wheel(-5, { ctrl: true }));
  // Nothing applied yet: the zoom is a relayout plus a re-raster, and a trackpad
  // sends these faster than a frame.
  expect(applied).toEqual([]);
  frame();
  expect(applied.length).toBe(1);
  expect(applied[0].level).toBeCloseTo(wheelZoomFactor(-100, 0), 10);
  // The anchor is the pointer, in the viewport's own coordinates.
  expect(applied[0].center).toEqual({ vx: 100, vy: 200 });

  detach();
  expect(container.listeners()).toBe(0);
});

test("a bare wheel is left alone entirely", () => {
  const container = fakeContainer();
  const applied: number[] = [];
  const { host, frame } = fakeHost();
  attachWheelZoom(container, { currentZoom: () => 1, requestZoom: (l) => applied.push(l) }, host);
  const e = wheel(-100);
  container.send(e);
  frame();
  // Not zoomed, and not prevented either — the page has to scroll.
  expect(applied).toEqual([]);
  expect(e.prevented).toBe(false);
});

test("a zoom press is prevented so the browser does not zoom the app too", () => {
  const container = fakeContainer();
  const { host } = fakeHost();
  attachWheelZoom(container, { currentZoom: () => 1, requestZoom: () => {} }, host);
  const e = wheel(-100, { ctrl: true });
  container.send(e);
  expect(e.prevented).toBe(true);
});
