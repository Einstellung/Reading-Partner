// The logo's switch for Lumen, named (lumen/corner-pref.ts holds the switch
// itself). Here and not beside the switch: the sidebar that draws the logo is
// below the corner, and the corner draws a chat that draws the sidebar's
// neighbours.

import { t } from "../../../i18n";

// What the logo does next, not what it is looking at. The wordmark and the
// phone's title both say the same thing. Not the reader, where the switch is a
// row in the "More" menu and the On/Off beside it carries the state instead.
export function lumenToggleTitle(shown: boolean): string {
  return t(shown ? "shell.lumen.hide" : "shell.lumen.show");
}
