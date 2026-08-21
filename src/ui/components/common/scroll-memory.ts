// Where a transcript was left, so a list that unmounts and comes back lands
// where the reader was instead of at the newest message. The lesson does exactly
// that: clicking a citation swaps the chat to the corner card and unmounts the
// whole call view, and tapping the card back remounts it.
//
// Module state rather than a hook, because the memory has to outlive the
// component that unmounts — that is the whole point of it. The key is the thread
// id alone: any key derived from the content would change on every streaming
// delta and re-pin the list on every token.

import type { StickOptions, StickPosition } from "./stick-to-bottom";

// Nothing bounds the threads a book accumulates — one per mark, one per drawn
// aside, one per chat span — and each entry is two numbers, so the cap is what
// keeps the store from being a leak rather than what keeps it small.
const MAX_ENTRIES = 16;

// Insertion order is recency: a write deletes the key before setting it, and an
// eviction takes whichever key the iterator yields first.
const positions = new Map<string, StickPosition>();

export function rememberScroll(key: string, at: StickPosition): void {
	positions.delete(key);
	positions.set(key, at);
	if (positions.size > MAX_ENTRIES) {
		const oldest = positions.keys().next();
		if (!oldest.done) positions.delete(oldest.value);
	}
}

// Read, not taken: the reader may swap out to the page and back any number of
// times within one call.
export function recallScroll(key: string): StickPosition | null {
	return positions.get(key) ?? null;
}

export function forgetScroll(key: string): void {
	positions.delete(key);
}

export function clearScrollMemory(): void {
	positions.clear();
}

/** The seams for one list, or none at all when it is not a remembered one. */
export function scrollMemory(key: string | number | undefined): StickOptions {
	if (key === undefined) return {};
	const id = String(key);
	return {
		restore: () => recallScroll(id),
		remember: (at) => rememberScroll(id, at),
	};
}
