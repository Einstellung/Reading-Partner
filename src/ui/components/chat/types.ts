// The prop contracts for a chat row and its composer.

import type { CompressedImage } from "../../../ai/image-utils";
import type { ToolStatus } from "../../../ai/tool-status";
import type { InfoCard } from "../../../info/briefing/cards";
import type { ChatPart } from "./chatParts";

// A staged (pre-send) image. It appears instantly as a placeholder while the
// async compression runs, then resolves to a ready preview.
export type PendingImage =
	| { id: string; status: 'loading' }
	| ({ id: string; status: 'ready' } & CompressedImage);

export interface ThreadMessage {
	role: 'user' | 'ai';
	text: string;
	ts: number;
	// Image bytes in display form: bare base64 + MIME type, ready for a data:
	// URL, the same shape the compressor hands back. (Persistence keeps filename
	// references instead; see threads.ts.)
	images?: CompressedImage[];
	// Transient display flags (not persisted): the AI reply currently streaming,
	// or a turn that failed (rendered as a muted notice, not normal prose).
	streaming?: boolean;
	failed?: boolean;
	// Transient tool-call trace shown above the streaming reply (M6).
	tools?: ToolStatus[];
	// What this turn had to leave out of the model's view to fit the context
	// window (src/budget). One quiet line after the answer. Never persisted and
	// never part of `text`: it is the app talking about the turn, not the model's
	// output, and replaying it next turn would put words in the model's mouth.
	notice?: string;
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
