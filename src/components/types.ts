// Shared prop contracts for the presentational reader-annotation components.
// Colors mirror ANNOTATION_COLORS from vendor/reader/src/common/defines.js
// (the shell's annotations module re-exports the same values in this shape).

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

export interface ThreadMessage {
	role: 'user' | 'ai';
	text: string;
	ts: number;
	images?: ChatImage[];
}

export interface Thread {
	id: string;
	annotationId: string;
	messages: ThreadMessage[];
}
