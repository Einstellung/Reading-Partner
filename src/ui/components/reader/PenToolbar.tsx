// PenToolbar: the annotation tool rack. Pure and controlled — the parent owns
// the current Tool (including sticky behaviour); this renders it and reports
// changes. Styled with Tailwind utilities.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconColorSwatch, IconHighlight, IconPointer, IconSparkle, IconUnderline } from '../common/icons';
import { placePanel } from '../common/panel-position';
import { useViewportSize } from '../common/useViewportSize';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import { OVERLAY_Z, useOverlaySafePadding } from '../ui/overlay';
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
	const popoverRef = useRef<HTMLDivElement>(null);
	const swatchRef = useRef<HTMLButtonElement>(null);
	const viewport = useViewportSize();
	// Smallest distance from the palette to a viewport edge, per edge: the palette
	// is `fixed`, so the shell's safe-area padding misses it (docs/pitfall/74).
	// Without an inset this is the plain 8px gutter, as it was.
	const margin = useOverlaySafePadding();
	const horizontal = orientation === 'horizontal';
	// Only the painting tools carry a color; the navigation lock, the AI pen and
	// the all-unselected state do not.
	const hasColor = tool.type === 'highlight' || tool.type === 'underline';

	// Horizontal hangs the palette below the swatch and centres it on it; vertical
	// opens it to the swatch's side. Both are measured and clamped to the viewport:
	// the header's tool band scrolls, so the swatch can sit against the screen edge
	// with half the palette's colors past it.
	useLayoutEffect(() => {
		if (!paletteOpen) {
			setPalettePos(null);
			return;
		}
		const swatch = swatchRef.current;
		const popover = popoverRef.current;
		if (!swatch || !popover) return;
		const rect = popover.getBoundingClientRect();
		setPalettePos(
			placePanel({
				anchor: swatch.getBoundingClientRect(),
				panel: { width: rect.width, height: rect.height },
				viewport,
				placement: horizontal ? 'below' : 'right',
				gap: GAP,
				margin,
			}),
		);
	}, [paletteOpen, horizontal, viewport, margin]);

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
	// One selected state for the whole rack: --secondary, the tinted fill this app
	// gives a control that is standing on. The AI pen keeps an accent of its own in
	// the resting state (--primary) rather than a second selected colour.
	// `can-hover:hover:bg-secondary` is not a no-op: it holds the selected fill
	// against the ghost variant's hover fill, and has to repeat the modifier chain
	// exactly to replace it (docs/pitfall/78).
	// The navigation lock is a latch, not a tool, so its pressed state carries an
	// extra inset ring — it has to read as held down across a whole reading
	// session, not just as "most recently tapped".
	const toolBtn = (active: boolean, type: ToolType) =>
		`rounded-lg ${toolSize} ` +
		(active
			? 'bg-secondary text-secondary-foreground can-hover:hover:bg-secondary' +
				(type === 'navlock' ? ' ring-2 ring-inset ring-primary' : '')
			: type === 'ai'
				? 'text-primary'
				: 'text-neutral-700');

	return (
		<div
			className={rack}
			role="toolbar"
			aria-orientation={orientation}
			aria-label="Reading tools"
		>
			{TOOLS.map(({ type, label, Icon }) => (
				<Button
					key={type}
					type="button"
					variant="ghost"
					// The rack sets its own square geometry, so no size variant: the
					// table's `icon` is 32px and these are 32 or 36 by orientation.
					size={null}
					className={toolBtn(tool.type === type, type)}
					title={label}
					aria-label={label}
					aria-pressed={tool.type === type}
					onClick={() => pickTool(type)}
				>
					<Icon size={20} />
				</Button>
			))}

			{/* The divider and swatch always hold their place so the rack width never
			    jumps between tools. */}
			<div className={horizontal ? 'mx-1 h-5 w-px bg-black/10' : 'my-0.5 h-px w-6 bg-black/10'} />

			<div className="relative flex" ref={paletteRef}>
				{/* The swatch is the palette's anchor, so the ref has to resolve: Button
				    forwards it (docs/pitfall/95). */}
				<Button
					ref={swatchRef}
					type="button"
					variant="ghost"
					size={null}
					className={
						`rounded-lg ${toolSize} text-neutral-700` +
						(paletteOpen ? ' bg-secondary text-secondary-foreground can-hover:hover:bg-secondary' : '')
					}
					title="Color"
					aria-label="Color"
					aria-haspopup="true"
					aria-expanded={paletteOpen}
					onClick={pickSwatch}
				>
					<IconColorSwatch color={tool.color} size={20} />
				</Button>

				{paletteOpen && (
					<div
						ref={popoverRef}
						// Hidden at the origin until it has been measured: clamping needs the
						// palette's own size, which the swatch cannot supply. The layout
						// effect places it before the browser paints.
						style={
							palettePos
								? { left: palettePos.left, top: palettePos.top, visibility: 'visible' }
								: { left: 0, top: 0, visibility: 'hidden' }
						}
						className={cn(
							// CARD first: it carries shadow-lg, and cn() lets the later class of
							// a kind win, so the popover's deeper shadow-xl has to come after it.
							CARD,
							// Fixed column tracks: the popover shrinks to its content, so 1fr
							// tracks would collapse. A track has to hold a whole swatch button,
							// which is finger-sized on a touch device.
							'fixed grid grid-cols-[repeat(4,1.75rem)] coarse:grid-cols-[repeat(4,2.75rem)] gap-0.5 p-1.5 shadow-xl',
							OVERLAY_Z.floating,
						)}
						role="listbox"
						aria-label="Colors"
					>
						{colors.map((c) => (
							<Button
								key={c.color}
								type="button"
								variant="ghost"
								size={null}
								role="option"
								aria-selected={tool.color === c.color}
								className={
									'h-7 w-7 coarse:h-11 coarse:w-11 rounded-md' +
									(tool.color === c.color ? ' ring-2 ring-inset ring-primary' : '')
								}
								title={c.name}
								onClick={() => pickColor(c.color)}
							>
								<IconColorSwatch color={c.color} size={18} />
							</Button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
