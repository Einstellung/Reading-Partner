import { createContext, useContext, useEffect, useState } from "react";
import { keyboardFrame, keyboardInset, readViewport, type VisibleFrame } from "./keyboard-frame";

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
 * Whether the shell around a view already keeps itself inside the part of the
 * screen the keyboard leaves (the phone shell, useKeyboardFrame). null: it does
 * not, and a bottom-docked view pads itself (useKeyboardInset). A boolean: it
 * does, and whether a keyboard is up right now.
 */
export const ShellKeyboardContext = createContext<boolean | null>(null);

export function useShellKeyboard(): boolean | null {
	return useContext(ShellKeyboardContext);
}

/**
 * The visible part of the document while a keyboard is up, or null. A shell
 * that sizes itself to it and sits at its top keeps its top bar under the
 * status bar and its bottom on the keyboard, whichever way WKWebView answered
 * the keyboard (keyboard-frame.ts).
 */
export function useKeyboardFrame(): VisibleFrame | null {
	const [frame, setFrame] = useState<VisibleFrame | null>(null);
	useEffect(
		() =>
			onViewportChange(() => {
				const r = readViewport();
				const next = r ? keyboardFrame(r) : null;
				// Same frame, same object: the scroll events a keyboard pairs with its
				// resize must not re-render the shell for nothing.
				setFrame((prev) => (prev && next && prev.top === next.top && prev.height === next.height ? prev : next));
			}),
		[],
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
