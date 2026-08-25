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

// Sparkle for the AI-thread marker.
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

// Speech bubble with a tail pointing down at the marked line, over a heavier
// underline: the AI pen, which asks about the one passage it just marked.
export function IconAskHere({ size = 20 }: IconProps) {
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
			<rect x="3.4" y="2.8" width="13.2" height="8.8" rx="2.6" />
			<path d="M7.6 11.6L8.3 14.7L11 11.6" />
			<path d="M4.6 17.6H15.4" strokeWidth="1.9" />
		</svg>
	);
}

// Memory-chip glyph for the AI observations tab.
export function IconObservations({ size = 20 }: IconProps) {
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
			<rect x="5" y="5" width="10" height="10" rx="1.5" />
			<rect x="8" y="8" width="4" height="4" />
			<path d="M7.5 5V2.75" />
			<path d="M12.5 5V2.75" />
			<path d="M7.5 17.25V15" />
			<path d="M12.5 17.25V15" />
			<path d="M5 7.5H2.75" />
			<path d="M5 12.5H2.75" />
			<path d="M17.25 7.5H15" />
			<path d="M17.25 12.5H15" />
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

// Microphone glyph for push-to-talk voice input.
export function IconMic({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="6" y="1.75" width="4" height="7.5" rx="2" fill="currentColor" />
			<path
				d="M3.75 7.25V8C3.75 10.35 5.65 12.25 8 12.25C10.35 12.25 12.25 10.35 12.25 8V7.25"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
			<path d="M8 12.5V14.25M6 14.25H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

// Keyboard, for switching a composer back out of voice mode.
export function IconKeyboard({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="1.25" y="3.75" width="13.5" height="8.5" rx="1.75" stroke="currentColor" strokeWidth="1.3" />
			<path
				d="M4 6.25h.01M6.5 6.25h.01M9 6.25h.01M11.5 6.25h.01M4 8.5h.01M6.5 8.5h.01M9 8.5h.01M11.5 8.5h.01M5.25 10.5h5.5"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
			/>
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

// Paged reading layout: a page framed by left/right flip chevrons.
export function IconPagedLayout({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="7" y="4" width="6" height="12" rx="1" />
			<path d="M4 7L2.5 10L4 13" />
			<path d="M16 7L17.5 10L16 13" />
		</svg>
	);
}

// Down chevron for the toolbar "More" overflow menu.
export function IconChevronDown({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5.5 8L10 12.5L14.5 8" />
		</svg>
	);
}

// Up chevron for a select list that has more above the visible rows.
export function IconChevronUp({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5.5 12.5L10 8L14.5 12.5" />
		</svg>
	);
}

// Gear for the settings entry.
export function IconGear({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="10" cy="10" r="2.6" />
			<path d="M10 2.5V4.4M10 15.6V17.5M17.5 10H15.6M4.4 10H2.5M15.3 4.7L14 6M6 14L4.7 15.3M15.3 15.3L14 14M6 6L4.7 4.7" />
		</svg>
	);
}

// Magnifier with a plus, for zoom-in in the overflow menu.
export function IconZoomIn({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="8.5" cy="8.5" r="5" />
			<path d="M12.2 12.2L16.5 16.5" />
			<path d="M8.5 6.5V10.5M6.5 8.5H10.5" />
		</svg>
	);
}

// Magnifier with a minus, for zoom-out in the overflow menu.
export function IconZoomOut({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="8.5" cy="8.5" r="5" />
			<path d="M12.2 12.2L16.5 16.5" />
			<path d="M6.5 8.5H10.5" />
		</svg>
	);
}

// Page with side arrows: fit-to-width.
export function IconFitWidth({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="6" y="3.5" width="8" height="13" rx="1" />
			<path d="M4 10H1.75M3 8.5L1.5 10L3 11.5" />
			<path d="M16 10H18.25M17 8.5L18.5 10L17 11.5" />
		</svg>
	);
}

// Contact patch with its ripples: the on-device touch probe.
export function IconTouchProbe({ size = 20 }: IconProps) {
	return (
		<svg
			{...svgProps(size)}
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="10" cy="10" r="2.25" fill="currentColor" stroke="none" />
			<path d="M13.4 6.6a4.8 4.8 0 0 1 0 6.8M6.6 13.4a4.8 4.8 0 0 1 0-6.8" />
			<path d="M15.8 4.2a8.2 8.2 0 0 1 0 11.6M4.2 15.8a8.2 8.2 0 0 1 0-11.6" opacity="0.5" />
		</svg>
	);
}

// A tray with an arrow going into it: file this into my reading context
// (docs/21). Deliberately not a heart or a bookmark — this is not a favourites
// list, and the glyph should not read like one.
export function IconFileInto({ size = 16 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.2"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M8 2V8.6M5.6 6.4L8 8.8L10.4 6.4" />
			<path d="M2.5 10.4H5.6L6.4 11.9H9.6L10.4 10.4H13.5V12.4C13.5 13 13 13.5 12.4 13.5H3.6C3 13.5 2.5 13 2.5 12.4V10.4Z" />
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

// Two books standing on a shelf: the Materials section of a topic, which is the
// shelf itself.
export function IconBooks({ size = 20 }: IconProps) {
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
			<path d="M3.25 4.25H7.25V16.25H3.25V4.25Z" />
			<path d="M9.25 4.25H13.25V16.25H9.25V4.25Z" />
			<path d="M15 5L17.25 15.75" />
		</svg>
	);
}

// The reader's book-level AI entry (docs/09): a start point on the left page, a
// line that crosses the spine, and a filled arrowhead landing on the right page
// — the lesson path the AI carries you through, start to finish, in the order
// it picked. That is what the button opens, and it is the one thing in the tray
// that is not a tool.
//
// It is also the only icon here that is not currentColor, and deliberately so —
// three glyphs were drawn in the house system first and all three failed for the
// same reason. A board on an easel read as a television; a mortarboard read as
// graduation; the app's own two mascots over a book turned to mush at 18px,
// because a scene cannot survive at the size a stroke glyph has to work at.
// Colour does the work strokes could not: the pale page reads as paper and the
// deep-green line reads as a single path, legible with no interior detail to
// lose. The palette is the app's own (src-tauri/icons).
//
// Sized against its neighbours rather than against its own viewBox: the drawn
// mark fills 73% of the box's height, which is what IconSparkle and
// IconHighlight do in theirs. An earlier cut filled 65% and read a size small
// next to them at the same rendered size.
const MARK = {
	deep: '#2F4F39',
	mid: '#7FA971',
	pale: '#E7F0D8',
} as const;

export function IconLessonPath({ size = 20 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="3" y="3.2" width="18" height="17.6" rx="3.2" fill={MARK.pale} stroke={MARK.mid} strokeWidth="1.6" />
			<path d="M12 3.9V20.1" stroke={MARK.mid} strokeWidth="1.3" strokeLinecap="round" />
			<path d="M7.2 8C7.2 12.2 16.6 11.4 16.6 15.4" stroke={MARK.deep} strokeWidth="1.7" strokeLinecap="round" />
			<circle cx="7.2" cy="8" r="1.7" fill={MARK.deep} />
			<path d="M14.75 15.5L16.6 19L18.45 15.5Z" fill={MARK.deep} />
		</svg>
	);
}

// A screen on a stand: a retell and the deck it ends in.
export function IconRetell({ size = 20 }: IconProps) {
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
			<path d="M3.25 3.75H16.75V12.25H3.25V3.75Z" />
			<path d="M10 12.25V15.25" />
			<path d="M7 17.25L10 15.25L13 17.25" />
		</svg>
	);
}

// The same screen, with someone talking at it: a deck being given out loud.
// Deliberately IconRetell's frame — a rehearsal is that deck, one step on — with
// the stand replaced by a microphone, which is the only thing this section adds.
export function IconRehearse({ size = 20 }: IconProps) {
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
			<path d="M3.25 3.75H16.75V11.25H3.25V3.75Z" />
			<rect x="8.5" y="12.75" width="3" height="4.5" rx="1.5" />
			<path d="M6.75 15.5C6.75 17.2 8.2 18.5 10 18.5C11.8 18.5 13.25 17.2 13.25 15.5" />
		</svg>
	);
}
