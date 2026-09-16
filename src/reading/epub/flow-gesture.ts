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

import type { FlowTool } from "./flow-contract";

/** How long a finger must stay put before it starts a highlight. */
export const LONG_PRESS_MS = 500;

/** How far a pressed finger may drift and still be pressing, not scrolling. */
export const PRESS_SLOP_PX = 8;

export type PressState =
  | { phase: "idle" }
  | { phase: "pressed"; pointerId: number; x: number; y: number; at: number; onWords: boolean }
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
    }
  | { kind: "move"; pointerId: number; x: number; y: number; t: number }
  /** The long-press timer fired. */
  | { kind: "hold"; pointerId: number; t: number }
  | { kind: "up"; pointerId: number; x: number; y: number; t: number }
  | { kind: "cancel"; pointerId: number };

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

export function pressStep(state: PressState, event: PressEvent): { state: PressState; effect: PressEffect } {
  switch (state.phase) {
    case "idle": {
      if (event.kind !== "down" || !event.primary) return { state, effect: "none" };
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
        },
        effect: event.onWords ? "arm" : "none",
      };
    }
    case "pressed": {
      if (event.kind === "down" || event.pointerId !== state.pointerId) return { state, effect: "none" };
      switch (event.kind) {
        case "move":
          if (distance(state.x, state.y, event.x, event.y) > PRESS_SLOP_PX) {
            return { state: { phase: "released", pointerId: state.pointerId }, effect: "none" };
          }
          return { state, effect: "none" };
        case "hold":
          if (state.onWords && event.t - state.at >= LONG_PRESS_MS) {
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

/** The reflow column's type: what the sheet's 16px/1.55 becomes on a phone. */
export const FLOW_FONT_PX = 17;
export const FLOW_LINE_HEIGHT = 1.6;
/** The column's side padding. */
export const FLOW_PAD_X = 20;
/** Room above the first line and below the last of each document. */
export const FLOW_PAD_Y = 24;

/**
 * A guess at how tall a document lays out in a column this wide, for
 * `contain-intrinsic-size` while it is off screen: its characters over an
 * average glyph width, in lines of the column's line height. The browser
 * remembers the real height once the document has been laid out, so the guess
 * only has to be the right order of magnitude.
 */
export function intrinsicHeightEstimate(chars: number, columnWidth: number): number {
  const line = Math.max(1, columnWidth - 2 * FLOW_PAD_X);
  const perLine = Math.max(1, Math.floor(line / (FLOW_FONT_PX * 0.5)));
  const lines = Math.ceil(chars / perLine);
  return Math.max(120, Math.round(lines * FLOW_FONT_PX * FLOW_LINE_HEIGHT + 2 * FLOW_PAD_Y));
}
