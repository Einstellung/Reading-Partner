import { expect, test } from "bun:test";
import {
  routePointer,
  toolKindOf,
  pointerKindOf,
  pagedGestureTool,
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

test("pointerKindOf normalizes pointerType, unknown falls back to touch", () => {
  expect(pointerKindOf("mouse")).toBe("mouse");
  expect(pointerKindOf("pen")).toBe("pen");
  expect(pointerKindOf("touch")).toBe("touch");
  expect(pointerKindOf("")).toBe("touch");
  expect(pointerKindOf("kinect")).toBe("touch");
});
