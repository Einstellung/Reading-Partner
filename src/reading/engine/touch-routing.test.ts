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
  shouldHandEngineTheUp,
  type PointerKind,
  type ToolKind,
} from "./touch-routing";

// Full routing table, both fingerDraw values, all pointer kinds, all tool kinds.
const tools: ToolKind[] = ["none", "navlock", "annotate"];
const pointers: PointerKind[] = ["mouse", "pen", "touch"];

test("the navigation lock scrolls every device, whatever the setting says", () => {
  for (const p of pointers) {
    expect(routePointer("navlock", p, false)).toBe("scroll");
    expect(routePointer("navlock", p, true)).toBe("scroll");
  }
});

test("no tool selected: the finger scrolls, the stylus and mouse go to the engine", () => {
  for (const fingerDraw of [false, true]) {
    expect(routePointer("none", "touch", fingerDraw)).toBe("scroll");
    expect(routePointer("none", "pen", fingerDraw)).toBe("draw");
    expect(routePointer("none", "mouse", fingerDraw)).toBe("draw");
  }
});

test("annotate tool: mouse and pen always draw", () => {
  for (const fingerDraw of [false, true]) {
    expect(routePointer("annotate", "mouse", fingerDraw)).toBe("draw");
    expect(routePointer("annotate", "pen", fingerDraw)).toBe("draw");
  }
});

// The reported bug: with a drawing tool selected the finger did nothing at all
// in vertical mode, because it was routed to the annotation layer on a device
// whose stylus had not touched the glass yet. The finger scrolls by default now,
// tool or no tool.
test("annotate tool: the finger scrolls by default, and only draws when told to", () => {
  expect(routePointer("annotate", "touch", false)).toBe("scroll");
  expect(routePointer("annotate", "touch", true)).toBe("draw");
});

test("exhaustive table snapshot", () => {
  const table: Record<string, string> = {};
  for (const t of tools) {
    for (const p of pointers) {
      for (const fingerDraw of [false, true]) {
        table[`${t}/${p}/${fingerDraw ? "fingerDraw" : "default"}`] = routePointer(t, p, fingerDraw);
      }
    }
  }
  expect(table).toEqual({
    "none/mouse/default": "draw",
    "none/mouse/fingerDraw": "draw",
    "none/pen/default": "draw",
    "none/pen/fingerDraw": "draw",
    "none/touch/default": "scroll",
    "none/touch/fingerDraw": "scroll",
    "navlock/mouse/default": "scroll",
    "navlock/mouse/fingerDraw": "scroll",
    "navlock/pen/default": "scroll",
    "navlock/pen/fingerDraw": "scroll",
    "navlock/touch/default": "scroll",
    "navlock/touch/fingerDraw": "scroll",
    "annotate/mouse/default": "draw",
    "annotate/mouse/fingerDraw": "draw",
    "annotate/pen/default": "draw",
    "annotate/pen/fingerDraw": "draw",
    "annotate/touch/default": "scroll",
    "annotate/touch/fingerDraw": "draw",
  });
});

test("the navigation lock outranks the setting: nothing draws while it is on", () => {
  for (const p of pointers) {
    expect(routePointer("navlock", p, true)).toBe("scroll");
    expect(planPointer("navlock", p, true).action).toBe("scroll");
    expect(pagedGestureTool("navlock", true)).toBe("pointer");
  }
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
  expect(planFinger("annotate", false)).toEqual({
    action: "scroll",
    pauseAtDown: true,
    longPressSelect: false,
    engineMayDrag: true,
  });
  expect(planFinger("annotate", true)).toEqual({
    action: "draw",
    pauseAtDown: false,
    longPressSelect: false,
    engineMayDrag: true,
  });
  for (const fingerDraw of [false, true]) {
    expect(planFinger("none", fingerDraw)).toEqual({
      action: "scroll",
      pauseAtDown: false,
      longPressSelect: true,
      engineMayDrag: true,
    });
    expect(planFinger("navlock", fingerDraw)).toEqual({
      action: "scroll",
      pauseAtDown: false,
      longPressSelect: false,
      engineMayDrag: false,
    });
  }
});

// --- the navigation lock never lets the engine watch a drag -----------------

test("planPointer: under the lock no device lets the engine follow the drag", () => {
  // The lock scrolls correctly on its own; what leaked was the engine watching
  // the same stylus slide and dragging a text selection out under it. The
  // engine does not read pointerType, so this holds for every device.
  for (const p of pointers) {
    for (const fingerDraw of [false, true]) {
      expect(planPointer("navlock", p, fingerDraw).engineMayDrag).toBe(false);
    }
  }
});

test("planPointer: outside the lock the stylus keeps its full reach", () => {
  // Selecting text and drawing with the Pencil is the whole desktop/no-tool
  // path; the fix must not touch it.
  for (const t of ["none", "annotate"] as const) {
    for (const fingerDraw of [false, true]) {
      expect(planPointer(t, "pen", fingerDraw).engineMayDrag).toBe(true);
      expect(planPointer(t, "pen", fingerDraw).action).toBe("draw");
      expect(planPointer(t, "mouse", fingerDraw).engineMayDrag).toBe(true);
    }
  }
});

test("planPointer: under the lock a pointer still reaches the engine at down and up", () => {
  // Only the drag is taken away. The pause is what would take the tap with it,
  // and the lock does not ask for it: a tap under the lock still dismisses an
  // overlay and still selects an annotation.
  for (const p of pointers) {
    expect(planPointer("navlock", p, false).pauseAtDown).toBe(false);
  }
});

test("planPointer: under the lock the stylus gets the finger's plan, byte for byte", () => {
  for (const fingerDraw of [false, true]) {
    expect(planPointer("navlock", "pen", fingerDraw)).toEqual(planPointer("navlock", "touch", fingerDraw));
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
    for (const fingerDraw of [false, true]) {
      const expected = planFinger(t, fingerDraw).action === "scroll" ? "pointer" : "pen";
      expect(pagedGestureTool(t, fingerDraw)).toBe(expected);
    }
  }
});

test("pagedGestureTool: with no tool, and under the lock, a swipe always turns", () => {
  for (const fingerDraw of [false, true]) {
    expect(pagedGestureTool("none", fingerDraw)).toBe("pointer");
    expect(pagedGestureTool("navlock", fingerDraw)).toBe("pointer");
  }
});

// The two layouts cannot disagree about what a finger is for. Before, the same
// state (drawing tool, no stylus seen) meant "swipe from the edge to turn" in
// paged and "nothing at all" in vertical, which is exactly what a stuck reader
// looked like.
test("pagedGestureTool: a drawing tool turns pages by default, and draws when told to", () => {
  expect(pagedGestureTool("annotate", false)).toBe("pointer");
  expect(pagedGestureTool("annotate", true)).toBe("pen");
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
