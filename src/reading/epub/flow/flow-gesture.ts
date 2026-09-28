// What a finger on the reflow view means, with no DOM in it (docs/70). The
// scroll is the browser's: the view never moves the page itself, so the only
// question a pointer sequence has to answer is whether it is a tap, a mark, or
// nothing of the view's. A press held still for LONG_PRESS_MS on the words
// starts a highlight; with the highlight pen in hand a press on the words
// starts one at once. A press that travels before that is the scroll's, and the
// browser cancels the pointer once it takes the touch.
//
// The reducer is fed by flow-view.ts and told what it cannot know: whether the
// press landed on the words (a caret was found under it) and which pen is in
// hand. Every effect it answers with is one thing the view then does.
//
// The paged view (paged-view.ts) feeds it too, with one difference: there
// nothing scrolls, and a drag is the page-turn router's, which follows the
// finger from 10px but only turns past a fifth of the screen or on a fling.
// A drift short of that springs back and is a tap, so the press there allows
// PAGED_TAP_SLOP_PX of travel, and the router's turn, when there is one, ends
// the press with a `yield` (docs/pitfall/489).

import type { FlowTool } from "./flow-contract";
import { FLOW_PAD_Y, type FlowDisplay } from "./flow-display";

/** How long a finger must stay put before it starts a highlight. */
export const LONG_PRESS_MS = 500;

/** How far a pressed finger may drift and still be pressing, not scrolling. */
export const PRESS_SLOP_PX = 8;

/**
 * How far a press may travel and still be a tap in the paged view, where no
 * travel is a scroll. Above the drift a real tap has (20px measured on the
 * simulator), well short of the 22% of the screen a drag needs to turn.
 */
export const PAGED_TAP_SLOP_PX = 30;

export type PressState =
  | { phase: "idle" }
  | {
      phase: "pressed";
      pointerId: number;
      x: number;
      y: number;
      at: number;
      onWords: boolean;
      /** Still within PRESS_SLOP_PX, so a hold can still start a mark. */
      still: boolean;
      /** Travel past which the press ends (see the down event). */
      slop: number;
    }
  | { phase: "marking"; pointerId: number }
  /** The browser or a large move has this pointer; nothing more is read from it. */
  | { phase: "released"; pointerId: number };

export type PressEvent =
  | {
      kind: "down";
      pointerId: number;
      x: number;
      y: number;
      t: number;
      /** Whether a caret was found under the press. */
      onWords: boolean;
      tool: FlowTool["type"];
      /** The first contact; a second finger is never a press. */
      primary: boolean;
      /**
       * Travel past which the press is over. PRESS_SLOP_PX (the default)
       * where travel is somebody else's gesture: the browser's scroll, the
       * shell's back swipe. PAGED_TAP_SLOP_PX on the paged view's page. A hold
       * starts a mark only within PRESS_SLOP_PX either way.
       */
      slopPx?: number;
    }
  | { kind: "move"; pointerId: number; x: number; y: number; t: number }
  /** The long-press timer fired. */
  | { kind: "hold"; pointerId: number; t: number }
  | { kind: "up"; pointerId: number; x: number; y: number; t: number }
  | { kind: "cancel"; pointerId: number }
  /** Another reader of the finger acted on it (the page-turn router turned). */
  | { kind: "yield"; pointerId: number };

export type PressEffect =
  | "none"
  /** Start the long-press timer for this press. */
  | "arm"
  | "start-mark"
  | "extend-mark"
  | "commit-mark"
  | "abandon-mark"
  | "tap";

export const IDLE: PressState = { phase: "idle" };

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function pressDown(event: Extract<PressEvent, { kind: "down" }>): { state: PressState; effect: PressEffect } {
  if (event.tool === "highlight" && event.onWords) {
    return { state: { phase: "marking", pointerId: event.pointerId }, effect: "start-mark" };
  }
  return {
    state: {
      phase: "pressed",
      pointerId: event.pointerId,
      x: event.x,
      y: event.y,
      at: event.t,
      onWords: event.onWords,
      still: true,
      slop: event.slopPx ?? PRESS_SLOP_PX,
    },
    effect: event.onWords ? "arm" : "none",
  };
}

export function pressStep(state: PressState, event: PressEvent): { state: PressState; effect: PressEffect } {
  // A first contact while a press or a released pointer is still on the books
  // means that pointer's end never reached us (someone above captured it, as the
  // shell's back swipe does): the glass is empty again, so this is a new press.
  if (
    event.kind === "down" &&
    event.primary &&
    (state.phase === "pressed" || state.phase === "released")
  ) {
    return pressDown(event);
  }
  switch (state.phase) {
    case "idle": {
      if (event.kind !== "down" || !event.primary) return { state, effect: "none" };
      return pressDown(event);
    }
    case "pressed": {
      if (event.kind === "down" || event.pointerId !== state.pointerId) return { state, effect: "none" };
      switch (event.kind) {
        case "move": {
          const d = distance(state.x, state.y, event.x, event.y);
          if (d > state.slop) {
            return { state: { phase: "released", pointerId: state.pointerId }, effect: "none" };
          }
          if (state.still && d > PRESS_SLOP_PX) return { state: { ...state, still: false }, effect: "none" };
          return { state, effect: "none" };
        }
        case "yield":
          return { state: { phase: "released", pointerId: state.pointerId }, effect: "none" };
        case "hold":
          if (state.onWords && state.still && event.t - state.at >= LONG_PRESS_MS) {
            return { state: { phase: "marking", pointerId: state.pointerId }, effect: "start-mark" };
          }
          return { state, effect: "none" };
        case "up":
          return { state: IDLE, effect: "tap" };
        case "cancel":
          return { state: IDLE, effect: "none" };
      }
      return { state, effect: "none" };
    }
    case "marking": {
      if (event.kind === "down" || event.pointerId !== state.pointerId) return { state, effect: "none" };
      switch (event.kind) {
        case "move":
          return { state, effect: "extend-mark" };
        case "up":
          return { state: IDLE, effect: "commit-mark" };
        case "cancel":
          return { state: IDLE, effect: "abandon-mark" };
        case "hold":
        case "yield":
          return { state, effect: "none" };
      }
      return { state, effect: "none" };
    }
    case "released": {
      if (event.kind === "down" || event.pointerId !== state.pointerId) return { state, effect: "none" };
      if (event.kind === "up" || event.kind === "cancel") return { state: IDLE, effect: "none" };
      return { state, effect: "none" };
    }
  }
}

/** Whether a press that went down at one point and up at another stayed a tap. */
export function stayedATap(downX: number, downY: number, upX: number, upY: number): boolean {
  return distance(downX, downY, upX, upY) <= PRESS_SLOP_PX;
}

/** Whether the view takes the touch off the browser on this move (docs/pitfall/117, 261). */
export function claimsTouch(state: PressState): boolean {
  return state.phase === "marking";
}

// ---------------------------------------------------------------- the word ---

const WORD_BREAK = /\s/;
// CJK and other scripts written without spaces: one character is the unit, or a
// hold would take the whole paragraph.
const UNSPACED = /[\u2E80-\u2FFF\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * The word around an offset in a text node, as the span a hold begins with:
 * back to the whitespace before it and on to the whitespace after. On a space
 * the word before it; in a script written without spaces, one character.
 */
export function wordBoundsAt(text: string, offset: number): { start: number; end: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  if (at < text.length && UNSPACED.test(text[at])) return { start: at, end: at + 1 };
  let anchor = at;
  if (at === text.length || WORD_BREAK.test(text[at])) {
    if (at === 0 || WORD_BREAK.test(text[at - 1])) return { start: at, end: at };
    anchor = at - 1;
    if (UNSPACED.test(text[anchor])) return { start: anchor, end: at };
  }
  const inWord = (c: string) => !WORD_BREAK.test(c) && !UNSPACED.test(c);
  let start = anchor;
  let end = anchor;
  while (start > 0 && inWord(text[start - 1])) start--;
  while (end < text.length && inWord(text[end])) end++;
  return { start, end };
}

// -------------------------------------------------------------- the column ---

/**
 * A guess at how tall a document lays out in a column this wide, for
 * `contain-intrinsic-size` while it is off screen: its characters over an
 * average glyph width, in lines of the column's line height. The browser
 * remembers the real height once the document has been laid out, so the guess
 * only has to be the right order of magnitude — but it is the reader's type
 * that decides it, so the display settings are an argument rather than a
 * constant (flow-display.ts).
 */
export function intrinsicHeightEstimate(
  chars: number,
  columnWidth: number,
  display: FlowDisplay,
): number {
  const line = Math.max(1, columnWidth - 2 * display.padX);
  const perLine = Math.max(1, Math.floor(line / (display.fontPx * 0.5)));
  const lines = Math.ceil(chars / perLine);
  return Math.max(120, Math.round(lines * display.fontPx * display.lineHeight + 2 * FLOW_PAD_Y));
}
