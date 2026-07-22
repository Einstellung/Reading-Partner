// Shared prop contracts for the presentational reader-annotation components.
// Colors come from ANNOTATION_COLORS in src/annotations.ts (single source).

import type { InfoCard } from "../info/cards";

export interface ColorEntry {
	name: string;
	color: string;
}

export type ToolType = 'pointer' | 'highlight' | 'underline' | 'ai';

export interface Tool {
	type: ToolType;
	color: string;
}

// A chat image in display form: raw base64 + MIME type, ready for a data: URL.
// (Persistence keeps filename references instead; see threads.ts.)
export interface ChatImage {
	data: string;
	mediaType: string;
}

// A staged (pre-send) image. It appears instantly as a placeholder while the
// async compression runs, then resolves to a ready preview.
export type PendingImage =
	| { id: string; status: 'loading' }
	| { id: string; status: 'ready'; data: string; mediaType: string };

export interface Annotation {
	id: string;
	type: string;
	color?: string;
	comment?: string;
	text?: string;
	[k: string]: unknown;
}

// A tool call surfaced in the chat flow while the AI turn runs (M6). 'running'
// shows a subdued status line; 'error' reuses the soft-error style. Successful
// tools are dropped from the list once their result is folded into the answer.
export interface ToolStatus {
	name: string;
	label: string;
	state: 'running' | 'error';
}

export interface ThreadMessage {
	role: 'user' | 'ai';
	text: string;
	ts: number;
	images?: ChatImage[];
	// Transient display flags (not persisted): the AI reply currently streaming,
	// or a turn that failed (rendered as a muted notice, not normal prose).
	streaming?: boolean;
	failed?: boolean;
	// Transient tool-call trace shown above the streaming reply (M6).
	tools?: ToolStatus[];
	// Transient inline card for the info add-source flow (docs/17): a probe-confirm
	// card, or the first-briefing readiness/failure. Rendered by the host via a
	// renderCard callback; absent in the reader chat.
	card?: InfoCard;
}

export interface Thread {
	id: string;
	annotationId: string;
	messages: ThreadMessage[];
}
