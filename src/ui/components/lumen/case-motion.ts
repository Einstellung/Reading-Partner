// How the case arrives and how it leaves (docs/68). Lumen pulls it out from
// behind itself and sets it down; when the box is empty it puts it back and the
// case is gone. A case that appeared on its own and a body that only looked at
// it were two things, not one act.
//
// Everything here is arithmetic on the same fractions of the body's box that
// case-box.ts is written in, so the path reproduces at 72px or at any other
// size, and the resting end of it is caseRect() itself and not a number near it.
//
// The path has two legs. The first is behind the body: from hidden — the case
// centred on the body's ink, where the whole rectangle is inside the round body
// and nothing peeks out — down and to the left, to a point clear of the body's
// ink. That is where the case changes layer, in front of the body instead of
// under it; the point is chosen so the two do not overlap there, because a
// layer swapped over an overlap is a pop. The second leg sets it down into the
// resting spot, growing back to full size so it reads as coming toward the
// viewer.
//
// Progress is a clock and not an ease: it runs toward its target at a constant
// rate and the easing is in the path. That is what makes a reversal free — the
// box emptying during a pull-out only changes the target, and the case turns
// back from wherever it is.

import type { CSSProperties } from "react";

import { showsCase } from "./box-cards";
import { BODY_INK_PX, BODY_RASTER_PX, CASE_HIT_PAD_PX, caseRect, type CaseRect } from "./case-box";
import { GAZE_K_ACT, SCAN_DOWN, clampGaze, type Gaze } from "./lumen-motion";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Endpoints exact: the resting pose has to be caseRect() and not a rounding of it. */
function lerp(a: number, b: number, t: number): number {
  return t <= 0 ? a : t >= 1 ? b : a + (b - a) * t;
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * The round body, as a circle in the box's fractions: the ink's centre, and the
 * largest circle that fits inside the ink's box. The hidden case has to sit
 * inside this, which is the whole reason it is written down.
 */
export const BODY_CIRCLE = (() => {
  const w = BODY_INK_PX.right - BODY_INK_PX.left + 1;
  const h = BODY_INK_PX.bottom - BODY_INK_PX.top + 1;
  return {
    x: (BODY_INK_PX.left + w / 2) / BODY_RASTER_PX,
    /** From the bottom of the box, the way `CaseRect.bottom` is. */
    y: (BODY_RASTER_PX - (BODY_INK_PX.top + h / 2)) / BODY_RASTER_PX,
    r: Math.min(w, h) / 2 / BODY_RASTER_PX,
    /** The ink's left edge, which is what the case has to get clear of. */
    left: BODY_INK_PX.left / BODY_RASTER_PX,
  };
})();

/** How small the case is while it is still behind the body. */
export const BEHIND_SCALE = 0.92;

/**
 * The gap the case keeps past the body's ink at the point it changes layer, and
 * how far it is lifted there. Fractions of the box, written as pixels at the
 * 72px corner because that is the size they were judged at.
 */
const CORNER_PX = 72;
export const OUT_GAP = 2 / CORNER_PX;
export const OUT_LIFT = 3 / CORNER_PX;

/** Where the first leg ends and the case comes round in front of the body. */
export const SWITCH_P = 0.7;

const REST = caseRect();
/** The two ends of the first leg, as the unscaled rectangle's left and bottom. */
const HIDDEN = {
  left: BODY_CIRCLE.x - REST.width / 2,
  bottom: BODY_CIRCLE.y - REST.height / 2,
};
const OUT = {
  // Left by the whole overlap with the ink, and then clear of it.
  left: REST.left - (REST.left + REST.width - BODY_CIRCLE.left) - OUT_GAP,
  bottom: REST.bottom + OUT_LIFT,
};

export interface CasePose extends CaseRect {
  /** True while the case is drawn under the body rather than beside it. */
  behind: boolean;
}

/** The case's box at this much progress, the scale already in the rectangle. */
export function casePose(progress: number): CasePose {
  const p = clamp01(progress);
  if (p < SWITCH_P) {
    const t = smoothstep(p / SWITCH_P);
    return pose(
      lerp(HIDDEN.left, OUT.left, t),
      lerp(HIDDEN.bottom, OUT.bottom, t),
      BEHIND_SCALE,
      true,
    );
  }
  const t = smoothstep((p - SWITCH_P) / (1 - SWITCH_P));
  return pose(
    lerp(OUT.left, REST.left, t),
    lerp(OUT.bottom, REST.bottom, t),
    lerp(BEHIND_SCALE, 1, t),
    false,
  );
}

/** A leg's position, shrunk about its own centre. */
function pose(left: number, bottom: number, scale: number, behind: boolean): CasePose {
  const width = REST.width * scale;
  const height = REST.height * scale;
  return {
    left: left + (REST.width - width) / 2,
    bottom: bottom + (REST.height - height) / 2,
    width,
    height,
    behind,
  };
}

/**
 * The trigger's own box at this much progress: the case, grown by the touch
 * target on every side. `box-content` on the element is what makes the padding
 * grow outwards rather than eat the drawing, so the case draws at about 24px in
 * the corner and the finger still gets 44.
 */
export function caseTriggerStyle(progress: number): CSSProperties {
  const box = casePose(progress);
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  return {
    left: `calc(${pct(box.left)} - ${CASE_HIT_PAD_PX}px)`,
    bottom: `calc(${pct(box.bottom)} - ${CASE_HIT_PAD_PX}px)`,
    width: pct(box.width),
    height: pct(box.height),
    padding: `${CASE_HIT_PAD_PX}px`,
    // Under the body while it is being pulled out, beside it once it is out.
    // The corner's wrapper is a stacking context of its own (`isolate`), which
    // is what keeps a negative layer under the body and still over the page.
    zIndex: box.behind ? -1 : undefined,
  };
}

// The clock.

/** How long the whole pull-out takes, and how long the put-away takes. */
export const PULL_MS = 550;
export const PUT_MS = 450;

export interface CaseMotion {
  /** 0 hidden behind the body, 1 standing in its place. */
  p: number;
  /** Where it is headed. */
  target: 0 | 1;
  /** Whether the count has ever been read. Before that there is nothing to act on. */
  read: boolean;
}

/** Nothing read yet, which is not the same as an empty box. */
export const CASE_START: CaseMotion = { p: 0, target: 0, read: false };

/**
 * A new reading of the count. The first one is not an act: an app that starts
 * with items in the box finds the case already standing there, and the pull-out
 * is for something that arrives while somebody is watching. `instant` is
 * reduced motion, where there is no path at all.
 */
export function aimCase(state: CaseMotion, openCount: number, instant = false): CaseMotion {
  const count = Number.isFinite(openCount) ? openCount : 0;
  const target: 0 | 1 = showsCase(count) ? 1 : 0;
  if (!state.read || instant) {
    return state.read && state.p === target && state.target === target
      ? state
      : { p: target, target, read: true };
  }
  if (target === state.target) return state;
  return { ...state, target };
}

/** Progress after another `dtMs` of running toward the target. */
export function stepCase(state: CaseMotion, dtMs: number): CaseMotion {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return state;
  const step = dtMs / (state.target === 1 ? PULL_MS : PUT_MS);
  const p = state.target === 1 ? Math.min(1, state.p + step) : Math.max(0, state.p - step);
  return p === state.p ? state : { ...state, p };
}

/** Nothing left to do: the case is where it was told to be. */
export function caseSettled(state: CaseMotion): boolean {
  return state.p === state.target;
}

/** Whether there is a case in the corner at all. Nothing in the box, nothing drawn. */
export function caseDrawn(state: CaseMotion): boolean {
  return !(state.p === 0 && state.target === 0);
}

/** Standing in its place: the only time it is a button and wears the badge. */
export function caseAtRest(state: CaseMotion): boolean {
  return state.p === 1 && state.target === 1;
}

// What the body does about it.

/**
 * How much of the act the body is in right now: one mutable number the corner
 * writes every frame and Lumen reads on its own, because a prop would be a
 * render per frame.
 */
export interface CaseReach {
  w: number;
}

/**
 * Where the case is, in the eye-widths the gaze is written in: down, and as far
 * to the left as an iris goes. The case stands off the body's left edge, so the
 * direction is the corner of the socket and the clamp is what puts it there.
 */
export const CASE_LOOK: Gaze = clampGaze({ x: -0.75, y: SCAN_DOWN });

/** The pull on the eyes, taken from the act the motion is borrowed from. */
export const CASE_LOOK_K = GAZE_K_ACT.check;

/**
 * How far the body leans over the case at the height of the reach. Negative is
 * counter-clockwise about the feet, which puts the head out over the case on
 * the left; the body's own lean toward the reader is the other way.
 */
export const CASE_LEAN_DEG = -4;

/** How much of the trip the reach takes to come on, and to go off again. */
export const REACH_RAMP = 0.25;

/**
 * How much the body is in the act, this far along. Zero at both ends — the case
 * hidden and the case set down are both a body standing straight — and a pure
 * function of progress, so a reversal carries the eyes and the lean back with
 * it instead of stranding them.
 */
export function caseReach(progress: number): number {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return 0;
  return clamp01(Math.min(p, 1 - p) / REACH_RAMP);
}

/** Where the eyes are asked to point at that much reach. */
export function caseLookGaze(reach: number): Gaze {
  const w = clamp01(reach);
  return { x: CASE_LOOK.x * w, y: CASE_LOOK.y * w };
}

/** The lean at that much reach, in degrees on `--lumen-tilt`. */
export function caseLeanDeg(reach: number): number {
  return CASE_LEAN_DEG * clamp01(reach);
}

/** The ease the gaze is written with, for one number, so the lean travels with it. */
export function easeToward(current: number, target: number, dtMs: number, k: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
  const pull = Number.isFinite(k) ? Math.min(Math.max(k, 0.001), 1) : 0.08;
  const factor = 1 - Math.pow(1 - pull, dtMs / (1000 / 60));
  return current + (target - current) * factor;
}
