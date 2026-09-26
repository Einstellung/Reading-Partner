import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { keyboardFrame, keyboardInset, readViewport, type KeyboardFrame } from "./keyboard-frame";

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

/**
 * What the shell around a view says about the keyboard, when it is a shell that
 * moves itself to the visible part of the screen (the phone's, useKeyboardFrame):
 * how much of its bottom the keyboard covers, 0 with no keyboard. null: the
 * shell does not, and a bottom-docked view measures for itself
 * (useKeyboardInset).
 */
export const ShellKeyboardContext = createContext<number | null>(null);

export function useShellKeyboard(): number | null {
	return useContext(ShellKeyboardContext);
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
				setFrame((prev) => (prev && next && prev.top === next.top && prev.covered === next.covered ? prev : next));
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
