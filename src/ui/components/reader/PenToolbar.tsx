// PenToolbar: the annotation tool rack. Pure and controlled — the parent owns
// the current Tool (including sticky behaviour); this renders it and reports
// changes. Styled with Tailwind utilities.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconColorSwatch, IconHighlight, IconPointer, IconSparkle, IconUnderline } from '../common/icons';
import type { ColorEntry, Tool, ToolType } from '../common/types';

interface PenToolbarProps {
	tool: Tool;
	colors: ColorEntry[];
	onToolChange(tool: Tool): void;
	// 'horizontal' lays the rack out as a row for the header bar; 'vertical' is
	// the floating rack beside the page.
	orientation?: 'vertical' | 'horizontal';
}

// 'none' is not a button: it is the state the rack is in when no button is
// pressed. Every button toggles, so tapping the active one returns to 'none'.
const TOOLS: { type: ToolType; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
	{ type: 'navlock', label: 'Navigate only', Icon: IconPointer },
	{ type: 'highlight', label: 'Highlight', Icon: IconHighlight },
	{ type: 'underline', label: 'Underline', Icon: IconUnderline },
	{ type: 'ai', label: 'AI pen', Icon: IconSparkle },
];

// The two tools that paint in a color.
type PenType = 'highlight' | 'underline';

const TOOL_BTN =
	'flex items-center justify-center rounded-lg border-0 bg-transparent p-0 text-neutral-700';
const CARD = 'rounded-xl border border-black/10 bg-white shadow-lg';
// Distance from the swatch to the palette that opens off it.
const GAP = 8;

export default function PenToolbar({ tool, colors, onToolChange, orientation = 'vertical' }: PenToolbarProps) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	// Where the open palette sits, in viewport coordinates. It cannot be laid out
	// against the swatch: the header's tool band scrolls horizontally, and a
	// scroll container clips both axes, so an absolutely-positioned popover
	// hanging below the bar never reaches the screen.
	const [palettePos, setPalettePos] = useState<{ left: number; top: number } | null>(null);
	const paletteRef = useRef<HTMLDivElement>(null);
	const swatchRef = useRef<HTMLButtonElement>(null);
	const horizontal = orientation === 'horizontal';
	// Only the painting tools carry a color; the navigation lock, the AI pen and
	// the all-unselected state do not.
	const hasColor = tool.type === 'highlight' || tool.type === 'underline';

	useLayoutEffect(() => {
		if (!paletteOpen) {
			setPalettePos(null);
			return;
		}
		const swatch = swatchRef.current;
		if (!swatch) return;
		// Horizontal hangs below the swatch and is centred on it (the popover
		// carries the -50% itself); vertical opens to its right, top-aligned.
		const place = () => {
			const r = swatch.getBoundingClientRect();
			setPalettePos(
				horizontal
					? { left: r.left + r.width / 2, top: r.bottom + GAP }
					: { left: r.right + GAP, top: r.top },
			);
		};
		place();
		window.addEventListener('resize', place);
		return () => window.removeEventListener('resize', place);
	}, [paletteOpen, horizontal]);

	// A press outside shuts the palette. pointerdown, not mousedown, and capture:
	// docs/pitfall/67-webkit-tap-does-not-focus-a-button.md.
	useEffect(() => {
		if (!paletteOpen) return;
		function onDown(e: PointerEvent) {
			if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
				setPaletteOpen(false);
			}
		}
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	}, [paletteOpen]);

	useEffect(() => {
		if (!hasColor) setPaletteOpen(false);
	}, [hasColor]);

	// Which pen the color belongs to when none is out. Reaching for the color is
	// reaching for the pen, so the swatch picks the last one used rather than
	// sitting there dead.
	const lastPen = useRef<PenType>('highlight');
	useEffect(() => {
		if (hasColor) lastPen.current = tool.type as PenType;
	}, [hasColor, tool.type]);

	// Pressing the active button releases it: the rack drops to 'none', which is
	// the traditional mode, not another tool.
	function pickTool(type: ToolType) {
		onToolChange({ type: type === tool.type ? 'none' : type, color: tool.color });
	}

	function pickSwatch() {
		if (!hasColor) onToolChange({ type: lastPen.current, color: tool.color });
		setPaletteOpen((v) => !hasColor || !v);
	}

	function pickColor(color: string) {
		setPaletteOpen(false);
		if (color !== tool.color) onToolChange({ type: tool.type, color });
	}

	// Horizontal lives inside the header bar (the header is its surface); the
	// vertical variant is a free-floating card.
	const rack = horizontal
		? 'inline-flex flex-row items-center gap-0.5 p-0.5 select-none'
		: `inline-flex flex-col items-center gap-1 p-1.5 select-none ${CARD}`;
	const toolSize = (horizontal ? 'h-8 w-8' : 'h-9 w-9') + ' coarse:h-11 coarse:w-11';
	// The AI pen keeps violet as its theme accent, but shares the tool rack's one
	// visual language: same size, same light-tinted-fill selected state as the
	// blue tools — no gradient block, no size change.
	// The navigation lock is a latch, not a tool, so its pressed state carries an
	// extra inset ring — it has to read as held down across a whole reading
	// session, not just as "most recently tapped".
	const toolBtn = (active: boolean, type: ToolType) =>
		`${TOOL_BTN} ${toolSize} cursor-pointer ` +
		(type === 'ai'
			? active
				? 'bg-violet-100 text-violet-700'
				: 'text-violet-500 hover:bg-black/5'
			: active
				? 'bg-sky-100 text-sky-700' + (type === 'navlock' ? ' ring-2 ring-inset ring-sky-600' : '')
				: 'hover:bg-black/5');

	return (
		<div
			className={rack}
			role="toolbar"
			aria-orientation={orientation}
			aria-label="Reading tools"
		>
			{TOOLS.map(({ type, label, Icon }) => (
				<button
					key={type}
					type="button"
					className={toolBtn(tool.type === type, type)}
					title={label}
					aria-label={label}
					aria-pressed={tool.type === type}
					onClick={() => pickTool(type)}
				>
					<Icon size={20} />
				</button>
			))}

			{/* The divider and swatch always hold their place so the rack width never
			    jumps between tools. */}
			<div className={horizontal ? 'mx-1 h-5 w-px bg-black/10' : 'my-0.5 h-px w-6 bg-black/10'} />

			<div className="relative flex" ref={paletteRef}>
				<button
					ref={swatchRef}
					type="button"
					className={
						`${TOOL_BTN} ${toolSize} cursor-pointer ` +
						(paletteOpen ? 'bg-sky-100 text-sky-700' : 'hover:bg-black/5')
					}
					title="Color"
					aria-label="Color"
					aria-haspopup="true"
					aria-expanded={paletteOpen}
					onClick={pickSwatch}
				>
					<IconColorSwatch color={tool.color} size={20} />
				</button>

				{paletteOpen && palettePos && (
					<div
						style={{ left: palettePos.left, top: palettePos.top }}
						className={
							// Fixed column tracks: the popover shrinks to its content, so 1fr
							// tracks would collapse. A track has to hold a whole swatch button,
							// which is finger-sized on a touch device.
							`fixed z-[1000] grid grid-cols-[repeat(4,1.75rem)] coarse:grid-cols-[repeat(4,2.75rem)] gap-0.5 p-1.5 shadow-xl ${CARD} ` +
							(horizontal ? '-translate-x-1/2' : '')
						}
						role="listbox"
						aria-label="Colors"
					>
						{colors.map((c) => (
							<button
								key={c.color}
								type="button"
								role="option"
								aria-selected={tool.color === c.color}
								className={
									'flex h-7 w-7 coarse:h-11 coarse:w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 hover:bg-black/5' +
									(tool.color === c.color ? ' ring-2 ring-inset ring-sky-600' : '')
								}
								title={c.name}
								onClick={() => pickColor(c.color)}
							>
								<IconColorSwatch color={c.color} size={18} />
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
