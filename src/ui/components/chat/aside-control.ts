// Where the control a selection raises is put.
//
// Not next to the selection, because something else already is. WebKit raises
// its own Copy | Look Up | Translate | Search Web | Share… bar on the same
// selection — chat text sits outside [data-reader-surface], so the callout is
// not suppressed there (docs/pitfall/49) — and that bar is a native view over
// the webview: it is not in the DOM, nothing in the page can measure it, and
// every touch that lands on it is taken before the webview hears of it.
//
// Which side of the selection it takes is not fixed. Measured on iPad Pro
// 11-inch, iOS 26.5 (docs/pitfall/119): the bar is 44 tall and sits 15 clear of
// the selection's box, below it while the selection's centre is above the
// middle of the safe area and above it once the centre passes below. The page
// cannot read which of the two happened, so the band next to the selection is
// given up on the side this control is on whichever way the bar went. The cost
// is a gap under the selection when the bar went the other way; the cost of not
// doing it is a control that cannot be pressed at all.

// The control's own box. The height is the coarse-pointer one: the control's
// height comes from the size table in ui/button.tsx, which is where this project
// keeps the 44px touch minimum, so it is 34px under a mouse and 44 under a
// finger — and the clamp, which only has to keep it on screen, is given the
// taller of the two on both.
export const ASIDE_CONTROL_WIDTH = 150;
export const ASIDE_CONTROL_HEIGHT = 44;

// WebKit's callout bar, as measured: its own height and how far clear of the
// selection's box it sits.
export const CALLOUT_BAR_HEIGHT = 44;
export const CALLOUT_BAR_GAP = 15;

// The strip beside the selection that belongs to the callout on whichever side
// it chose.
export const CALLOUT_BAND = CALLOUT_BAR_GAP + CALLOUT_BAR_HEIGHT;

// What is left between the callout's band and this control.
export const ASIDE_CONTROL_GAP = 8;

// Enough of a selection's bounding box to place a control off it.
export interface AsideSelectionBox {
	left: number;
	right: number;
	bottom: number;
}

// The control's top-left corner, in viewport pixels. These are the numbers
// anchor-safe clamps into the safe area (styles.css), so they are what it is
// drawn at rather than a measurement of it.
export function asideControlAnchor(box: AsideSelectionBox): { x: number; y: number } {
	return {
		x: (box.left + box.right) / 2 - ASIDE_CONTROL_WIDTH / 2,
		y: box.bottom + CALLOUT_BAND + ASIDE_CONTROL_GAP,
	};
}
