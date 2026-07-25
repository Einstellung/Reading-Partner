import { expect, test } from "bun:test";
import {
  routePointer,
  toolKindOf,
  pointerKindOf,
  pagedGestureTool,
  shouldCommitScroll,
  touchGestureMode,
  multiTouchLatch,
  fingerLockAfterPen,
  fingerVerdict,
  isPalmContact,
  centroidOf,
  shouldClearGestureSelection,
  PALM_CONTACT_PX,
  PALM_CONTACT_PX_WITH_PEN,
  type PointerKind,
  type ToolKind,
} from "./touch-routing";

// Full routing table, both penSeen values, all pointer kinds, both tools.
const tools: ToolKind[] = ["hand", "annotate"];
const pointers: PointerKind[] = ["mouse", "pen", "touch"];

test("hand tool always scrolls, regardless of pointer or penSeen", () => {
  for (const p of pointers) {
    expect(routePointer("hand", p, false)).toBe("scroll");
    expect(routePointer("hand", p, true)).toBe("scroll");
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
    "hand/mouse/noPen": "scroll",
    "hand/mouse/penSeen": "scroll",
    "hand/pen/noPen": "scroll",
    "hand/pen/penSeen": "scroll",
    "hand/touch/noPen": "scroll",
    "hand/touch/penSeen": "scroll",
    "annotate/mouse/noPen": "draw",
    "annotate/mouse/penSeen": "draw",
    "annotate/pen/noPen": "draw",
    "annotate/pen/penSeen": "draw",
    "annotate/touch/noPen": "draw",
    "annotate/touch/penSeen": "scroll",
  });
});

test("toolKindOf maps null/pointer to hand, drawing tools to annotate", () => {
  expect(toolKindOf(null)).toBe("hand");
  expect(toolKindOf(undefined)).toBe("hand");
  expect(toolKindOf("pointer")).toBe("hand");
  expect(toolKindOf("highlight")).toBe("annotate");
  expect(toolKindOf("underline")).toBe("annotate");
  expect(toolKindOf("ink")).toBe("annotate");
});

test("pagedGestureTool: hand always turns with a finger", () => {
  expect(pagedGestureTool("hand", false)).toBe("pointer");
  expect(pagedGestureTool("hand", true)).toBe("pointer");
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

// --- palm rejection ---------------------------------------------------------

test("isPalmContact: a fingertip-sized patch is never a palm", () => {
  expect(isPalmContact({ width: 24, height: 26 }, false)).toBe(false);
  expect(isPalmContact({ width: 24, height: 26 }, true)).toBe(false);
});

test("isPalmContact: a wide patch is a palm, and the pen makes the bar lower", () => {
  expect(isPalmContact({ width: PALM_CONTACT_PX, height: 20 }, false)).toBe(true);
  expect(isPalmContact({ width: PALM_CONTACT_PX_WITH_PEN, height: 20 }, false)).toBe(false);
  expect(isPalmContact({ width: PALM_CONTACT_PX_WITH_PEN, height: 20 }, true)).toBe(true);
  expect(isPalmContact({ width: 20, height: PALM_CONTACT_PX }, false)).toBe(true);
});

test("isPalmContact: engines that report no contact geometry never yield a palm", () => {
  expect(isPalmContact({ width: 0, height: 0 }, true)).toBe(false);
  expect(isPalmContact({ width: 1, height: 1 }, true)).toBe(false);
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
