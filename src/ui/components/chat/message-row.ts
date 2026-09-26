// What an AI row in the transcript is drawn as, decided from its parts and the
// message-level flags (MessageList.tsx: MessageBubble). The user's own rows are
// not decided here: they are always the pill.

import { visibleTrace, type ToolStatus } from '../../../ai/turn-view/tool-status';
import type { ChatPart } from './chatParts';

export type CardPart = Extract<ChatPart, { type: 'card' }>;
export type TextPart = Extract<ChatPart, { type: 'text' }>;
export type TicketPart = Extract<ChatPart, { type: 'receipt' } | { type: 'dispatch' }>;

// `tools` is the whole trace when any of it is visible, null when there is none
// to draw: a trace of nothing but quiet calls draws nothing at all, and must not
// draw an empty box in place of the status line the row would otherwise show.
export type MessageRowLayout =
	// A card row (add-source flow) stands alone in the flow — no prose or trace.
	// `footnote` when every card is an aside receipt, which sits under the message
	// above it rather than as a turn of its own.
	| { kind: 'cards'; cards: CardPart[]; footnote: boolean }
	// A turn that failed to reach the model: the app's words standing in for the
	// reply, drawn as a failure.
	| { kind: 'failed' }
	// Streaming with nothing yet to show but what the turn is doing.
	| { kind: 'phase' }
	// The trace alone, with no wrapper.
	| { kind: 'trace'; tools: ToolStatus[] }
	// Nothing to draw.
	| { kind: 'empty' }
	// No reply text: the records of the turn, the trace and the notice, stacked.
	| { kind: 'stack'; tickets: TicketPart[]; tools: ToolStatus[] | null; notice: string | null }
	// The reply. `notice` and `copy` only once it has settled.
	| {
			kind: 'reply';
			textPart: TextPart;
			tickets: TicketPart[];
			tools: ToolStatus[] | null;
			notice: string | null;
			copy: boolean;
	  };

export function messageRowLayout(
	parts: readonly ChatPart[],
	flags: { streaming?: boolean; failed?: boolean; notice?: string },
): MessageRowLayout {
	const { streaming, failed, notice } = flags;
	const cards = parts.filter((p): p is CardPart => p.type === 'card');
	if (cards.length > 0) {
		return { kind: 'cards', cards, footnote: cards.every((p) => p.card.kind === 'aside') };
	}

	// A row carrying a notice is not a failure, even with nothing written — it
	// falls through to the notice-only row below. refusalRow clears `failed`, so
	// no refusal arrives here with both set; the `!notice` half stays for any
	// other path that ever marks a row and then adds a sentence about the turn.
	if (failed && !notice) return { kind: 'failed' };

	const toolPart = parts.find((p): p is Extract<ChatPart, { type: 'tool-trace' }> => p.type === 'tool-trace');
	const textPart = parts.find((p): p is TextPart => p.type === 'text' && !!p.text);
	// What this round wrote down and what it sent off, between the words and the
	// trace: the records of the turn, in the order the calls finished.
	const tickets = parts.filter(
		(p): p is TicketPart => p.type === 'receipt' || p.type === 'dispatch',
	);
	const tools = toolPart && visibleTrace(toolPart.tools).length ? toolPart.tools : null;

	// While a tool runs with no reply text yet, the trace is the status line.
	if (streaming && !textPart) {
		if (tickets.length) return { kind: 'stack', tickets, tools, notice: null };
		return tools ? { kind: 'trace', tools } : { kind: 'phase' };
	}
	// A turn that stopped before writing anything (turn-rows.ts): the notice is
	// the whole row. Not red and with no Copy — nothing failed and there are no
	// model words to take.
	if (!textPart) {
		if (notice) return { kind: 'stack', tickets, tools, notice };
		if (tickets.length) return { kind: 'stack', tickets, tools, notice: null };
		return tools ? { kind: 'trace', tools } : { kind: 'empty' };
	}
	return {
		kind: 'reply',
		textPart,
		tickets,
		tools,
		notice: !streaming && notice ? notice : null,
		copy: !streaming,
	};
}
