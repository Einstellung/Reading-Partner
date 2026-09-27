// Pull down at the top of the briefing or an article to open the chat that is
// already about it (docs/22). The machine itself is axis-gesture.ts, shared with
// the left-edge back swipe; this file is what makes it a pull — the y axis, the
// at-the-top gate, and the thresholds.
//
// This is not pull to refresh. What comes out of the top is a conversation about
// what is already on screen, not new content — the phone's answer to "I want to
// ask something", not to "give me more". The thresholds below are written for
// that: nothing is fetched, nothing is lost, and the only cost of a misfire is
// one back to close the chat.
//
// The gesture may only start with the screen already at the top, so it never
// competes with a scroll in progress: a pull that begins mid-page is a scroll
// and stays one for the rest of the sequence. That check belongs to the host,
// which reads the scroll container and reports it on pointerdown.

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

// How close to the top counts as the top, in CSS px. Not zero: WebKit hands out
// fractional scroll positions, and a scroll that settles against the top can sit
// at 0.5 forever.
export const TOP_EPSILON = 2;
// Movement before the gesture commits. Same 10px as the edge back swipe and the
// reader, tuned on a device.
export const SLOP = 10;
// The dominant axis must beat the other by this much, so a diagonal keeps
// waiting instead of guessing. Deliberately the same number the edge back swipe
// uses: with both gestures demanding dominance by the same ratio, a move can
// never satisfy both, and the two machines never claim the same finger.
export const AXIS_RATIO = 1.2;
// How far the finger has to pull before a release opens the chat, CSS px. Blunt
// on purpose. The move it must not be confused with is the one that ends a
// scroll: a reader who flicks up to the top of the article and keeps flicking
// travels tens of pixels downward at the top with no intention of asking
// anything. 96 is more than twice the 44px touch target and about an eighth of a
// 852pt screen — far enough that the pull is a decision, close enough that a
// thumb reaches it without a second grab.
export const COMMIT_DISTANCE = 96;
// Speed, px/ms, at which a flick back up cancels however far the finger got.
// Same value the edge back swipe commits at, used here only in the cancelling
// direction: there is deliberately no commit-by-fling, because a fast downward
// flick is exactly what arriving at the top of a page looks like.
export const CANCEL_VELOCITY = 0.5;
// Past the commit distance the pull keeps moving, but damped, and stops at
// MAX_PULL: the surface has to keep answering the finger (a screen that freezes
// reads as broken), while making it obvious that nothing further is coming.
export const PULL_RESIST = 0.35;
export const MAX_PULL = 140;

// Downward movement, CSS px, at which the host takes the touch away from the
// browser on the raw touch channel. The browser decides a touch is a scroll long
// before the gesture has resolved, and once it has, it cancels the pointer and
// the gesture is over (docs/pitfall/70). Vertical is the harder direction: down
// is the axis the scroll container itself wants.
//
// The number is not a sensitivity setting. The browser withholds touchmove until
// the touch has passed its own slop, so the first move it hands over has already
// travelled 16px at a slow drag and more at a fast one, and claiming has to
// happen on that first move or not at all (docs/pitfall/71: measured in Chromium,
// everything from 1 to 16 behaves identically and 20 is already too late). So it
// only has to be small enough that any possible first move satisfies it — the
// same 3 the edge back swipe uses, for the same reason.
export const TOUCH_CLAIM_PX = 3;

export function isAtTop(scrollTop: number, epsilon: number = TOP_EPSILON): boolean {
  return scrollTop <= epsilon;
}

// Whether a touch that started at the top has moved enough, and clearly enough
// downward, to be taken from the browser.
export function shouldClaimTouch(
  dx: number,
  dy: number,
  claimPx: number = TOUCH_CLAIM_PX,
  ratio: number = AXIS_RATIO,
): boolean {
  return shouldClaimAxisTouch(dy, dx, claimPx, ratio);
}

// What a move past the slop means: "ask" once it is downward and vertically
// dominant, "abandon" once it is sideways or upward, "wait" while it is still
// small or too diagonal to call.
export function classifyMove(
  dx: number,
  dy: number,
  slop: number,
  ratio: number,
): "wait" | "ask" | "abandon" {
  const verdict = classifyAxisMove(dy, dx, slop, ratio);
  return verdict === "go" ? "ask" : verdict;
}

// How far the surface actually moves for a given pull: one to one up to the
// commit distance, damped past it, and never beyond MAX_PULL.
export function followPull(
  dy: number,
  commit: number = COMMIT_DISTANCE,
  resist: number = PULL_RESIST,
  maxPull: number = MAX_PULL,
): number {
  if (dy <= 0) return 0;
  if (dy <= commit) return dy;
  return Math.min(maxPull, commit + (dy - commit) * resist);
}

// Whether a release opens the chat. Distance decides; a flick back up cancels
// regardless of it (see CANCEL_VELOCITY for why speed never commits).
export function resolvePullToAsk(
  dy: number,
  vy: number,
  commit: number = COMMIT_DISTANCE,
  cancelVelocity: number = CANCEL_VELOCITY,
): boolean {
  if (vy <= -cancelVelocity) return false;
  return dy >= commit;
}

export interface PullToAskConfig {
  slop?: number;
  axisRatio?: number;
  commitDistance?: number;
  cancelVelocity?: number;
  resist?: number;
  maxPull?: number;
}

type Cfg = Required<PullToAskConfig>;

function resolve(config: PullToAskConfig): Cfg {
  return {
    slop: SLOP,
    axisRatio: AXIS_RATIO,
    commitDistance: COMMIT_DISTANCE,
    cancelVelocity: CANCEL_VELOCITY,
    resist: PULL_RESIST,
    maxPull: MAX_PULL,
    ...config,
  };
}

export type PullToAskInput =
  // atTop is the host's reading of the scroll container under the finger at the
  // moment it landed. False makes the whole sequence a scroll.
  AxisGestureInput<{ atTop: boolean }>;

export type PullToAskCommand =
  // The gesture is ours from here: setPointerCapture(id) and preventDefault.
  | { type: "capture"; id: number }
  // Follow the finger. `offset` is already damped and clamped; `armed` says the
  // pull has passed the commit distance, which is what the affordance has to
  // show — the reader must know what a release does before releasing.
  | { type: "pullMove"; offset: number; armed: boolean }
  // Released. `ask` true means open the chat, false means settle back.
  | { type: "pullEnd"; ask: boolean };

export type PullToAskPhase = AxisGesturePhase;

export type PullToAskState = AxisGestureState;

export function initPullToAskState(): PullToAskState {
  return initAxisGestureState();
}

function spec(cfg: Cfg): AxisGestureSpec<{ atTop: boolean }, PullToAskCommand> {
  return {
    axis: "y",
    slop: cfg.slop,
    axisRatio: cfg.axisRatio,
    canStart: (down) => down.atTop,
    moveCommand: (dy) => ({
      type: "pullMove",
      offset: followPull(dy, cfg.commitDistance, cfg.resist, cfg.maxPull),
      armed: dy >= cfg.commitDistance,
    }),
    endCommand: (dy, vy, cancelled) => ({
      type: "pullEnd",
      ask: cancelled ? false : resolvePullToAsk(dy, vy, cfg.commitDistance, cfg.cancelVelocity),
    }),
  };
}

// Fold one input in. The input state is treated as immutable; a shallow clone is
// mutated and returned.
export function stepPullToAsk(
  prev: PullToAskState,
  input: PullToAskInput,
  config: PullToAskConfig = {},
): { state: PullToAskState; commands: PullToAskCommand[] } {
  return stepAxisGesture(prev, input, spec(resolve(config)));
}
