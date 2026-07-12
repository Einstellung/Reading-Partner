// Shared prop contracts for the presentational reader-annotation components.
// Colors mirror ANNOTATION_COLORS from vendor/reader/src/common/defines.js
// (the shell's annotations module re-exports the same values in this shape).

export interface ColorEntry {
	name: string;
	color: string;
}

export type ToolType = 'pointer' | 'highlight' | 'underline' | 'image' | 'ai';

export interface Tool {
	type: ToolType;
	color: string;
}

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
}

export interface Thread {
	id: string;
	annotationId: string;
	messages: ThreadMessage[];
}
