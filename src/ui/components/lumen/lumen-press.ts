// What a press on Lumen means (docs/68, 2026-10-15): a tap opens his
// conversation, a hold talks to him.
//
// The hold itself is hold-toggle.ts: the charge, the 500 ms, the light at full.
// What full charge does is decided here. During a call it hangs up; where a
// call could start it starts one; anywhere else — a screen with nothing to talk
// about, a host that cannot speak — there is no hold at all (the corner turns
// the charge off) and a long press is just a press, which opens the
// conversation like a tap.
//
// The tap is the release of a press that neither travelled past the drag's
// slop nor reached full charge, and not the click that follows it: a touch held
// long on iOS may bring no click at all, and where the hold is off a long press
// has to be a tap. The click a release brings is swallowed; a click with no
// press before it is a keyboard's Enter, and that opens the conversation too.
//
// The desktop's right-click is the hold, without the charge.
//
// Pure arithmetic over the press's timeline, so the corner only binds events.

export interface LumenPressState {
  /** The press on the body in progress: whether it became a drag or fired. */
  readonly press: { readonly dragged: boolean; readonly fired: boolean } | null;
  /** The click the last release brings is that press's, and means nothing. */
  readonly swallowClick: boolean;
}

/** What the corner knows at the moment a press fires or a right-click lands. */
export interface LumenPressContext {
  /** A call is up. */
  live: boolean;
  /** A call could start from here (voice-context.ts and a host that can speak). */
  canVoice: boolean;
}

export type LumenPressInput =
  | { kind: "down" }
  | { kind: "dragged" }
  | ({ kind: "fired" } & LumenPressContext)
  | { kind: "up" }
  | { kind: "cancel" }
  | { kind: "click" }
  | ({ kind: "context" } & LumenPressContext);

/** What the corner has to do about a step. */
export type LumenPressEffect = "open-door" | "voice" | "hang-up" | null;

export interface LumenPressStep {
  readonly state: LumenPressState;
  readonly effect: LumenPressEffect;
}

export const PRESS_REST: LumenPressState = { press: null, swallowClick: false };

/** What a hold, or a right-click, does here. */
export function holdEffect(context: LumenPressContext): Exclude<LumenPressEffect, null> {
  if (context.live) return "hang-up";
  return context.canVoice ? "voice" : "open-door";
}

export function lumenPressStep(state: LumenPressState, input: LumenPressInput): LumenPressStep {
  switch (input.kind) {
    case "down":
      // A second finger is not a second press.
      if (state.press) return still(state);
      return still({ press: { dragged: false, fired: false }, swallowClick: false });
    case "dragged":
      if (!state.press || state.press.dragged) return still(state);
      return still({ ...state, press: { ...state.press, dragged: true } });
    case "fired": {
      const press = state.press;
      // A press that already travelled is a drag; the drag cancelled the hold
      // on the move that claimed it, so a fire after that is a stale frame.
      if (press?.dragged || press?.fired) return still(state);
      return {
        state: { ...state, press: { dragged: false, fired: true } },
        effect: holdEffect(input),
      };
    }
    case "up": {
      const press = state.press;
      if (!press) return still(state);
      // A press that neither travelled nor fired is the tap, on its release.
      // The click the release brings is swallowed either way.
      const tap = !press.dragged && !press.fired;
      return { state: { press: null, swallowClick: true }, effect: tap ? "open-door" : null };
    }
    case "cancel":
      // No click follows a cancelled press.
      return still(PRESS_REST);
    case "click":
      if (state.swallowClick) return still({ ...state, swallowClick: false });
      return { state: { ...state, swallowClick: false }, effect: "open-door" };
    case "context":
      // A press already on the body owns it: a host that raises the context
      // menu from a long touch must not act on the hold a second way.
      if (state.press) return still(state);
      return { state: { ...state, swallowClick: false }, effect: holdEffect(input) };
  }
}

/**
 * Which press starts a hold. A mouse's other buttons do not: the right one is
 * the desktop's own way to talk, and holding it down must not also charge.
 */
export function startsHold(pointerType: string, button: number): boolean {
  return pointerType !== "mouse" || button === 0;
}

function still(state: LumenPressState): LumenPressStep {
  return { state, effect: null };
}
