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

// One notch of a mouse wheel, in the deltaY a browser reports for it. A pinch on
// a trackpad arrives as ctrl+wheel too, but in fractional deltas dozens of
// events long — one step per event would cross the whole range in a flick.
const WHEEL_NOTCH = 40;

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
export function accumulateWheel(acc: number, deltaY: number): { acc: number; steps: number } {
	if (!Number.isFinite(deltaY)) return { acc, steps: 0 };
	const aligned = acc !== 0 && Math.sign(acc) !== Math.sign(deltaY) ? 0 : acc;
	const total = aligned + deltaY;
	const notches = Math.trunc(total / WHEEL_NOTCH);
	// Not -notches when there are none: negating zero gives -0, which is not 0 to
	// the equality every caller and test reaches for.
	return { acc: total - notches * WHEEL_NOTCH, steps: notches === 0 ? 0 : -notches };
}
