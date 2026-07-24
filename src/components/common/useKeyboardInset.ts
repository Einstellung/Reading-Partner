import { useEffect, useState } from "react";

// How many pixels the on-screen (soft) keyboard covers at the bottom of the
// layout viewport, tracked via the VisualViewport API. A bottom-docked chat
// composer pads itself by this so the keyboard never covers the input (iPad).
//
// On desktop there is no soft keyboard: the visual viewport equals the layout
// viewport, so this stays 0 and the padding is inert. When the VisualViewport
// API is unavailable it also stays 0.
export function useKeyboardInset(): number {
	const [inset, setInset] = useState(0);
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => {
			// The layout viewport's height minus the part still visible above the
			// keyboard (offsetTop guards against a pinch-zoomed/scrolled visual
			// viewport). Rounded and floored at 0 so sub-pixel noise never nudges it.
			const overlap = window.innerHeight - vv.height - vv.offsetTop;
			setInset(overlap > 1 ? Math.round(overlap) : 0);
		};
		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
		};
	}, []);
	return inset;
}
