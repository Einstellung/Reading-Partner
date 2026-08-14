// The keyboard half of the chat zoom
// (src/ui/components/base/chat-scale-keys.ts): which presses it claims, and the
// count that keeps one listener on the window however many chat windows are
// open. The target is injected, so none of this needs a DOM. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import {
  bindZoomKeys,
  resetZoomKeys,
  zoomKeyAction,
  type ZoomAction,
} from "../../../src/ui/components/base/chat-scale-keys";

afterEach(resetZoomKeys);

// Enough of a KeyboardEvent for the decision, plus the preventDefault the
// binder calls on the presses it takes.
function press(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) {
  return {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

// A stand-in for window: it records what was registered and hands events to it.
function fakeTarget() {
  const handlers = new Set<EventListener>();
  return {
    handlers,
    addEventListener(_type: string, handler: EventListener) {
      handlers.add(handler);
    },
    removeEventListener(_type: string, handler: EventListener) {
      handlers.delete(handler);
    },
    send(event: unknown) {
      for (const handler of [...handlers]) handler(event as Event);
    },
  } as unknown as EventTarget & { handlers: Set<EventListener>; send(event: unknown): void };
}

test("the zoom keys, on either modifier", () => {
  expect(zoomKeyAction(press("=", { ctrl: true }))).toBe("in");
  expect(zoomKeyAction(press("+", { ctrl: true }))).toBe("in");
  expect(zoomKeyAction(press("-", { meta: true }))).toBe("out");
  expect(zoomKeyAction(press("_", { meta: true }))).toBe("out");
  expect(zoomKeyAction(press("0", { ctrl: true }))).toBe("reset");
});

test("an unmodified press is the document's, not the zoom's", () => {
  expect(zoomKeyAction(press("="))).toBe(null);
  expect(zoomKeyAction(press("0"))).toBe(null);
  expect(zoomKeyAction(press("a", { ctrl: true }))).toBe(null);
});

test("AltGr is left alone", () => {
  // Layouts that put a character on AltGr send it with ctrlKey set. Claiming
  // those presses would eat the character and zoom instead of typing it.
  expect(zoomKeyAction(press("0", { ctrl: true, alt: true }))).toBe(null);
  expect(zoomKeyAction(press("-", { ctrl: true, alt: true }))).toBe(null);
});

test("one listener however many windows are open", () => {
  const target = fakeTarget();
  const taken: ZoomAction[] = [];
  const first = bindZoomKeys(target, (action) => taken.push(action));
  const second = bindZoomKeys(target, (action) => taken.push(action));
  expect(target.handlers.size).toBe(1);

  const event = press("=", { ctrl: true });
  target.send(event);
  // Two listeners would take two steps per press, which is the bug this counts
  // to avoid.
  expect(taken).toEqual(["in"]);
  expect(event.prevented).toBe(true);

  first();
  expect(target.handlers.size).toBe(1);
  second();
  expect(target.handlers.size).toBe(0);
});

test("a press nobody claims is left to the page", () => {
  const target = fakeTarget();
  const taken: ZoomAction[] = [];
  bindZoomKeys(target, (action) => taken.push(action));
  const event = press("a", { ctrl: true });
  target.send(event);
  expect(taken).toEqual([]);
  expect(event.prevented).toBe(false);
});

test("a release is spent once, so a double cleanup cannot unbind a live scope", () => {
  const target = fakeTarget();
  const release = bindZoomKeys(target, () => {});
  bindZoomKeys(target, () => {});
  release();
  release();
  expect(target.handlers.size).toBe(1);
});

test("the listener comes back after the last scope left", () => {
  const target = fakeTarget();
  bindZoomKeys(target, () => {})();
  expect(target.handlers.size).toBe(0);
  const taken: ZoomAction[] = [];
  bindZoomKeys(target, (action) => taken.push(action));
  target.send(press("0", { meta: true }));
  expect(taken).toEqual(["reset"]);
});
