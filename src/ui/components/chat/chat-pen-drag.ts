// A pen dragged across a reply, as a state machine (docs/09). The classroom
// takes its verdict from the reader's own routing table
// (reading/engine/gesture/touch-routing.ts), so a stroke on an answer begins the
// way a stroke on a page does: the stylus and the mouse mark, the finger moves
// the view unless the reader has said otherwise. One table, two surfaces — a
// second one here would be a second answer to the same question.
//
// Pure and DOM-free. The caller resolves a screen point to an offset in the
// rendering (chat-mark-dom.ts) and hands the number in; what is decided here is
// which pointers draw, where the drag has got to, how it is held inside the one
// reply it started in, and what a finished drag is worth.

import type { MarkPen } from "../../../platform/app/reader-contract";
import type { ChatMarkDraw, ChatMarkSpan } from "../../../reading/chat-marks";
import { occurrenceAt } from "../../../reading/chat-marks";
import { spacedSlice, type RenderedText } from "./chat-mark-dom";
import {
  pointerKindOf,
  routePointer,
  toolKindOf,
  type RouteAction,
} from "../../../reading/engine/gesture/touch-routing";

// Which of the two the pointer is doing, with the pen the top bar holds standing
// in for the tool group. A pen in hand is a drawing tool ("annotate"); none is
// the pointer ("none"), and the surface then behaves as it always did — native
// selection, native scrolling. The navigation lock never reaches here: the shell
// resolves it to no pen at all before the host is built (App.tsx: chatPen).
export function routeChatPointer(
  pen: MarkPen | null,
  pointerType: string,
  fingerDraw: boolean,
): RouteAction {
  return routePointer(toolKindOf(pen), pointerKindOf(pointerType), fingerDraw);
}

// What a reply's box declares for touch, and the one place the finger's default
// is spelled out: `none` only when a finger is meant to draw, so a reply is
// scrollable under a finger in every other configuration. Chromium latches
// touch-action when the gesture starts, which is before the first move a
// handler could prevent, so the declaration has to be standing before the touch
// lands rather than applied once the drag is recognised.
export function chatTouchAction(pen: MarkPen | null, fingerDraw: boolean): "none" | undefined {
  return routeChatPointer(pen, "touch", fingerDraw) === "draw" ? "none" : undefined;
}

// A drag in flight: which reply it belongs to, which pointer is making it, where
// it started and where it has got to. Both ends are offsets into that one
// reply's rendering, which is what keeps a stroke from crossing into the next
// answer — there is no offset in this drag that names anything else.
export interface PenDrag {
  messageTs: number;
  pointerId: number;
  anchor: number;
  head: number;
}

export function beginPenDrag(messageTs: number, pointerId: number, at: number): PenDrag {
  return { messageTs, pointerId, anchor: at, head: at };
}

// The drag with the pointer where it is now. An offset of null is a point the
// caller could not place in this reply and would not clamp (dragOffset), so the
// drag stays where it was; an offset it already holds gives the same object
// back, so a move that changed nothing repaints nothing.
export function movePenDrag(drag: PenDrag, at: number | null): PenDrag {
  if (at === null || at === drag.head) return drag;
  return { ...drag, head: at };
}

// The words the drag covers, in the order the reply reads, or null when it
// covers none — a press that never moved, which is not a stroke.
export function penDragSpan(drag: PenDrag): ChatMarkSpan | null {
  const start = Math.min(drag.anchor, drag.head);
  const end = Math.max(drag.anchor, drag.head);
  return end > start ? { start, end } : null;
}

// The offset a moved pointer names, given what the caret API answered and where
// the pointer is against the reply's box.
//
// A drag that leaves the reply is held at its edge rather than let across: past
// the bottom is all of it, above the top is none of it. Beside the words — the
// pointer is level with the text but outside the box, where a caret lands in
// whatever is next to the reply — is neither end, so the drag keeps the last
// offset it had rather than snapping to a boundary the reader did not aim at.
export function dragOffset(
  caret: number | null,
  y: number,
  box: { top: number; bottom: number },
  length: number,
): number | null {
  if (caret !== null) return caret;
  if (y >= box.bottom) return length;
  if (y <= box.top) return 0;
  return null;
}

// One gesture, one stroke. The direct path and the long-press path both end on
// the same pointerup, and a gesture the pen took must not also be committed from
// whatever selection the browser was left holding. Preventing the default at
// pointerdown should leave that selection empty, but "should be empty" is not
// the same as "cannot commit", and the two paths are two listeners on one
// document.
export interface GestureLatch {
  // A pointer went down: a new gesture, nobody has taken it yet.
  begin(): void;
  // The direct path took this one.
  take(): void;
  taken(): boolean;
}

export function createGestureLatch(): GestureLatch {
  let held = false;
  return {
    begin: () => {
      held = false;
    },
    take: () => {
      held = true;
    },
    taken: () => held,
  };
}

// What a finished drag is worth: the stroke, or null when those offsets name no
// words worth marking. Both paths to a mark come through here, so the verbatim
// anchor string, the readable one and the copy number are produced the same way
// whichever gesture made them (docs/09).
//
// `display` is only carried when it differs from the anchor, which is the
// minority of strokes: one that stayed inside a block has the one string.
export function drawFromSpan(
  index: Pick<RenderedText, "text" | "breaks">,
  span: ChatMarkSpan,
  messageTs: number,
  pen: MarkPen,
): ChatMarkDraw | null {
  if (span.end <= span.start) return null;
  const text = index.text.slice(span.start, span.end);
  if (text.trim() === "") return null;
  const occurrence = occurrenceAt(index.text, text, span.start);
  if (occurrence < 0) return null;
  const display = spacedSlice(index, span.start, span.end);
  return {
    messageTs,
    text,
    ...(display === text ? {} : { display }),
    occurrence,
    pen,
  };
}
