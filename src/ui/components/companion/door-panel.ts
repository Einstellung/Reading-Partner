// Where the door panel stands on the iPad and the desktop (DoorChat.tsx). No DOM
// here: the panel's layer covers the shell, and its padding is what it keeps
// clear below and above the panel.
//
// With no keyboard up the panel stands on the companion: the corner's margin from the
// bottom edge (CompanionCorner, pb-safe-6), however far the corner was lifted, the
// body and the column's gap. With a keyboard up the shell has moved to what is
// visible and the keyboard covers the bottom of it (KeyboardShell); the panel
// stands on the keyboard instead, and the companion stands down under it.
//
// The panel's expand button fills the shell with it (docs/68, 2026-10-15): edge
// to edge inside the safe area, over the page and over the companion, down to the
// keyboard when one is up. The page under it does not move either way.

import type { ShellKeyboard } from "../common/useKeyboardInset";

/** The body (72px) and the column's gap above it. */
export const PANEL_ABOVE_BODY_PX = 72 + 8;
/** What the panel leaves between itself and the keyboard. */
export const PANEL_KEYBOARD_GAP_PX = 8;
/** What it leaves between itself and the top of the screen. */
export const PANEL_TOP_PX = 16;

/** Whether the panel stands on the keyboard rather than on the companion. */
export function panelOnKeyboard(keyboard: ShellKeyboard | null): boolean {
	return keyboard !== null && keyboard.covered > 0;
}

/** The panel layer's padding, for the shell's word on the keyboard and the corner's lift. */
export function panelPadding(
	keyboard: ShellKeyboard | null,
	liftPx: number,
): { paddingTop: string; paddingBottom: string } {
	const paddingTop = `calc(env(safe-area-inset-top) + ${PANEL_TOP_PX}px)`;
	if (keyboard && panelOnKeyboard(keyboard)) {
		return { paddingTop, paddingBottom: `${keyboard.covered + PANEL_KEYBOARD_GAP_PX}px` };
	}
	return {
		paddingTop,
		paddingBottom: `calc(max(24px, env(safe-area-inset-bottom)) + ${PANEL_ABOVE_BODY_PX + liftPx}px)`,
	};
}

/** The layer's padding with the panel filling the shell. */
export function fullPadding(keyboard: ShellKeyboard | null): { paddingTop: string; paddingBottom: string } {
  return {
    paddingTop: "env(safe-area-inset-top)",
    paddingBottom: keyboard && panelOnKeyboard(keyboard) ? `${keyboard.covered}px` : "env(safe-area-inset-bottom)",
  };
}
