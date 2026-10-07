// What a finger pressed on the words means, with no DOM in it: a tap, a hold
// that selects (docs/82), or nothing of the reader's. A press held still for
// LONG_PRESS_MS on the words starts a selection; with the highlight pen in hand
// (the phone's column only) a press on the words starts one at once. A press
// that travels before that is somebody else's — the browser's scroll, the touch
// router's follow — and ends.
//
// Every surface a finger selects on feeds it: the phone's column and paged view
// (reading/epub/flow) and the touch router the iPad and the desktop pages run
// under (attach-touch.ts). One reducer, so the hold has one timing everywhere.
// It is told what it cannot know: whether the press landed on the words, and
// which pen is in hand. Every effect it answers with is one thing the caller
// then does.

/** The pen a press is made with: only the phone's column has one to hold. */
export type PressTool = "none" | "highlight";

/** How long a finger must stay put before it starts a highlight. */
export const LONG_PRESS_MS = 500;

/** How far a pressed finger may drift and still be pressing, not scrolling. */
export const PRESS_SLOP_PX = 8;

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
      tool: PressTool;
      /** The first contact; a second finger is never a press. */
      primary: boolean;
      /**
       * Travel past which the press is over. PRESS_SLOP_PX (the default)
       * where travel is somebody else's gesture: the browser's scroll, the
       * shell's back swipe. The phone's paged view allows more on its page
       * (flow-gesture.ts: PAGED_TAP_SLOP_PX). A hold
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
