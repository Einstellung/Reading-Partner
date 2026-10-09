// What changed in a transcript between two renders, as the scroll position
// cares (common/stick-to-bottom.ts): nothing, the conversation moved on (a row
// was added or replaced, or a reply streamed), or the reader sent a message,
// which the list scrolls to once.
//
// A list that had no rows before is still opening: its history arriving is the
// opening, not news. So is the first render after the conversation on display
// changed (the key).

import type { ThreadMessage } from './types';

export interface ListSnapshot {
	key: unknown;
	// Rows are new objects when they change and the same object when they do not
	// (MessageList memoizes on that), so identity says which rows are new.
	rows: readonly ThreadMessage[];
}

export type ListChange = { kind: 'none' } | { kind: 'changed' } | { kind: 'sent'; index: number };

export function snapshotOf(key: unknown, messages: readonly ThreadMessage[]): ListSnapshot {
	return { key, rows: messages };
}

export function listChange(prev: ListSnapshot | null, key: unknown, messages: readonly ThreadMessage[]): ListChange {
	if (!prev || prev.key !== key || prev.rows.length === 0) return { kind: 'none' };
	const before = prev.rows;
	if (before.length === messages.length && before.every((m, i) => m === messages[i])) return { kind: 'none' };
	// The reader's own message that was not there before. Not by position: a send
	// can also drop the last turn's failure, so the new message may sit where an
	// old row was. Not by identity either: a queued message is patched when its
	// turn starts, and that is the same message, not another send.
	const sent = new Set(before.filter((m) => m.role === 'user').map((m) => m.ts));
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === 'user' && !sent.has(m.ts)) return { kind: 'sent', index: i };
	}
	return { kind: 'changed' };
}
