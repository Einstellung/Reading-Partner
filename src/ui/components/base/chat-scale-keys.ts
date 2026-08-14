// The keyboard half of the chat zoom: what a key press means, and one listener
// however many scopes are mounted — two would take two steps per press.

export type ZoomAction = 'in' | 'out' | 'reset';

// The zoom keys, or null for every other press. AltGr is a modifier some
// non-US layouts type ordinary characters with, and it arrives with ctrlKey
// set: without this the layout that puts a bracket on AltGr+0 could not type it.
export function zoomKeyAction(e: {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}): ZoomAction | null {
	if (e.altKey || (!e.ctrlKey && !e.metaKey)) return null;
	if (e.key === '=' || e.key === '+') return 'in';
	if (e.key === '-' || e.key === '_') return 'out';
	if (e.key === '0') return 'reset';
	return null;
}

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
