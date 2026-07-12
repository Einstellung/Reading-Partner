// Tool and UI icons. The highlight/underline/area/note glyphs and the color
// swatch are adapted from zotero/reader (res/icons/20 and
// src/common/components/common/icons.js). The pointer and trash glyphs have no
// counterpart there and are drawn here.

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

// Drawn here: standard arrow cursor.
export function IconPointer({ size = 20 }: IconProps) {
	return (
		<svg {...svgProps(size)}>
			<path
				d="M5 3L5 15.5L8.2 12.4L10.5 17L12.4 16.2L10.1 11.7L14.5 11.5L5 3Z"
				fill="currentColor"
			/>
		</svg>
	);
}

// Adapted from res/icons/20/annotate-highlight.svg
export function IconHighlight({ size = 20 }: IconProps) {
	return (
		<svg {...svgProps(size)}>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M3 3H17V17H3V3ZM1.75 1.75H3H17H18.25V3V17V18.25H17H3H1.75V17V3V1.75ZM16 16L11 4H9L4 16H6.16667L7.41667 13H12.5833L13.8333 16H16ZM10 6.8L8.04167 11.5H11.9583L10 6.8Z"
				fill="currentColor"
			/>
		</svg>
	);
}

// Adapted from res/icons/20/annotate-underline.svg
export function IconUnderline({ size = 20 }: IconProps) {
	return (
		<svg {...svgProps(size)}>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M16 16L11 4H9L4 16H6.16667L7.41667 13H12.5833L13.8333 16H16ZM10 6.8L8.04167 11.5H11.9583L10 6.8ZM2 17H3H17H18V17.25V18V18.25H17H3H2V18V17.25V17Z"
				fill="currentColor"
			/>
		</svg>
	);
}

// Adapted from res/icons/20/annotate-area.svg (used for the image/area tool)
export function IconArea({ size = 20 }: IconProps) {
	return (
		<svg {...svgProps(size)}>
			<path d="M12 1.75H8V3H12V1.75Z" fill="currentColor" />
			<path fillRule="evenodd" clipRule="evenodd" d="M4 4V16H16V4H4ZM14.75 5.25H5.25V14.75H14.75V5.25Z" fill="currentColor" />
			<path d="M17 14H18.25V18.25H14V17H17V14Z" fill="currentColor" />
			<path d="M18.25 8H17V12H18.25V8Z" fill="currentColor" />
			<path d="M1.75 8H3V12H1.75V8Z" fill="currentColor" />
			<path d="M8 17H12V18.25H8V17Z" fill="currentColor" />
			<path d="M14 3H17V6H18.25V1.75H14V3Z" fill="currentColor" />
			<path d="M3 3V6H1.75L1.75 1.75H6V3H3Z" fill="currentColor" />
			<path d="M6 17H3L3 14L1.75 14V18.25H6V17Z" fill="currentColor" />
		</svg>
	);
}

// Adapted from IconColor20 in src/common/components/common/icons.js
export function IconColorSwatch({ color, size = 18 }: { color: string; size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="2" y="2" width="16" height="16" rx="4" fill={color} />
			<rect x="2.5" y="2.5" width="15" height="15" rx="3.5" stroke="currentColor" strokeOpacity="0.15" />
		</svg>
	);
}

// Adapted from res/icons/16/x-8.svg
export function IconClose({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M11.2923 12L12 11.292L8.70711 7.99999L12 4.70796L11.2922 4L8.00011 7.29299L4.70798 4L4 4.70774L7.29311 7.99999L4 11.2922L4.70796 12L8.00011 8.70699L11.2923 12Z"
				fill="currentColor"
			/>
		</svg>
	);
}

// Drawn here: sparkle for the AI pen and the AI-thread marker.
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

// Drawn here: expand/maximize glyph for the call bubble.
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

// Drawn here: star for the trace-list star toggle.
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

// Drawn here: trash can for the delete action.
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
