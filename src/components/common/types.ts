// Shared prop contracts for the presentational reader-annotation components.
// Colors come from ANNOTATION_COLORS in src/annotations.ts (single source).

import type { InfoCard } from "../../info/briefing/cards";
import type { ChatPart } from "../chat/chatParts";

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
	// card, or the first-briefing readiness/failure. Legacy field; new code uses a
	// `card` part in `parts` instead. Absent in the reader chat.
	card?: InfoCard;
	// The message-parts protocol (chatParts.ts). When present it is the durable,
	// authoritative structure of the row; the render layer reads only parts (via
	// messageToParts, which maps the legacy text/tools/card fields when parts is
	// absent). Optional so callers that still set the legacy fields keep working.
	parts?: ChatPart[];
}

export interface Thread {
	id: string;
	annotationId: string;
	messages: ThreadMessage[];
}
