// Whether the corner companion is on this device's screen (docs/68).
//
// localStorage, like the shell sidebar's width and the reader's panel: a
// per-device view choice, read synchronously so the first frame is already the
// one the reader left. Not the settings file — the settings file syncs, and a
// reader who put Lumen away on the phone has not put it away on the desk.
//
// Hidden means the corner draws nothing. The box goes on filling behind it; the
// count is waiting when the logo is pressed again.

import type { PrefStore } from "../base/pref-store";
import {
  CORNER_SPOT_DEFAULT,
  parseCornerSpot,
  serializeCornerSpot,
  type CornerSpot,
} from "./corner-drag";

export const LUMEN_CORNER_KEY = "shell.lumenCorner";

// Where it stands, beside whether it stands at all. The same kind of choice and
// the same reason for the same storage: a corner dragged out of the way of the
// phone's Display sheet has not been dragged out of the way of anything on the
// desk (docs/68).
export const LUMEN_CORNER_SPOT_KEY = "shell.lumenCornerSpot";

// Shown unless the slot holds exactly the marker for hidden. The companion is
// the app's own entry to the box, so an unreadable or hand-edited value must
// not quietly take it away.
export function readLumenCornerShown(store: PrefStore | null): boolean {
  try {
    return store?.getItem(LUMEN_CORNER_KEY) !== "0";
  } catch {
    // A storage that throws on read is a storage that is not there.
    return true;
  }
}

export function writeLumenCornerShown(store: PrefStore | null, shown: boolean): void {
  try {
    store?.setItem(LUMEN_CORNER_KEY, shown ? "1" : "0");
  } catch {
    // Full or disabled storage: the choice still holds for this session.
  }
}

export function readLumenCornerSpot(store: PrefStore | null): CornerSpot {
  try {
    return parseCornerSpot(store?.getItem(LUMEN_CORNER_SPOT_KEY) ?? null);
  } catch {
    return CORNER_SPOT_DEFAULT;
  }
}

export function writeLumenCornerSpot(store: PrefStore | null, spot: CornerSpot): void {
  try {
    store?.setItem(LUMEN_CORNER_SPOT_KEY, serializeCornerSpot(spot));
  } catch {
    // Full or disabled storage: the corner stays where it was put for this
    // session and comes back in the bottom right on the next one.
  }
}

// What the logo does next, not what it is looking at. The wordmark and the
// phone's title both say the same thing. Not the reader, where the switch is a
// row in the "More" menu and the On/Off beside it carries the state instead.
export function lumenToggleTitle(shown: boolean): string {
  return shown ? "Hide Lumen" : "Show Lumen";
}
