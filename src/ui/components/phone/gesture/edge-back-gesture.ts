// The left-edge back swipe on the phone shell (docs/22). The machine itself is
// axis-gesture.ts, shared with the pull down to ask; this file is what makes it
// a back swipe — the x axis, the edge band, and the thresholds, which are the
// whole gesture and need to be readable and testable without a device.
//
// Why an edge band and not the whole page: an article can carry a wide table or
// a code block that scrolls sideways (docs/pitfall/68 is about exactly those on
// a phone). A page-wide horizontal swipe would take those over, so the gesture
// only starts within EDGE_ZONE of the left edge, where nothing scrolls.
//
// A vertical drag that starts at the edge scrolls the page natively; the
// browser then sends a pointercancel and this machine drops the gesture.
// Claiming the gesture is what takes the pointer over, and only a rightward,
// horizontally dominant move claims it (see shouldClaimTouch — the claim runs
// on the raw touch channel, because the pointer channel cannot hold a gesture
// the browser has decided to scroll with).

import {
  classifyAxisMove,
  initAxisGestureState,
  shouldClaimAxisTouch,
  stepAxisGesture,
  type AxisGestureInput,
  type AxisGesturePhase,
  type AxisGestureSpec,
  type AxisGestureState,
} from "./axis-gesture";

// Distance from the left edge a gesture may start in, CSS px. UIKit's own
// screen-edge recognizer lives in roughly the outer 20pt; 24 is that with a
// margin, and still under the 44px touch target the rest of the UI uses, so the
// band is never wide enough to look like a control of its own.
export const EDGE_ZONE = 24;
// Movement before a gesture commits. Same 10px the reader uses — it was tuned
// on a device, and this gesture starts from the same kind of finger.
export const SLOP = 10;
// The dominant axis must beat the other by this much, so a diagonal keeps
// waiting instead of guessing.
export const AXIS_RATIO = 1.2;
// Fraction of the width the drag must pass to commit. The reader commits a page
// turn at 0.22; a back is coarser on purpose, because it is not symmetrical —
// an unwanted page turn costs one more swipe, an unwanted back costs the screen
// you were reading and its scroll position, and there is no forward.
export const COMMIT_FRACTION = 0.35;
// Fling speed, px/ms, that commits regardless of distance. Just above the
// reader's 0.45 for the same reason.
export const COMMIT_VELOCITY = 0.5;

// Rightward movement, in CSS px, at which the host takes the gesture away from
// the browser by cancelling the touch. Far below SLOP on purpose: the browser
// decides whether a touch is a scroll well before the gesture has resolved, and
// once it has decided it cancels the pointer and the swipe is over. Measured in
// Chromium with touch emulation: preventing the touch at 3px keeps the pointer
// alive to its pointerup, waiting for 10px is already too late, and preventing
// only the first move does not hold the sequence (docs/pitfall/70).
export const TOUCH_CLAIM_PX = 3;

// Whether a touch that started in the band has moved enough, and clearly
// enough sideways, to be taken from the browser.
export function shouldClaimTouch(
  dx: number,
  dy: number,
  claimPx: number = TOUCH_CLAIM_PX,
  ratio: number = AXIS_RATIO,
): boolean {
  return shouldClaimAxisTouch(dx, dy, claimPx, ratio);
}

export interface EdgeBackConfig {
  // Width of the sliding surface in CSS px, read once when the gesture starts.
  width: number;
  edgeZone?: number;
  slop?: number;
  axisRatio?: number;
  commitFraction?: number;
  commitVelocity?: number;
}

type Cfg = Required<EdgeBackConfig>;

function resolve(config: EdgeBackConfig): Cfg {
  return {
    edgeZone: EDGE_ZONE,
    slop: SLOP,
    axisRatio: AXIS_RATIO,
    commitFraction: COMMIT_FRACTION,
    commitVelocity: COMMIT_VELOCITY,
    ...config,
  };
}

export type EdgeBackInput =
  // x is measured from the left edge of the surface, not the viewport.
  AxisGestureInput;

export type EdgeBackCommand =
  // The gesture is ours from here: setPointerCapture(id) and preventDefault.
  | { type: "capture"; id: number }
  // Follow the finger: the surface sits dx px to the right of rest.
  | { type: "dragMove"; dx: number }
  // Released. `back` true means run the back action, false means settle home.
  | { type: "dragEnd"; back: boolean };

export type EdgeBackPhase = AxisGesturePhase;

export type EdgeBackState = AxisGestureState;

export function initEdgeBackState(): EdgeBackState {
  return initAxisGestureState();
}

// --- pure decision helpers (exported for direct unit tests) -----------------

export function inEdgeZone(x: number, edgeZone: number): boolean {
  return x >= 0 && x <= edgeZone;
}

// What a move past the slop means: "back" once it is rightward and horizontally
// dominant, "abandon" once it is vertical or leftward, "wait" while it is still
// small or too diagonal to call.
export function classifyMove(
  dx: number,
  dy: number,
  slop: number,
  ratio: number,
): "wait" | "back" | "abandon" {
  const verdict = classifyAxisMove(dx, dy, slop, ratio);
  return verdict === "go" ? "back" : verdict;
}

// Whether a release goes back. A fling wins by its direction, so a fast flick
// commits early and a flick back cancels however far the finger travelled;
// otherwise the drag has to have passed commitFraction of the width.
export function resolveEdgeBack(
  dx: number,
  vx: number,
  width: number,
  commitFraction: number,
  commitVelocity: number,
): boolean {
  if (vx >= commitVelocity) return true;
  if (vx <= -commitVelocity) return false;
  return dx >= width * commitFraction;
}

function spec(cfg: Cfg): AxisGestureSpec<unknown, EdgeBackCommand> {
  return {
    axis: "x",
    slop: cfg.slop,
    axisRatio: cfg.axisRatio,
    canStart: (down) => inEdgeZone(down.x, cfg.edgeZone),
    moveCommand: (dx) => ({ type: "dragMove", dx }),
    endCommand: (dx, vx, cancelled) => ({
      type: "dragEnd",
      back: cancelled
        ? false
        : resolveEdgeBack(dx, vx, cfg.width, cfg.commitFraction, cfg.commitVelocity),
    }),
  };
}

// Fold one input in. The input state is treated as immutable; a shallow clone
// is mutated and returned.
export function stepEdgeBack(
  prev: EdgeBackState,
  input: EdgeBackInput,
  config: EdgeBackConfig,
): { state: EdgeBackState; commands: EdgeBackCommand[] } {
  return stepAxisGesture(prev, input, spec(resolve(config)));
}
