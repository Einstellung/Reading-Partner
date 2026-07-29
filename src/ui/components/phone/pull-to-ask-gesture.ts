// Pull down at the top of the briefing or an article to open the chat that is
// already about it (docs/22). Pure and DOM-free, the same shape as
// edge-back-gesture.ts: it eats normalized pointer samples and emits commands
// the host turns into an offset and a call to the screen's own ask action.
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
// downward, to be taken from the browser. Same axis ratio the gesture itself
// uses, so a claim and a commit disagree as rarely as possible.
export function shouldClaimTouch(
  dx: number,
  dy: number,
  claimPx: number = TOUCH_CLAIM_PX,
  ratio: number = AXIS_RATIO,
): boolean {
  return dy >= claimPx && dy > Math.abs(dx) * ratio;
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
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "wait";
  if (ax >= ay * ratio) return "abandon"; // sideways: not this gesture
  if (ay >= ax * ratio) return dy > 0 ? "ask" : "abandon";
  return "wait"; // diagonal: let the move resolve
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
  | { type: "pointerdown"; id: number; x: number; y: number; t: number; atTop: boolean }
  | { type: "pointermove"; id: number; x: number; y: number; t: number }
  | { type: "pointerup"; id: number; x: number; y: number; t: number }
  | { type: "pointercancel"; id: number };

export type PullToAskCommand =
  // The gesture is ours from here: setPointerCapture(id) and preventDefault.
  | { type: "capture"; id: number }
  // Follow the finger. `offset` is already damped and clamped; `armed` says the
  // pull has passed the commit distance, which is what the affordance has to
  // show — the reader must know what a release does before releasing.
  | { type: "pullMove"; offset: number; armed: boolean }
  // Released. `ask` true means open the chat, false means settle back.
  | { type: "pullEnd"; ask: boolean };

export type PullToAskPhase =
  // Nothing in flight.
  | "idle"
  // A pointer is down at the top of the screen, still deciding.
  | "pending"
  // Following the finger.
  | "drag"
  // This pointer is not ours (the screen was scrolled, the move went the wrong
  // way, or a second finger landed). Ignored until every pointer is up.
  | "off";

export interface PullToAskState {
  phase: PullToAskPhase;
  pointerId: number | null;
  // How many pointers are down, so the machine only returns to idle when the
  // glass is clear: a second finger must not hand the gesture back mid-flight.
  downCount: number;
  startX: number;
  startY: number;
  // The raw distance pulled, before damping — what the thresholds are read
  // against, while the host is shown the damped offset.
  lastDy: number;
  vy: number; // smoothed vertical velocity, px/ms
  vLastY: number;
  vLastT: number;
}

export function initPullToAskState(): PullToAskState {
  return {
    phase: "idle",
    pointerId: null,
    downCount: 0,
    startX: 0,
    startY: 0,
    lastDy: 0,
    vy: 0,
    vLastY: 0,
    vLastT: 0,
  };
}

function updateVelocity(s: PullToAskState, y: number, t: number): void {
  const dt = Math.max(t - s.vLastT, 1);
  const inst = (y - s.vLastY) / dt;
  s.vy = s.vy * 0.3 + inst * 0.7;
  s.vLastY = y;
  s.vLastT = t;
}

function move(s: PullToAskState, cfg: Cfg, dy: number): PullToAskCommand {
  s.lastDy = Math.max(0, dy);
  return {
    type: "pullMove",
    offset: followPull(s.lastDy, cfg.commitDistance, cfg.resist, cfg.maxPull),
    armed: s.lastDy >= cfg.commitDistance,
  };
}

// Fold one input in. The input state is treated as immutable; a shallow clone is
// mutated and returned.
export function stepPullToAsk(
  prev: PullToAskState,
  input: PullToAskInput,
  config: PullToAskConfig = {},
): { state: PullToAskState; commands: PullToAskCommand[] } {
  const cfg = resolve(config);
  const s: PullToAskState = { ...prev };
  const cmds: PullToAskCommand[] = [];

  switch (input.type) {
    case "pointerdown": {
      s.downCount += 1;
      if (s.downCount > 1) {
        // A second finger is a pinch or a two-finger scroll, never a pull.
        if (s.phase === "drag") cmds.push({ type: "pullEnd", ask: false });
        s.phase = "off";
        s.pointerId = null;
        break;
      }
      s.pointerId = input.id;
      s.startX = input.x;
      s.startY = input.y;
      s.lastDy = 0;
      s.vy = 0;
      s.vLastY = input.y;
      s.vLastT = input.t;
      s.phase = input.atTop ? "pending" : "off";
      break;
    }

    case "pointermove": {
      if (input.id !== s.pointerId) break;
      updateVelocity(s, input.y, input.t);

      if (s.phase === "pending") {
        const verdict = classifyMove(
          input.x - s.startX,
          input.y - s.startY,
          cfg.slop,
          cfg.axisRatio,
        );
        if (verdict === "abandon") {
          s.phase = "off";
          break;
        }
        if (verdict === "wait") break;
        s.phase = "drag";
        cmds.push({ type: "capture", id: input.id });
        cmds.push(move(s, cfg, input.y - s.startY));
        break;
      }

      if (s.phase === "drag") {
        // Clamped at rest: pulling back past the start must not push the screen
        // off the top, it must only undo the pull.
        cmds.push(move(s, cfg, input.y - s.startY));
      }
      break;
    }

    case "pointerup":
    case "pointercancel": {
      const mine = input.id === s.pointerId;
      s.downCount = Math.max(0, s.downCount - 1);
      if (mine && s.phase === "drag") {
        if (input.type === "pointerup") updateVelocity(s, input.y, input.t);
        const ask =
          input.type === "pointercancel"
            ? false
            : resolvePullToAsk(s.lastDy, s.vy, cfg.commitDistance, cfg.cancelVelocity);
        cmds.push({ type: "pullEnd", ask });
      }
      if (mine) s.pointerId = null;
      // Only a clear screen returns the machine to idle: a finger left over from
      // an abandoned gesture must not start a new one mid-way.
      if (s.downCount === 0) return { state: initPullToAskState(), commands: cmds };
      s.phase = "off";
      break;
    }
  }

  return { state: s, commands: cmds };
}
