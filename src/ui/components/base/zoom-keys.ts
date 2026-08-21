// What a key press means to a zoom, for every surface that has one. The chat
// column and the reader both claim these presses; neither owns the decision, so
// it lives here and each binds its own listener.

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
