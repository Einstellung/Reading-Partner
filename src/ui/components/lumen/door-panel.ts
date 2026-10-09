// Where the door panel stands on the iPad and the desktop (DoorChat.tsx). No DOM
// here: the panel's layer covers the shell, and its padding is what it keeps
// clear below and above the panel.
//
// With no keyboard up the panel stands on Lumen: the corner's margin from the
// bottom edge (LumenCorner, pb-safe-6), however far the corner was lifted, the
// body and the column's gap. With a keyboard up the shell has moved to what is
// visible and the keyboard covers the bottom of it (KeyboardShell); the panel
// stands on the keyboard instead, and Lumen stands down under it.

import type { ShellKeyboard } from "../common/useKeyboardInset";

/** The body (72px) and the column's gap above it. */
export const PANEL_ABOVE_BODY_PX = 72 + 8;
/** What the panel leaves between itself and the keyboard. */
export const PANEL_KEYBOARD_GAP_PX = 8;
/** What it leaves between itself and the top of the screen. */
export const PANEL_TOP_PX = 16;

/** Whether the panel stands on the keyboard rather than on Lumen. */
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
