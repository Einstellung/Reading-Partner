// The one gesture Lumen has: hold it to open the voice session, hold it again
// to end it (docs/68).
//
// A press is not a decision until it has lasted. What makes the gesture legible
// is that the body charges while the finger is down — the pool of light it
// stands in and its halo come up over HOLD_MS — and reaching full charge is
// what fires. Let go early and the charge ramps back down and nothing happened;
// the same gesture done twice therefore reads as two directions rather than as
// a toggle nobody can see the state of. This matters most on the iPad, which
// has no vibration motor at all: the light is the whole confirmation there.
//
// All of that is arithmetic over a pointer's timeline, so it is here and not in
// the corner. The component binds the events and writes one custom property.

/** How long the finger has to stay down. */
export const HOLD_MS = 500;

/** How far it may wander first. Past this the press is a scroll, not a hold. */
export const HOLD_MOVE_PX = 10;

/** How long the charge takes to drain once the finger is off. */
export const HOLD_FADE_MS = 200;

export type HoldInput =
  | { kind: "down"; x: number; y: number; at: number }
  | { kind: "move"; x: number; y: number; at: number }
  | { kind: "up"; at: number }
  | { kind: "cancel"; at: number }
  | { kind: "tick"; at: number };

export interface HoldState {
  /** Where and when the finger went down, and whether it has already fired. */
  readonly pressed: { readonly x: number; readonly y: number; readonly at: number; readonly fired: boolean } | null;
  /** A charge left behind by a release, draining from `from` since `at`. */
  readonly fade: { readonly from: number; readonly at: number } | null;
}

export interface HoldStep {
  readonly state: HoldState;
  /** Full charge was reached on this step. The toggle fires once per press. */
  readonly fired: boolean;
}

export const HOLD_REST: HoldState = { pressed: null, fade: null };

/** How charged the body is, in 0..1. */
export function holdCharge(state: HoldState, now: number): number {
  if (state.pressed) return clamp01((now - state.pressed.at) / HOLD_MS);
  if (!state.fade) return 0;
  const left = 1 - (now - state.fade.at) / HOLD_FADE_MS;
  return left <= 0 ? 0 : clamp01(state.fade.from * left);
}

/**
 * Whether anything is still moving — a finger down, or a charge still draining.
 * The corner runs its frame loop exactly while this is true.
 */
export function holdMoving(state: HoldState, now: number): boolean {
  return state.pressed !== null || holdCharge(state, now) > 0;
}

export function holdStep(state: HoldState, input: HoldInput): HoldStep {
  switch (input.kind) {
    case "down":
      // A second finger is not a second press: the first one owns the body
      // until it lets go.
      if (state.pressed) return still(state);
      return still({ pressed: { x: input.x, y: input.y, at: input.at, fired: false }, fade: null });
    case "move": {
      const pressed = state.pressed;
      if (!pressed) return still(state);
      if (Math.hypot(input.x - pressed.x, input.y - pressed.y) <= HOLD_MOVE_PX) return still(state);
      return still(release(state, input.at));
    }
    case "up": {
      const pressed = state.pressed;
      if (!pressed) return still(state);
      // The safety net under the tick: a frame loop can be throttled or a
      // release can land between two frames, and a press that reached full
      // charge has fired whether or not a tick saw it.
      const late = !pressed.fired && input.at - pressed.at >= HOLD_MS;
      return { state: release(state, input.at), fired: late };
    }
    case "cancel":
      if (!state.pressed) return still(state);
      return still(release(state, input.at));
    case "tick": {
      const pressed = state.pressed;
      if (!pressed || pressed.fired) return still(state);
      if (input.at - pressed.at < HOLD_MS) return still(state);
      // Fired under the finger, not on the release: the haptic and the
      // session have to arrive at the moment the body reaches full light,
      // which is what the person is watching.
      return { state: { ...state, pressed: { ...pressed, fired: true } }, fired: true };
    }
  }
}

/**
 * The charge the body keeps after a press ends. Firing does not end it — the
 * finger is usually still down when the session opens — so a release always
 * drains from wherever the ramp had got to.
 */
function release(state: HoldState, at: number): HoldState {
  const from = holdCharge(state, at);
  return { pressed: null, fade: from > 0 ? { from, at } : null };
}

function still(state: HoldState): HoldStep {
  return { state, fired: false };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
