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

export const LUMEN_CORNER_KEY = "shell.lumenCorner";

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

// What the logo does next, not what it is looking at. The wordmark and the
// phone's title both say the same thing. Not the reader, where the switch is a
// row in the "More" menu and the On/Off beside it carries the state instead.
export function lumenToggleTitle(shown: boolean): string {
  return shown ? "Hide Lumen" : "Show Lumen";
}
