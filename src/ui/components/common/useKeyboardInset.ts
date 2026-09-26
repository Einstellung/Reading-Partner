import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { coveredPadding, keyboardFrame, keyboardInset, readViewport, type KeyboardFrame } from "./keyboard-frame";

// Runs `update` now and whenever the window or its visual viewport changes;
// returns the unsubscribe. The keyboard fires only on the visual viewport, and
// iOS pairs resize with scroll (docs/pitfall/392); rotation fires on the window.
function onViewportChange(update: () => void): () => void {
	const vv = window.visualViewport;
	update();
	window.addEventListener("resize", update);
	vv?.addEventListener("resize", update);
	vv?.addEventListener("scroll", update);
	return () => {
		window.removeEventListener("resize", update);
		vv?.removeEventListener("resize", update);
		vv?.removeEventListener("scroll", update);
	};
}

/** What a shell that moves itself for the keyboard tells the views in it. */
export type ShellKeyboard = Pick<KeyboardFrame, "covered" | "cramped">;

/** The shell's word with no keyboard up. */
export const NO_KEYBOARD: ShellKeyboard = { covered: 0, cramped: false };

/**
 * What the shell around a view says about the keyboard, when it is a shell that
 * moves itself to the visible part of the screen (KeyboardShell): how much of
 * its bottom the keyboard covers, and whether what is left is too short for a
 * conversation's top bar. null: the shell does not, and a bottom-docked view
 * measures for itself (useKeyboardInset).
 */
export const ShellKeyboardContext = createContext<ShellKeyboard | null>(null);

export function useShellKeyboard(): ShellKeyboard | null {
	return useContext(ShellKeyboardContext);
}

/** What a view docked at the bottom of the shell does about the keyboard. */
export interface KeyboardRoom {
	/** Its bottom padding, which keeps its bottom edge above the keyboard. */
	padding: string | number | undefined;
	/** A shell that moved for the keyboard says one is up. */
	up: boolean;
	/** Too little is left for the view's top bar (keyboard-frame.ts chatBarFits). */
	cramped: boolean;
}

/**
 * The shell's word on the keyboard as a docked view uses it: inside a shell that
 * moves itself, pad by what it says is covered, less the home indicator's inset
 * the view already ends above; outside one, measure (useKeyboardInset).
 */
export function useKeyboardRoom(): KeyboardRoom {
	const shell = useShellKeyboard();
	const measured = useKeyboardInset(shell === null);
	if (shell === null) return { padding: measured || undefined, up: false, cramped: false };
	const up = shell.covered > 0;
	return { padding: up ? coveredPadding(shell.covered) : undefined, up, cramped: shell.cramped };
}

/**
 * Where the shell has to move while a keyboard is up, and how much of it the
 * keyboard covers, or null. The shell keeps its size, so nothing laid out in it
 * (a reader covered by a lesson included) is resized by the keyboard; only the
 * view that owns the focused field pads itself (keyboard-frame.ts).
 */
export function useKeyboardFrame(shell: RefObject<HTMLElement | null>): KeyboardFrame | null {
	const [frame, setFrame] = useState<KeyboardFrame | null>(null);
	useEffect(
		() =>
			onViewportChange(() => {
				const r = readViewport();
				const height = shell.current?.offsetHeight ?? 0;
				const next = r && height > 0 ? keyboardFrame(r, height) : null;
				// Same frame, same object: the scroll events a keyboard pairs with its
				// resize must not re-render the shell for nothing.
				setFrame((prev) =>
					prev && next && prev.top === next.top && prev.covered === next.covered && prev.cramped === next.cramped
						? prev
						: next,
				);
			}),
		[shell],
	);
	return frame;
}

// How many pixels the on-screen (soft) keyboard covers at the bottom of the
// layout viewport. A bottom-docked chat composer pads itself by this so the
// keyboard never covers the input (iPad). Pass false inside a shell that
// follows the keyboard itself, where the padding would count it twice.
//
// On desktop there is no soft keyboard: the visual viewport equals the layout
// viewport, so this stays 0 and the padding is inert. When the VisualViewport
// API is unavailable it also stays 0.
export function useKeyboardInset(enabled = true): number {
	const [inset, setInset] = useState(0);
	useEffect(() => {
		if (!enabled) return;
		return onViewportChange(() => {
			const r = readViewport();
			setInset(r ? keyboardInset(r) : 0);
		});
	}, [enabled]);
	return enabled ? inset : 0;
}
