// Tool and UI icons, all drawn for this project as stroke-based glyphs on
// currentColor.

interface IconProps {
	size?: number;
}

function svgProps(size: number) {
	return {
		width: size,
		height: size,
		viewBox: '0 0 20 20',
		fill: 'none',
		xmlns: 'http://www.w3.org/2000/svg',
	};
}

// Open-hand browse cursor (the classic PDF-viewer hand).
export function IconPointer({ size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M18 11V6a2 2 0 0 0-4 0v5" />
			<path d="M14 10V4a2 2 0 0 0-4 0v2" />
			<path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
			<path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
		</svg>
	);
}

// Chisel-tip marker over the line it just highlighted.
export function IconHighlight({ size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M12.6 3.4L16.6 7.4L9.9 14.1L4.9 15.1L5.9 10.1L12.6 3.4Z" />
			<path d="M4 17.8H16" strokeWidth="1.8" />
		</svg>
	);
}

// Text underline: a "U" over its line.
export function IconUnderline({ size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M6.2 3.6V9.2C6.2 11.3 7.9 13 10 13C12.1 13 13.8 11.3 13.8 9.2V3.6" />
			<path d="M5 16.6H15" />
		</svg>
	);
}

// Dashed marquee rectangle for the area/image capture tool.
export function IconArea({ size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="3.2" y="3.2" width="13.6" height="13.6" rx="1.6" strokeDasharray="2.9 2.3" />
		</svg>
	);
}

// Round color dot with a faint rim so light colors keep an edge.
export function IconColorSwatch({ color, size = 18 }: { color: string; size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="10" cy="10" r="7.5" fill={color} />
			<circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.15" />
		</svg>
	);
}

// Plain X.
export function IconClose({ size = 16 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M4.5 4.5L11.5 11.5" />
			<path d="M11.5 4.5L4.5 11.5" />
		</svg>
	);
}

// Sparkle for the AI pen and the AI-thread marker.
export function IconSparkle({ size = 20 }: IconProps) {
	return (
		<svg {...svgProps(size)}>
			<path
				d="M10 2.5L11.4 7.1C11.6 7.7 12.1 8.2 12.7 8.4L17.3 9.8L12.7 11.2C12.1 11.4 11.6 11.9 11.4 12.5L10 17.1L8.6 12.5C8.4 11.9 7.9 11.4 7.3 11.2L2.7 9.8L7.3 8.4C7.9 8.2 8.4 7.7 8.6 7.1L10 2.5Z"
				fill="currentColor"
			/>
			<path d="M15.75 2.5L16.3 4.2L18 4.75L16.3 5.3L15.75 7L15.2 5.3L13.5 4.75L15.2 4.2L15.75 2.5Z" fill="currentColor" />
		</svg>
	);
}

// Send arrow for the chat composer.
export function IconSend({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

// Filled square to stop a streaming reply.
export function IconStop({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" />
		</svg>
	);
}

// Copy glyph (two sheets) for the message copy action.
export function IconCopy({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.2" />
			<path
				d="M10.25 3.75C10.25 3.06 9.69 2.5 9 2.5H4.25C3.28 2.5 2.5 3.28 2.5 4.25V9C2.5 9.69 3.06 10.25 3.75 10.25"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

// Check mark for the "copied" confirmation.
export function IconCheck({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

// Expand/maximize glyph for the call bubble.
export function IconExpand({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M6 2.5H2.5V6M10 2.5H13.5V6M13.5 10V13.5H10M6 13.5H2.5V10"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// Star for the trace-list star toggle.
export function IconStar({ filled = false, size = 16 }: { filled?: boolean; size?: number }) {
	const d = 'M8 1.75L9.94 5.68L14.28 6.31L11.14 9.37L11.88 13.69L8 11.65L4.12 13.69L4.86 9.37L1.72 6.31L6.06 5.68L8 1.75Z';
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d={d}
				fill={filled ? 'currentColor' : 'none'}
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// Panel glyph for the sidebar collapse/expand toggle.
export function IconSidebar({ size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
			<path d="M8 3.75V16.25" />
		</svg>
	);
}

// Table-of-contents glyph for the outline tab.
export function IconOutline({ size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M3.5 5H16.5" />
			<path d="M6.75 8.75H16.5" />
			<path d="M6.75 12.25H16.5" />
			<path d="M3.5 16H16.5" />
		</svg>
	);
}

// Trash can for the delete action.
export function IconTrash({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M6 2.5H10M2.5 4.5H13.5M12 4.5L11.5 13C11.45 13.55 11 14 10.45 14H5.55C5 14 4.55 13.55 4.5 13L4 4.5M6.5 7V11.5M9.5 7V11.5"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
