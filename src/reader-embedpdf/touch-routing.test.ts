import { expect, test } from "bun:test";
import {
  routePointer,
  toolKindOf,
  pointerKindOf,
  routesAsContact,
  pagedGestureTool,
  planFinger,
  planPointer,
  shouldCommitScroll,
  touchGestureMode,
  multiTouchLatch,
  fingerLockAfterPen,
  fingerVerdict,
  centroidOf,
  shouldClearGestureSelection,
  type PointerKind,
  type ToolKind,
} from "./touch-routing";

// Full routing table, both penSeen values, all pointer kinds, all tool kinds.
const tools: ToolKind[] = ["none", "navlock", "annotate"];
const pointers: PointerKind[] = ["mouse", "pen", "touch"];

test("the navigation lock scrolls every device, regardless of penSeen", () => {
  for (const p of pointers) {
    expect(routePointer("navlock", p, false)).toBe("scroll");
    expect(routePointer("navlock", p, true)).toBe("scroll");
  }
});

test("no tool selected: the finger scrolls, the stylus and mouse go to the engine", () => {
  for (const penSeen of [false, true]) {
    expect(routePointer("none", "touch", penSeen)).toBe("scroll");
    expect(routePointer("none", "pen", penSeen)).toBe("draw");
    expect(routePointer("none", "mouse", penSeen)).toBe("draw");
  }
});

test("annotate tool: mouse and pen always draw", () => {
  for (const penSeen of [false, true]) {
    expect(routePointer("annotate", "mouse", penSeen)).toBe("draw");
    expect(routePointer("annotate", "pen", penSeen)).toBe("draw");
  }
});

test("annotate tool: touch scrolls once a stylus was seen (pen writes, finger scrolls)", () => {
  expect(routePointer("annotate", "touch", true)).toBe("scroll");
});

test("annotate tool: touch draws on a stylus-less device (otherwise unreachable)", () => {
  expect(routePointer("annotate", "touch", false)).toBe("draw");
});

test("exhaustive table snapshot", () => {
  const table: Record<string, string> = {};
  for (const t of tools) {
    for (const p of pointers) {
      for (const penSeen of [false, true]) {
        table[`${t}/${p}/${penSeen ? "penSeen" : "noPen"}`] = routePointer(t, p, penSeen);
      }
    }
  }
  expect(table).toEqual({
    "none/mouse/noPen": "draw",
    "none/mouse/penSeen": "draw",
    "none/pen/noPen": "draw",
    "none/pen/penSeen": "draw",
    "none/touch/noPen": "scroll",
    "none/touch/penSeen": "scroll",
    "navlock/mouse/noPen": "scroll",
    "navlock/mouse/penSeen": "scroll",
    "navlock/pen/noPen": "scroll",
    "navlock/pen/penSeen": "scroll",
    "navlock/touch/noPen": "scroll",
    "navlock/touch/penSeen": "scroll",
    "annotate/mouse/noPen": "draw",
    "annotate/mouse/penSeen": "draw",
    "annotate/pen/noPen": "draw",
    "annotate/pen/penSeen": "draw",
    "annotate/touch/noPen": "draw",
    "annotate/touch/penSeen": "scroll",
  });
});

test("toolKindOf: navlock is its own kind, null/pointer is none, drawing tools annotate", () => {
  expect(toolKindOf(null)).toBe("none");
  expect(toolKindOf(undefined)).toBe("none");
  expect(toolKindOf("pointer")).toBe("none");
  expect(toolKindOf("none")).toBe("none");
  expect(toolKindOf("navlock")).toBe("navlock");
  expect(toolKindOf("highlight")).toBe("annotate");
  expect(toolKindOf("underline")).toBe("annotate");
  expect(toolKindOf("ink")).toBe("annotate");
});

// --- which pointers the router drives itself --------------------------------

test("routesAsContact: the stylus joins the router only under the navigation lock", () => {
  for (const t of tools) {
    expect(routesAsContact(t, "touch")).toBe(true);
    expect(routesAsContact(t, "mouse")).toBe(false);
    expect(routesAsContact(t, "pen")).toBe(t === "navlock");
  }
});

test("routesAsContact: the desktop mouse is never intercepted, lock or not", () => {
  expect(routesAsContact("navlock", "mouse")).toBe(false);
});

test("planFinger: an annotation tool shuts the engine off at pointerdown, the others do not", () => {
  // A drawing tool starts its stroke on pointerdown, so a finger that is going
  // to scroll has to pause the engine before the lead-in leaves ink. With no
  // drawing tool the pause waits for the commit, so a stationary tap still
  // reaches the engine.
  expect(planFinger("annotate", true)).toEqual({
    action: "scroll",
    pauseAtDown: true,
    longPressSelect: false,
  });
  expect(planFinger("annotate", false)).toEqual({
    action: "draw",
    pauseAtDown: false,
    longPressSelect: false,
  });
  for (const penSeen of [false, true]) {
    expect(planFinger("none", penSeen)).toEqual({
      action: "scroll",
      pauseAtDown: false,
      longPressSelect: true,
    });
    expect(planFinger("navlock", penSeen)).toEqual({
      action: "scroll",
      pauseAtDown: false,
      longPressSelect: false,
    });
  }
});

test("planPointer: under the lock the stylus gets the finger's plan, byte for byte", () => {
  for (const penSeen of [false, true]) {
    expect(planPointer("navlock", "pen", penSeen)).toEqual(planPointer("navlock", "touch", penSeen));
  }
});

test("planPointer: the navigation lock never hands a pointer to text selection", () => {
  for (const p of pointers) {
    expect(planPointer("navlock", p, true).longPressSelect).toBe(false);
    expect(planPointer("navlock", p, true).action).toBe("scroll");
  }
});

test("planFinger drives both layouts: the paged tool is the same verdict", () => {
  for (const t of tools) {
    for (const penSeen of [false, true]) {
      const expected = planFinger(t, penSeen).action === "scroll" ? "pointer" : "pen";
      expect(pagedGestureTool(t, penSeen)).toBe(expected);
    }
  }
});

test("pagedGestureTool: with no tool, and under the lock, a swipe always turns", () => {
  for (const penSeen of [false, true]) {
    expect(pagedGestureTool("none", penSeen)).toBe("pointer");
    expect(pagedGestureTool("navlock", penSeen)).toBe("pointer");
  }
});

test("pagedGestureTool: annotate finger turns once a stylus is seen, else draws", () => {
  expect(pagedGestureTool("annotate", true)).toBe("pointer");
  expect(pagedGestureTool("annotate", false)).toBe("pen");
});

test("shouldCommitScroll: a horizontal-only move past the slop still commits to scroll (never draws)", () => {
  expect(shouldCommitScroll(20, 0, 6)).toBe(true);
});

test("shouldCommitScroll: vertical and diagonal moves past the slop commit", () => {
  expect(shouldCommitScroll(0, 20, 6)).toBe(true);
  expect(shouldCommitScroll(15, 15, 6)).toBe(true);
  expect(shouldCommitScroll(-9, 2, 6)).toBe(true); // horizontal dominant, opposite sign
});

test("shouldCommitScroll: sub-slop jitter in any direction does not commit (tap stays a tap)", () => {
  expect(shouldCommitScroll(0, 0, 6)).toBe(false);
  expect(shouldCommitScroll(5, 5, 6)).toBe(false);
  expect(shouldCommitScroll(-5, 3, 6)).toBe(false);
});

test("shouldCommitScroll: commit fires exactly at the slop threshold", () => {
  expect(shouldCommitScroll(6, 0, 6)).toBe(true);
  expect(shouldCommitScroll(0, 6, 6)).toBe(true);
});

test("pointerKindOf normalizes pointerType, unknown falls back to touch", () => {
  expect(pointerKindOf("mouse")).toBe("mouse");
  expect(pointerKindOf("pen")).toBe("pen");
  expect(pointerKindOf("touch")).toBe("touch");
  expect(pointerKindOf("")).toBe("touch");
  expect(pointerKindOf("kinect")).toBe("touch");
});

// --- finger-count semantics -------------------------------------------------

test("touchGestureMode: 1 finger routes, 2 pinch, 3+ reserved", () => {
  expect(touchGestureMode(0)).toBe("single");
  expect(touchGestureMode(1)).toBe("single");
  expect(touchGestureMode(2)).toBe("pinch");
  expect(touchGestureMode(3)).toBe("reserved");
  expect(touchGestureMode(5)).toBe("reserved");
});

test("multiTouchLatch: latches on the second finger, clears only when all lift", () => {
  let l = false;
  l = multiTouchLatch(l, 1);
  expect(l).toBe(false);
  l = multiTouchLatch(l, 2);
  expect(l).toBe(true);
  l = multiTouchLatch(l, 1); // one finger lifted mid-pinch: still locked
  expect(l).toBe(true);
  l = multiTouchLatch(l, 0);
  expect(l).toBe(false);
});

test("multiTouchLatch: 2 -> 3 -> 2 stays one gesture", () => {
  let l = multiTouchLatch(false, 2);
  l = multiTouchLatch(l, 3);
  expect(l).toBe(true);
  l = multiTouchLatch(l, 2);
  expect(l).toBe(true);
  expect(multiTouchLatch(l, 0)).toBe(false);
});

test("fingerLockAfterPen: the pen kills the fingers already down until all lift", () => {
  let lock = false;
  lock = fingerLockAfterPen(lock, false, 1); // a finger is scrolling
  expect(lock).toBe(false);
  lock = fingerLockAfterPen(lock, true, 1); // pen lands on top of it
  expect(lock).toBe(true);
  lock = fingerLockAfterPen(lock, false, 2); // more of the hand settles: still dead
  expect(lock).toBe(true);
  lock = fingerLockAfterPen(lock, false, 0); // hand off the glass
  expect(lock).toBe(false);
});

test("fingerLockAfterPen: a pen landing on an empty screen locks nothing", () => {
  expect(fingerLockAfterPen(false, true, 0)).toBe(false);
});

test("fingerVerdict: only a plain one-finger gesture reaches the engine", () => {
  expect(fingerVerdict("single", false, false)).toBe("route");
  expect(fingerVerdict("pinch", true, false)).toBe("swallow");
  expect(fingerVerdict("reserved", true, false)).toBe("swallow");
  // Latched pinch that dropped back to one finger.
  expect(fingerVerdict("single", true, false)).toBe("swallow");
  // Pen priority beats everything.
  expect(fingerVerdict("single", false, true)).toBe("swallow");
});

// --- two-finger gesture arming ----------------------------------------------

test("two contacts are two fingers: the pinch arms and swallows the pointers", () => {
  // Every touch that reaches the router counts. Nothing is filtered by contact
  // size — see docs/pitfall/39 — so a pinch always reaches the pinch rules,
  // which is what keeps a zoom from dragging out a text selection.
  const mode = touchGestureMode(2);
  expect(mode).toBe("pinch");
  expect(fingerVerdict(mode, multiTouchLatch(false, 2), false)).toBe("swallow");
});

// --- pan / selection helpers ------------------------------------------------

test("centroidOf: midpoint of the live contacts, null when there are none", () => {
  expect(centroidOf([])).toBe(null);
  expect(centroidOf([{ x: 10, y: 20 }])).toEqual({ x: 10, y: 20 });
  expect(
    centroidOf([
      { x: 0, y: 0 },
      { x: 10, y: 40 },
    ]),
  ).toEqual({ x: 5, y: 20 });
});

test("shouldClearGestureSelection: drop what this gesture caused, keep what was already there", () => {
  expect(shouldClearGestureSelection(false, true)).toBe(true);
  expect(shouldClearGestureSelection(true, true)).toBe(false);
  expect(shouldClearGestureSelection(false, false)).toBe(false);
});
