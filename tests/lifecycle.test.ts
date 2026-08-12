// The app's foreground/background edges (src/platform/app/lifecycle.ts) over a
// fake window: four events, one call per transition. What the real events do is
// measured, not assumed — see docs/pitfall/69. Run: bun test.

import { expect, test } from "bun:test";
import {
  observeAppExit,
  observeAppLifecycle,
  type LifecycleTarget,
} from "../src/platform/app/lifecycle";

// Just enough window: listeners by type, a settable document.hidden, and the
// ability to fire an event the way the platform would.
function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const win: LifecycleTarget & { document: { hidden: boolean } } = {
    document: { hidden: false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
  return {
    win,
    bound: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    hide() {
      win.document.hidden = true;
      this.fire("blur");
      this.fire("visibilitychange");
    },
    reveal() {
      win.document.hidden = false;
      this.fire("focus");
      this.fire("visibilitychange");
    },
  };
}

function observe(w: ReturnType<typeof fakeWindow>) {
  const calls: string[] = [];
  const stop = observeAppLifecycle(w.win, {
    onForeground: () => calls.push("foreground"),
    onBackground: () => calls.push("background"),
  });
  return { calls, stop };
}

test("hiding and revealing the window is one call each way", () => {
  const w = fakeWindow();
  const { calls } = observe(w);

  w.hide();
  w.reveal();

  // blur and visibilitychange arrive together on a minimise, and focus arrives
  // before visibilitychange on a restore. The caller hears one transition.
  expect(calls).toEqual(["background", "foreground"]);
});

test("a focus event while the window is still hidden is not the app coming back", () => {
  const w = fakeWindow();
  const { calls } = observe(w);

  w.hide();
  w.fire("focus");

  expect(calls).toEqual(["background"]);
});

// Measured on WebKitGTK: a window that loses focus to another window stays
// `visible` and fires nothing but blur. Visibility alone would miss the most
// common way of leaving a desktop app and coming back to it.
test("losing focus without being hidden still counts as leaving", () => {
  const w = fakeWindow();
  const { calls } = observe(w);

  w.fire("blur");
  w.fire("focus");

  expect(calls).toEqual(["background", "foreground"]);
});

test("pagehide is a way out, and repeating it says nothing new", () => {
  const w = fakeWindow();
  const { calls } = observe(w);

  w.fire("pagehide");
  w.fire("blur");
  w.fire("pagehide");

  expect(calls).toEqual(["background"]);
});

test("nothing is reported before the state actually changes", () => {
  const w = fakeWindow();
  const { calls } = observe(w);

  // Mounting happens in front of the user; a focus event at that point is not a
  // return from anywhere.
  w.fire("focus");
  w.fire("visibilitychange");

  expect(calls).toEqual([]);
});

test("the undo unbinds every listener", () => {
  const w = fakeWindow();
  const { calls, stop } = observe(w);

  stop();
  w.hide();
  w.reveal();

  expect(calls).toEqual([]);
  expect(w.bound()).toBe(0);
});

// The exit edge (observeAppExit). Background collection hangs off this one and
// not off onBackground, so what must not reach it is as much of the contract as
// what must (docs/36).

test("leaving the foreground is not leaving the page", () => {
  const w = fakeWindow();
  let exits = 0;
  observeAppExit(w.win, () => {
    exits += 1;
  });

  // Every way of stepping away from a desktop window without closing it: focus
  // to another app, and minimising. A collector goes on collecting through both.
  w.fire("blur");
  w.hide();
  w.reveal();

  expect(exits).toBe(0);
});

test("pagehide is the exit, every time it fires", () => {
  const w = fakeWindow();
  let exits = 0;
  observeAppExit(w.win, () => {
    exits += 1;
  });

  // On iOS this is the app being backgrounded, and the webview may be suspended
  // and restored more than once in a session. Every one of them is an exit; the
  // handlers are idempotent, so none of them is swallowed.
  w.fire("pagehide");
  w.fire("pagehide");

  expect(exits).toBe(2);
});

test("the exit undo unbinds", () => {
  const w = fakeWindow();
  let exits = 0;
  const stop = observeAppExit(w.win, () => {
    exits += 1;
  });

  stop();
  w.fire("pagehide");

  expect(exits).toBe(0);
  expect(w.bound()).toBe(0);
});
