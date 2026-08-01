import { useEffect, useState } from "react";
import type { ViewportSize } from "./panel-position";

// The viewport a floating panel has to fit inside, kept current as it changes.
//
// The visual viewport, not the layout one: on iOS the soft keyboard and the
// address bar only shrink the visual viewport, so `window.innerHeight` still
// reports the space the keyboard is covering. Where the API is missing
// (desktop webviews) the layout viewport is the same thing.
//
// A pinch-zoomed visual viewport is offset as well as smaller; the offset is not
// compensated, so a panel placed while pinched sits higher and further left than
// it needs to rather than off screen.
function read(): ViewportSize {
	const vv = window.visualViewport;
	return {
		width: vv?.width ?? window.innerWidth,
		height: vv?.height ?? window.innerHeight,
	};
}

export function useViewportSize(): ViewportSize {
	const [size, setSize] = useState<ViewportSize>(read);
	useEffect(() => {
		// Same value, same object: a keyboard-induced scroll that leaves the size
		// alone must not re-run every panel's layout effect.
		const update = () =>
			setSize((prev) => {
				const next = read();
				return prev.width === next.width && prev.height === next.height ? prev : next;
			});
		// Rotation and window resizing fire on window; the keyboard and the address
		// bar only fire on the visual viewport, and iOS pairs resize with scroll.
		window.addEventListener("resize", update);
		const vv = window.visualViewport;
		vv?.addEventListener("resize", update);
		vv?.addEventListener("scroll", update);
		// The first paint read the viewport before this effect; re-read in case it
		// changed in between.
		update();
		return () => {
			window.removeEventListener("resize", update);
			vv?.removeEventListener("resize", update);
			vv?.removeEventListener("scroll", update);
		};
	}, []);
	return size;
}
