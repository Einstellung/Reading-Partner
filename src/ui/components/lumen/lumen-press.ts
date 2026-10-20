// What a press on Lumen means (docs/68): a tap opens his conversation, during a
// voice call too; a press that travels is the corner being dragged.
//
// The tap is the release of a press that did not travel past the drag's slop,
// and not the click that follows it: a touch held long on iOS may bring no
// click at all, and a long press still has to be a tap. The click a release
// brings is swallowed; a click with no press before it is a keyboard's Enter,
// and that opens the conversation too.
//
// Pure arithmetic over the press's timeline, so the corner only binds events.

export interface LumenPressState {
  /** The press on the body in progress: whether it became a drag. */
  readonly press: { readonly dragged: boolean } | null;
  /** The click the last release brings is that press's, and means nothing. */
  readonly swallowClick: boolean;
}

export type LumenPressInput =
  | { kind: "down" }
  | { kind: "dragged" }
  | { kind: "up" }
  | { kind: "cancel" }
  | { kind: "click" };

/** What the corner has to do about a step. */
export type LumenPressEffect = "open-door" | null;

export interface LumenPressStep {
  readonly state: LumenPressState;
  readonly effect: LumenPressEffect;
}

export const PRESS_REST: LumenPressState = { press: null, swallowClick: false };

export function lumenPressStep(state: LumenPressState, input: LumenPressInput): LumenPressStep {
  switch (input.kind) {
    case "down":
      // A second finger is not a second press.
      if (state.press) return still(state);
      return still({ press: { dragged: false }, swallowClick: false });
    case "dragged":
      if (!state.press || state.press.dragged) return still(state);
      return still({ ...state, press: { dragged: true } });
    case "up": {
      const press = state.press;
      if (!press) return still(state);
      // A press that did not travel is the tap, on its release. The click the
      // release brings is swallowed either way.
      return { state: { press: null, swallowClick: true }, effect: press.dragged ? null : "open-door" };
    }
    case "cancel":
      // No click follows a cancelled press.
      return still(PRESS_REST);
    case "click":
      if (state.swallowClick) return still({ ...state, swallowClick: false });
      return { state: { ...state, swallowClick: false }, effect: "open-door" };
  }
}

/** Which press is a press on the body: a mouse's other buttons are not. */
export function startsPress(pointerType: string, button: number): boolean {
  return pointerType !== "mouse" || button === 0;
}

function still(state: LumenPressState): LumenPressStep {
  return { state, effect: null };
}
