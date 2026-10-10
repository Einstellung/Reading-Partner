// What changed in a transcript between two renders, as the scroll position
// cares (common/stick-to-bottom.ts): nothing, the conversation moved on (a row
// was added or replaced, or a reply streamed), or the reader sent a message,
// which the list scrolls to once.
//
// A list that had no rows before is still opening: its history arriving is the
// opening, not news. So is the first render after the conversation on display
// changed (the key). So is the answer to the line the list opened on arriving
// after it: a conversation reopened on a turn still running, whose rows the
// runtime draws only once it has found the turn (after a restart), opens on that
// answer the way one whose rows were there at mount does. Once the reader has
// sent something the opening is over anyway, so this never holds a list that
// is already theirs.

import type { ThreadMessage } from './types';

export interface ListSnapshot {
	key: unknown;
	// Rows are new objects when they change and the same object when they do not
	// (MessageList memoizes on that), so identity says which rows are new.
	rows: readonly ThreadMessage[];
}

export type ListChange =
	| { kind: 'none' }
	| { kind: 'changed' }
	| { kind: 'sent'; index: number }
	// Rows added after a last line of the reader's that had no answer yet, with
	// nothing above them touched and no line of the reader's among them.
	| { kind: 'answered' };

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
	const last = before[before.length - 1];
	const appended =
		last.role === 'user' &&
		!last.queued &&
		messages.length > before.length &&
		before.every((m, i) => messages[i].role === m.role && messages[i].ts === m.ts) &&
		messages.slice(before.length).every((m) => m.role !== 'user');
	return appended ? { kind: 'answered' } : { kind: 'changed' };
}
