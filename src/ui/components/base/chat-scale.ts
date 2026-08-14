// The maximized chat window's content zoom, with no React and no DOM: the range
// a scale may take, the grid it snaps to, and the accumulation a trackpad pinch
// needs before it counts as a step.
//
// The value reaches the components as one CSS variable (`--chat-scale`), so
// nothing in a message row imports any of this: an unwrapped surface reads the
// variable's default and is 1x with no branch anywhere.

export const CHAT_SCALE_MIN = 0.9;
export const CHAT_SCALE_MAX = 1.8;
export const CHAT_SCALE_STEP = 0.1;
export const CHAT_SCALE_DEFAULT = 1;

// One notch of a mouse wheel, in pixels. A pinch on a trackpad arrives as
// ctrl+wheel too, but in fractional deltas dozens of events long — one step per
// event would cross the whole range in a flick.
const WHEEL_NOTCH = 40;

// What one unit of the two non-pixel wheel modes is worth. A wheel event reports
// its delta in pixels, lines or pages (deltaMode 0, 1, 2) and which one is the
// engine's business — this app runs on three of them. A line-mode engine reports
// about 3 per notch, so unconverted it would take a dozen turns of the wheel to
// reach the first step and the zoom would read as broken.
const LINE_PX = 16;
// A page is a viewport, which this file cannot measure and should not try to: it
// holds no DOM. A scroll of about a screen is a large gesture on any screen.
const PAGE_PX = 800;

// A wheel delta in pixels, whatever unit the event came in. An unknown mode is
// read as pixels, which is what every engine that has one reports.
export function wheelDeltaPixels(deltaY: number, deltaMode: number): number {
	if (deltaMode === 1) return deltaY * LINE_PX;
	if (deltaMode === 2) return deltaY * PAGE_PX;
	return deltaY;
}

// Snap to the step grid and drop the float noise: 0.9 + 0.1 is
// 0.9999999999999999, which would leave the stored value a hair off every grid
// point it ever passes through and never compare equal to the default.
function quantize(value: number): number {
	return Math.round(Math.round(value / CHAT_SCALE_STEP) * CHAT_SCALE_STEP * 100) / 100;
}

// Anything that is not a number in range becomes one. The input can be a
// hand-edited device.json, so a string, a null, an infinity and a 99 all have to
// land somewhere safe rather than reach a stylesheet.
export function clampChatScale(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return CHAT_SCALE_DEFAULT;
	return quantize(Math.min(CHAT_SCALE_MAX, Math.max(CHAT_SCALE_MIN, value)));
}

// Move `steps` notches from `current` (negative steps zoom out). The current
// value is clamped first, so a garbage stored value cannot be stepped further
// out of range.
export function shiftChatScale(current: number, steps: number): number {
	return clampChatScale(clampChatScale(current) + steps * CHAT_SCALE_STEP);
}

export function stepChatScale(current: number, direction: 1 | -1): number {
	return shiftChatScale(current, direction);
}

// Fold one wheel event into the accumulator and report how many steps it
// completed. Scrolling up (deltaY < 0) zooms in, the direction every browser's
// own ctrl+wheel zoom uses. A reversal drops what was accumulated: the leftover
// from a zoom-in must not delay the first step of the zoom-out that follows it.
export function accumulateWheel(
	acc: number,
	deltaY: number,
	deltaMode: number,
): { acc: number; steps: number } {
	// A ctrl-held sideways scroll reports deltaY 0, whose sign matches no
	// direction: taken as a reversal it would throw away what a pinch had
	// gathered, one event before the step it was about to complete.
	if (!Number.isFinite(deltaY) || deltaY === 0) return { acc, steps: 0 };
	const delta = wheelDeltaPixels(deltaY, deltaMode);
	const aligned = acc !== 0 && Math.sign(acc) !== Math.sign(delta) ? 0 : acc;
	const total = aligned + delta;
	const notches = Math.trunc(total / WHEEL_NOTCH);
	// Not -notches when there are none: negating zero gives -0, which is not 0 to
	// the equality every caller and test reaches for.
	return { acc: total - notches * WHEEL_NOTCH, steps: notches === 0 ? 0 : -notches };
}
