// The keyboard half of the chat zoom: one listener however many scopes are
// mounted — two would take two steps per press. Which presses count is
// zoom-keys.ts, shared with the reader's own binding.

import { zoomKeyAction, type ZoomAction } from './zoom-keys';

export type { ZoomAction };

let hosts = 0;
let apply: ((action: ZoomAction) => void) | null = null;
let bound: EventTarget | null = null;

function onKeyDown(e: Event): void {
	const action = zoomKeyAction(e as KeyboardEvent);
	if (!action) return;
	e.preventDefault();
	apply?.(action);
}

// Listen while at least one scope is mounted. The count also absorbs the
// mount/cleanup/mount an effect gets in development.
export function bindZoomKeys(target: EventTarget, applier: (action: ZoomAction) => void): () => void {
	apply = applier;
	if (hosts === 0) {
		bound = target;
		target.addEventListener('keydown', onKeyDown);
	}
	hosts += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		hosts -= 1;
		if (hosts > 0) return;
		bound?.removeEventListener('keydown', onKeyDown);
		bound = null;
		apply = null;
	};
}

// Tests only: the count is module state and outlives a single case.
export function resetZoomKeys(): void {
	bound?.removeEventListener('keydown', onKeyDown);
	hosts = 0;
	bound = null;
	apply = null;
}
