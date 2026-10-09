// What a hold on Lumen opens: a small menu beside the body with the two ways to
// talk to it, voice and typing (docs/68).
//
// The hold itself is still hold-toggle.ts: the charge, the 500 ms, the haptic at
// full light. What changed is what full charge does. Outside a call it opens
// this menu; during one it hangs up, because the one thing a hold means in a
// call is ending it. The finger can stay down and slide onto an item, and
// letting go over one picks it; letting go anywhere else leaves the menu up for
// a tap. A tap on the body is still nothing — except that with the menu up it
// puts the menu away, which is what a tap on what opened a menu does.
//
// The desktop opens the same menu with a right-click, and a right-click during
// a call hangs up.
//
// Pure arithmetic over the press's timeline and the menu's rows, so the corner
// only binds events and draws what this returns.

export type LumenMenuItem = "voice" | "type";

export interface LumenMenuState {
  readonly open: boolean;
  /** The rows, top to bottom. Voice only where a call could start. */
  readonly items: readonly LumenMenuItem[];
  /** The row under a sliding finger. */
  readonly hot: LumenMenuItem | null;
  /**
   * The press on the body in progress: whether the menu was up when it went
   * down, and whether it has reached full charge.
   */
  readonly press: { readonly menuWasOpen: boolean; readonly fired: boolean } | null;
}

/** What the corner knows at the moment a press fires or a right-click lands. */
export interface LumenMenuContext {
  /** A call is up. */
  live: boolean;
  /** A call could start from here (voice-context.ts and a host that can speak). */
  canVoice: boolean;
}

export type LumenMenuInput =
  | { kind: "down" }
  | ({ kind: "fired" } & LumenMenuContext)
  | { kind: "slide"; item: LumenMenuItem | null }
  | { kind: "up"; item: LumenMenuItem | null }
  | { kind: "cancel" }
  | ({ kind: "context" } & LumenMenuContext)
  | { kind: "pick"; item: LumenMenuItem }
  | { kind: "dismiss" };

/** What the corner has to do about a step: start, end or open something. */
export type LumenMenuEffect = "hang-up" | LumenMenuItem | null;

export interface LumenMenuStep {
  readonly state: LumenMenuState;
  readonly effect: LumenMenuEffect;
}

export const MENU_REST: LumenMenuState = { open: false, items: [], hot: null, press: null };

export function menuItems(canVoice: boolean): readonly LumenMenuItem[] {
  return canVoice ? ["voice", "type"] : ["type"];
}

export function lumenMenuStep(state: LumenMenuState, input: LumenMenuInput): LumenMenuStep {
  switch (input.kind) {
    case "down":
      if (state.press) return still(state);
      return still({ ...state, press: { menuWasOpen: state.open, fired: false } });
    case "fired": {
      const press = state.press ? { ...state.press, fired: true } : { menuWasOpen: state.open, fired: true };
      if (input.live) return { state: { ...MENU_REST, press }, effect: "hang-up" };
      return still({ open: true, items: menuItems(input.canVoice), hot: null, press });
    }
    case "slide": {
      if (!state.press?.fired || !state.open) return still(state);
      const hot = offered(state, input.item);
      return hot === state.hot ? still(state) : still({ ...state, hot });
    }
    case "up": {
      const press = state.press;
      if (!press) return still(state);
      if (press.fired) {
        const item = state.open ? offered(state, input.item) : null;
        if (item) return { state: MENU_REST, effect: item };
        return still({ ...state, hot: null, press: null });
      }
      if (press.menuWasOpen) return still(MENU_REST);
      return still({ ...state, press: null });
    }
    case "cancel":
      if (!state.press) return still(state);
      return still({ ...state, hot: null, press: null });
    case "context":
      // A press already on the body owns it: a host that raises the context
      // menu from a long touch must not open the menu a second way.
      if (state.press) return still(state);
      if (input.live) return { state: MENU_REST, effect: "hang-up" };
      return still({ open: true, items: menuItems(input.canVoice), hot: null, press: null });
    case "pick": {
      const item = state.open ? offered(state, input.item) : null;
      if (!item) return still(state);
      return { state: MENU_REST, effect: item };
    }
    case "dismiss":
      if (!state.open && !state.hot) return still(state);
      return still({ ...state, open: false, hot: null });
  }
}

/**
 * Which press starts a hold. A mouse's other buttons do not: the right one is
 * the desktop's way to the menu, and holding it down must not also charge.
 */
export function startsHold(pointerType: string, button: number): boolean {
  return pointerType !== "mouse" || button === 0;
}

export interface MenuRow {
  item: LumenMenuItem;
  rect: { left: number; top: number; right: number; bottom: number };
}

/** The row a point is over, by the rows' boxes on screen. */
export function menuItemAt(x: number, y: number, rows: readonly MenuRow[]): LumenMenuItem | null {
  for (const { item, rect } of rows) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return item;
  }
  return null;
}

function offered(state: LumenMenuState, item: LumenMenuItem | null): LumenMenuItem | null {
  return item !== null && state.items.includes(item) ? item : null;
}

function still(state: LumenMenuState): LumenMenuStep {
  return { state, effect: null };
}
