// A mouse that selects words (docs/info/88 「简报书」). In a brief the desktop has
// no AI pen, so the mouse with no tool in hand drags out the same selection a
// held finger makes (docs/82), and the shell offers Highlight / Ask over it.
// Elsewhere a mouse with no tool selects nothing: a drag turns the page.
//
// A press on the words is held back until the mouse moves: a click stays a
// click (a mark opens, a link is followed, a side of the page turns). A press
// that put a selection away does nothing else, as a finger's does, but a drag
// from it still selects anew.

import type { PointerKind, ToolKind } from "../../engine/gesture/touch-routing";

/** How far, in CSS px, a mouse pressed on the words moves before it is selecting. */
export const MOUSE_SELECT_SLOP = 4;

export interface MousePress {
  /** A drag from this press selects words. */
  selects: boolean;
  /** A press that never became a selection is still not a click. */
  swallowsClick: boolean;
}

export interface MousePressInput {
  /** Whether this reader lets the mouse select (the brief's mode). */
  enabled: boolean;
  tool: ToolKind;
  pointer: PointerKind;
  /** The press put a selection away (engine/gesture/put-away.ts). */
  putAway: boolean;
  /** The press landed on the words of a page. */
  onWords: boolean;
}

/** What a press is to the mouse's selection; null when it is not the selection's. */
export function mousePress(input: MousePressInput): MousePress | null {
  if (!input.enabled || input.pointer !== "mouse" || input.tool !== "none") return null;
  if (!input.onWords && !input.putAway) return null;
  return { selects: input.onWords, swallowsClick: input.putAway };
}

/** Whether a mouse pressed on the words has moved far enough to be selecting. */
export function mouseSelectBegins(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= MOUSE_SELECT_SLOP;
}
