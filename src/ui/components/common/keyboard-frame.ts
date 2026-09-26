// Where the part of the page the soft keyboard leaves visible is, from one
// reading of the window and its visual viewport. No DOM here: the hooks read
// the numbers, these functions decide what they mean.
//
// WKWebView answers the keyboard in one of two ways (docs/pitfall/392, 443):
//
// - It shrinks `innerHeight` with the visual viewport and scrolls the whole
//   document up by the keyboard's height, leaving the page laid out at its full
//   height. `visualViewport.offsetTop` then reports that scroll. An iPhone does
//   this from the start: 956 tall, a software keyboard reads innerHeight 543,
//   visual viewport 543 at offsetTop 413, `scrollY` 413.
// - It leaves `innerHeight` alone and shrinks only the visual viewport, at
//   offsetTop 0. An iPad does this after the app has been switched away from.
//
// Either way the visible part of the document runs from offsetTop down by the
// visual viewport's height.

export interface ViewportReading {
	innerHeight: number;
	vvHeight: number;
	vvOffsetTop: number;
	/** The visual viewport's pinch zoom. */
	vvScale: number;
}

/** Where the keyboard leaves room, for a shell laid out at its full height. */
export interface KeyboardFrame {
	/** How far down the document the visible part starts: the shell moves there. */
	top: number;
	/** How much of the shell's bottom the keyboard covers. */
	covered: number;
}

// Sub-pixel noise is not a keyboard.
const SLACK = 1;

/**
 * Where a shell `layoutHeight` tall has to move, and how much of it the
 * keyboard (or the accessory bar of a hardware one) covers, or null when
 * nothing does. The shell keeps its size: moved to the visible part's top, its
 * top bar is under the status bar, and the view docked at its bottom pads
 * itself by `covered`.
 *
 * A pinch-zoomed page also has a smaller, offset visual viewport; that is the
 * reader looking closer, not less room, so it is null too.
 */
export function keyboardFrame(r: ViewportReading, layoutHeight: number): KeyboardFrame | null {
	if (Math.abs(r.vvScale - 1) > 0.01) return null;
	const shrunk = r.vvHeight < r.innerHeight - SLACK;
	const scrolled = r.vvOffsetTop > SLACK;
	if (!shrunk && !scrolled) return null;
	return { top: Math.round(r.vvOffsetTop), covered: Math.max(0, Math.round(layoutHeight - r.vvHeight)) };
}

/**
 * How much of the layout viewport's bottom the keyboard covers, for a view that
 * pads itself instead of moving: the second way above. In the first way the
 * document scroll has already brought the bottom into view and this is 0.
 */
export function keyboardInset(r: ViewportReading): number {
	const overlap = r.innerHeight - r.vvHeight - r.vvOffsetTop;
	return overlap > SLACK ? Math.round(overlap) : 0;
}

export function readViewport(): ViewportReading | null {
	const vv = window.visualViewport;
	if (!vv) return null;
	return { innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop, vvScale: vv.scale };
}

/**
 * The padding a view docked at the bottom of a moved shell takes: what the
 * keyboard covers, less the home indicator's inset the view already ends above.
 */
export function coveredPadding(covered: number): string {
	return `max(0px, calc(${covered}px - env(safe-area-inset-bottom)))`;
}
