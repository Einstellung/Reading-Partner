// What changed in a transcript between two renders, as the scroll position
// cares (common/stick-to-bottom.ts): nothing, the conversation moved on (a row
// was added, or the last one changed — a reply streaming), or the reader sent a
// message, which the list scrolls to once.
//
// A list that had no rows before is still opening: its history arriving is the
// opening, not news. So is the first render after the conversation on display
// changed (the key).

import type { ThreadMessage } from './types';

export interface ListSnapshot {
	key: unknown;
	length: number;
	// Rows are new objects when they change and the same object when they do not
	// (MessageList memoizes on that), so identity says whether the last one moved.
	last: ThreadMessage | undefined;
}

export type ListChange = { kind: 'none' } | { kind: 'changed' } | { kind: 'sent'; index: number };

export function snapshotOf(key: unknown, messages: readonly ThreadMessage[]): ListSnapshot {
	return { key, length: messages.length, last: messages[messages.length - 1] };
}

export function listChange(prev: ListSnapshot | null, key: unknown, messages: readonly ThreadMessage[]): ListChange {
	if (!prev || prev.key !== key || prev.length === 0) return { kind: 'none' };
	const last = messages[messages.length - 1];
	if (prev.length === messages.length && prev.last === last) return { kind: 'none' };
	// The reader's own message among the rows added since: the newest of them,
	// when a send also put in the reply's empty row after it.
	for (let i = messages.length - 1; i >= prev.length; i--) {
		if (messages[i].role === 'user') return { kind: 'sent', index: i };
	}
	return { kind: 'changed' };
}
