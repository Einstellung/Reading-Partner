// Shared prop contracts for the presentational reader-annotation components.
// Colors come from ANNOTATION_COLORS in src/annotations.ts (single source).

export interface ColorEntry {
	name: string;
	color: string;
}

// The tool group is a single-select rack that also allows "nothing selected".
//   'none'    — nothing selected: the traditional reading mode (a stylus marks
//               and selects, the finger moves the page).
//   'navlock' — the palm toggle, a navigation lock: every pointer only moves the
//               page. Mutually exclusive with the annotation tools by being one
//               of the same values.
export type ToolType = 'none' | 'navlock' | 'highlight' | 'underline' | 'ai';

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
