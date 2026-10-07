import { expect, test } from "bun:test";
import {
  routePointer,
  toolKindOf,
  pointerKindOf,
  routesAsContact,
  planFinger,
  planPointer,
  shouldCommitScroll,
  touchGestureMode,
  multiTouchLatch,
  fingerLockAfterPen,
  fingerVerdict,
  centroidOf,
  shouldClearGestureSelection,
  shouldHandEngineTheUp,
  type PointerKind,
  type ToolKind,
} from "./touch-routing";

// Full routing table, all pointer kinds, all tool kinds.
const tools: ToolKind[] = ["none", "navlock", "annotate"];
const pointers: PointerKind[] = ["mouse", "pen", "touch"];

test("the navigation lock scrolls every device", () => {
  for (const p of pointers) expect(routePointer("navlock", p)).toBe("scroll");
});

test("no tool selected: the finger scrolls, the stylus and mouse go to the engine", () => {
  expect(routePointer("none", "touch")).toBe("scroll");
  expect(routePointer("none", "pen")).toBe("draw");
  expect(routePointer("none", "mouse")).toBe("draw");
});

// The finger never draws, tool or no tool: it marks only by a hold (docs/82).
test("annotate tool: mouse and pen draw, the finger scrolls", () => {
  expect(routePointer("annotate", "mouse")).toBe("draw");
  expect(routePointer("annotate", "pen")).toBe("draw");
  expect(routePointer("annotate", "touch")).toBe("scroll");
});

test("exhaustive table snapshot", () => {
  const table: Record<string, string> = {};
  for (const t of tools) for (const p of pointers) table[`${t}/${p}`] = routePointer(t, p);
  expect(table).toEqual({
    "none/mouse": "draw",
    "none/pen": "draw",
    "none/touch": "scroll",
    "navlock/mouse": "scroll",
    "navlock/pen": "scroll",
    "navlock/touch": "scroll",
    "annotate/mouse": "draw",
    "annotate/pen": "draw",
    "annotate/touch": "scroll",
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
  expect(planFinger("annotate")).toEqual({
    action: "scroll",
    pauseAtDown: true,
    holdSelects: true,
    engineMayDrag: true,
  });
  expect(planFinger("none")).toEqual({
    action: "scroll",
    pauseAtDown: false,
    holdSelects: true,
    engineMayDrag: true,
  });
  expect(planFinger("navlock")).toEqual({
    action: "scroll",
    pauseAtDown: false,
    holdSelects: false,
    engineMayDrag: false,
  });
});

// --- the navigation lock never lets the engine watch a drag -----------------

test("planPointer: under the lock no device lets the engine follow the drag", () => {
  // The lock scrolls correctly on its own; what leaked was the engine watching
  // the same stylus slide and dragging a text selection out under it. The
  // engine does not read pointerType, so this holds for every device.
  for (const p of pointers) expect(planPointer("navlock", p).engineMayDrag).toBe(false);
});

test("planPointer: outside the lock the stylus keeps its full reach", () => {
  // Selecting text and drawing with the Pencil is the whole desktop/no-tool
  // path; the fix must not touch it.
  for (const t of ["none", "annotate"] as const) {
    expect(planPointer(t, "pen").engineMayDrag).toBe(true);
    expect(planPointer(t, "pen").action).toBe("draw");
    expect(planPointer(t, "mouse").engineMayDrag).toBe(true);
  }
});

test("planPointer: under the lock a pointer still reaches the engine at down and up", () => {
  // Only the drag is taken away. The pause is what would take the tap with it,
  // and the lock does not ask for it: a tap under the lock still dismisses an
  // overlay and still selects an annotation.
  for (const p of pointers) expect(planPointer("navlock", p).pauseAtDown).toBe(false);
});

test("planPointer: under the lock the stylus gets the finger's plan, byte for byte", () => {
  expect(planPointer("navlock", "pen")).toEqual(planPointer("navlock", "touch"));
});

test("planPointer: a hold selects with every tool but the lock, and only for a finger", () => {
  for (const p of pointers) expect(planPointer("navlock", p).holdSelects).toBe(false);
  expect(planPointer("none", "touch").holdSelects).toBe(true);
  expect(planPointer("annotate", "touch").holdSelects).toBe(true);
  expect(planPointer("none", "pen").holdSelects).toBe(false);
  expect(planPointer("annotate", "mouse").holdSelects).toBe(false);
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

test("shouldHandEngineTheUp: only a down the engine heard, and only while it can still hear", () => {
  expect(shouldHandEngineTheUp(true, false)).toBe(true);
  // Paused at down (an annotation tool): the engine never saw it, owes nothing.
  expect(shouldHandEngineTheUp(false, false)).toBe(false);
  // Already paused: the event would be dropped and the anchor would survive it.
  expect(shouldHandEngineTheUp(true, true)).toBe(false);
  expect(shouldHandEngineTheUp(false, true)).toBe(false);
});
