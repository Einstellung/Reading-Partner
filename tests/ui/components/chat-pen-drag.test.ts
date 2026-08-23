// The pen dragged across a reply: which pointers draw, where the drag has got
// to, how it is held inside the one reply it started in, and what a finished
// drag is worth (docs/09).
//
// The point of the first group is that the classroom answers with the reader's
// own table rather than one of its own, so it is asserted against that table
// and not against a copy of its verdicts.
//
// Run: bun test.
import { expect, test } from "bun:test";
import {
  beginPenDrag,
  chatTouchAction,
  createGestureLatch,
  dragOffset,
  drawFromSpan,
  movePenDrag,
  penDragSpan,
  routeChatPointer,
} from "../../../src/ui/components/chat/chat-pen-drag";
import {
  pointerKindOf,
  routePointer,
  toolKindOf,
} from "../../../src/reading/engine/gesture/touch-routing";
import type { MarkPen } from "../../../src/platform/app/reader-contract";

const PENS: (MarkPen | null)[] = [null, "highlight", "underline", "ai"];
const POINTERS = ["mouse", "pen", "touch", ""];

test("every pointer is routed by the reader's table, not by one of the classroom's", () => {
  for (const pen of PENS) {
    for (const pointerType of POINTERS) {
      for (const fingerDraw of [false, true]) {
        expect(routeChatPointer(pen, pointerType, fingerDraw)).toBe(
          routePointer(toolKindOf(pen), pointerKindOf(pointerType), fingerDraw),
        );
      }
    }
  }
});

// The verdicts that matter on the surface, spelled out so a change to the table
// that would change what a reply does has to be made here too.
test("a pen in hand marks with the stylus and the mouse; the finger moves the lesson", () => {
  expect(routeChatPointer("highlight", "pen", false)).toBe("draw");
  expect(routeChatPointer("highlight", "mouse", false)).toBe("draw");
  expect(routeChatPointer("highlight", "touch", false)).toBe("scroll");
  expect(routeChatPointer("highlight", "touch", true)).toBe("draw");
});

test("with no pen in hand nothing is drawn, whatever the pointer", () => {
  for (const pointerType of POINTERS) {
    for (const fingerDraw of [false, true]) {
      // "draw" for a mouse or a stylus here means the surface's own pointer
      // pipeline — a native selection — not a stroke: the classroom only takes a
      // gesture when a pen is in hand.
      expect(routeChatPointer(null, pointerType, fingerDraw)).toBe(
        pointerKindOf(pointerType) === "touch" ? "scroll" : "draw",
      );
    }
  }
});

test("a reply gives up its scrolling only where a finger is meant to draw", () => {
  expect(chatTouchAction("highlight", true)).toBe("none");
  expect(chatTouchAction("highlight", false)).toBeUndefined();
  expect(chatTouchAction(null, true)).toBeUndefined();
  expect(chatTouchAction(null, false)).toBeUndefined();
});

// --- the drag ---------------------------------------------------------------

test("a press that never moved is not a stroke", () => {
  expect(penDragSpan(beginPenDrag(2, 1, 7))).toBeNull();
});

test("a drag names the words between where it started and where it is", () => {
  const drag = movePenDrag(beginPenDrag(2, 1, 4), 11);
  expect(penDragSpan(drag)).toEqual({ start: 4, end: 11 });
});

test("a drag made backwards names the same words", () => {
  const drag = movePenDrag(beginPenDrag(2, 1, 11), 4);
  expect(penDragSpan(drag)).toEqual({ start: 4, end: 11 });
  expect(drag.anchor).toBe(11);
});

test("a move that changed nothing gives the same drag back, so nothing repaints", () => {
  const drag = movePenDrag(beginPenDrag(2, 1, 4), 11);
  expect(movePenDrag(drag, 11)).toBe(drag);
  expect(movePenDrag(drag, null)).toBe(drag);
  expect(movePenDrag(drag, 12)).not.toBe(drag);
});

// The drag holds one reply's offsets and nothing else, so the far end is held at
// that reply's edge rather than carried into the next answer.
test("a drag dragged past the reply is held at its edge", () => {
  const box = { top: 100, bottom: 200 };
  expect(dragOffset(null, 240, box, 30)).toBe(30);
  expect(dragOffset(null, 60, box, 30)).toBe(0);
});

test("a caret inside the reply is what the drag follows", () => {
  expect(dragOffset(12, 240, { top: 100, bottom: 200 }, 30)).toBe(12);
  expect(dragOffset(0, 60, { top: 100, bottom: 200 }, 30)).toBe(0);
});

test("a pointer beside the words is neither end, and the drag stays where it was", () => {
  expect(dragOffset(null, 150, { top: 100, bottom: 200 }, 30)).toBeNull();
});

// --- one gesture, one stroke ------------------------------------------------

test("the latch holds for the gesture that was taken and no longer", () => {
  const latch = createGestureLatch();
  expect(latch.taken()).toBe(false);
  latch.take();
  expect(latch.taken()).toBe(true);
  // Asking does not spend it: both listeners for one pointerup may ask.
  expect(latch.taken()).toBe(true);
  latch.begin();
  expect(latch.taken()).toBe(false);
});

// --- what a finished drag is worth ------------------------------------------

const REPLY = { text: "attention heads are three matrices", breaks: [] };

test("a stroke reports the words it caught and which copy of them", () => {
  expect(drawFromSpan(REPLY, { start: 20, end: 34 }, 2, "highlight")).toEqual({
    messageTs: 2,
    text: "three matrices",
    occurrence: 0,
    pen: "highlight",
  });
});

test("a repeated phrase is reported by the copy that was drawn over", () => {
  const repeated = { text: "a head is a head", breaks: [] };
  expect(drawFromSpan(repeated, { start: 10, end: 16 }, 7, "underline")).toEqual({
    messageTs: 7,
    text: "a head",
    occurrence: 1,
    pen: "underline",
  });
});

// The rendering runs one block's words straight into the next one's, which is
// right for finding a mark again and wrong everywhere the words are shown.
test("a stroke across a block seam carries the readable words as well", () => {
  const table = { text: "onetwo", breaks: [3] };
  expect(drawFromSpan(table, { start: 0, end: 6 }, 2, "underline")).toEqual({
    messageTs: 2,
    text: "onetwo",
    display: "one two",
    occurrence: 0,
    pen: "underline",
  });
});

test("an empty or blank span is no stroke", () => {
  expect(drawFromSpan(REPLY, { start: 9, end: 9 }, 2, "highlight")).toBeNull();
  expect(drawFromSpan(REPLY, { start: 11, end: 9 }, 2, "highlight")).toBeNull();
  expect(drawFromSpan({ text: "a b", breaks: [] }, { start: 1, end: 2 }, 2, "ai")).toBeNull();
});
