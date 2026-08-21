// The one fact about a wheel event that every gesture reading one needs: what
// its delta is worth. Here rather than beside either caller because the chat
// column and the reader both accumulate wheel deltas and must agree on the unit.

// What one unit of the two non-pixel wheel modes is worth. A line-mode engine
// reports about 3 per notch, so unconverted a gesture tuned in pixels would need
// a dozen turns of the wheel to move once. A page is a viewport, which a file
// holding no DOM cannot measure; about a screen is close enough on any screen.
const LINE_PX = 16;
const PAGE_PX = 800;

// A wheel delta in pixels, whatever unit the event came in (deltaMode 0, 1, 2).
export function wheelDeltaPixels(deltaY: number, deltaMode: number): number {
	if (deltaMode === 1) return deltaY * LINE_PX;
	if (deltaMode === 2) return deltaY * PAGE_PX;
	return deltaY;
}
