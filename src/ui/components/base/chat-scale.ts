// The maximized chat window's content zoom, with no React and no DOM: the range,
// the grid a scale snaps to, and the accumulation a trackpad pinch needs.
//
// The value reaches the components as `--chat-scale`, so nothing in a message
// row imports any of this and an unwrapped surface is 1x with no branch.

import { wheelDeltaPixels } from '../../../platform/app/wheel';

export const CHAT_SCALE_MIN = 0.9;
export const CHAT_SCALE_MAX = 1.8;
export const CHAT_SCALE_STEP = 0.1;
export const CHAT_SCALE_DEFAULT = 1;

// One notch of a mouse wheel, in pixels. A trackpad pinch is ctrl+wheel too, but
// in fractional deltas dozens of events long — a step per event would cross the
// whole range in a flick.
const WHEEL_NOTCH = 40;

// Snap to the grid and drop the float noise: 0.9 + 0.1 is 0.9999999999999999,
// which would never compare equal to the default it just landed on.
function quantize(value: number): number {
	return Math.round(Math.round(value / CHAT_SCALE_STEP) * CHAT_SCALE_STEP * 100) / 100;
}

// The input can be a hand-edited device.json, so a string, a null and a 99 all
// have to land somewhere safe rather than reach a stylesheet.
export function clampChatScale(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return CHAT_SCALE_DEFAULT;
	return quantize(Math.min(CHAT_SCALE_MAX, Math.max(CHAT_SCALE_MIN, value)));
}

// Move `steps` notches from `current`; negative steps zoom out.
export function shiftChatScale(current: number, steps: number): number {
	return clampChatScale(clampChatScale(current) + steps * CHAT_SCALE_STEP);
}

export function stepChatScale(current: number, direction: 1 | -1): number {
	return shiftChatScale(current, direction);
}

// Fold one wheel event into the accumulator and report the steps it completed.
// Scrolling up zooms in. A reversal drops what was gathered the other way, and a
// sideways scroll — deltaY 0, whose sign matches no direction — is not one.
export function accumulateWheel(
	acc: number,
	deltaY: number,
	deltaMode: number,
): { acc: number; steps: number } {
	if (!Number.isFinite(deltaY) || deltaY === 0) return { acc, steps: 0 };
	const delta = wheelDeltaPixels(deltaY, deltaMode);
	const aligned = acc !== 0 && Math.sign(acc) !== Math.sign(delta) ? 0 : acc;
	const total = aligned + delta;
	const notches = Math.trunc(total / WHEEL_NOTCH);
	// Not -notches when there are none: -0 is not 0 to the equality callers use.
	return { acc: total - notches * WHEEL_NOTCH, steps: notches === 0 ? 0 : -notches };
}
