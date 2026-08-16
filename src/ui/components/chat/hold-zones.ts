// The geometry behind the hold-to-talk overlay (HoldToTalk.tsx): which landing
// zone a finger is over, and how tall each bar of the level meter is. Both are
// arithmetic over numbers the component measures, so they live here and are
// tested rather than eyeballed on a device.

import type { Zone } from '../../../ai/voice';

// The part of a DOMRect these need. A plain object so a test can state one.
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

// What letting go here does, shown under the meter. The line names the outcome
// and never the words — the transcript stays hidden while the finger is down.
export const RELEASE_LABEL: Record<Zone, string> = {
	send: 'Release to send',
	cancel: 'Release to cancel',
	edit: 'Release to edit',
};

// The zone under a point. `send` is the default and the fall-through: a finger
// that is on neither target is still on the bar it pressed, and releasing there
// sends. The two targets are grown by SLOP on every side — a thumb dragged to
// the edge of a small target reads as outside it while it looks inside.
export const SLOP = 12;

export function zoneAt(x: number, y: number, boxes: { cancel?: Box | null; edit?: Box | null }): Zone {
	if (inside(x, y, boxes.cancel)) return "cancel";
	if (inside(x, y, boxes.edit)) return "edit";
	return "send";
}

function inside(x: number, y: number, box: Box | null | undefined): boolean {
	if (!box) return false;
	return (
		x >= box.left - SLOP && x <= box.right + SLOP && y >= box.top - SLOP && y <= box.bottom + SLOP
	);
}

// The meter's bars as fractions of full height, quiet to loud. A fixed profile
// shapes the row — tallest in the middle, shortest at the ends — so the meter
// reads as a voice rather than a progress bar, and one level drives all of it.
// FLOOR keeps the row visible in silence; without it the overlay looks broken
// while the user gathers their thoughts.
export const METER_BARS = 13;
const FLOOR = 0.12;

export function barHeights(level: number, count: number = METER_BARS): number[] {
	const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
	const mid = (count - 1) / 2;
	return Array.from({ length: count }, (_, i) => {
		// 1 at the centre, tapering to 0.35 at the ends.
		const shape = mid === 0 ? 1 : 1 - 0.65 * (Math.abs(i - mid) / mid);
		return Math.min(1, FLOOR + (1 - FLOOR) * clamped * shape);
	});
}
