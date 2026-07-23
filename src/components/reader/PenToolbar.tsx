// PenToolbar: the annotation tool rack. Pure and controlled — the parent owns
// the current Tool (including sticky behaviour); this renders it and reports
// changes. Styled with Tailwind utilities.

import { useEffect, useRef, useState } from 'react';
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

const TOOLS: { type: ToolType; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
	{ type: 'pointer', label: 'Select', Icon: IconPointer },
	{ type: 'highlight', label: 'Highlight', Icon: IconHighlight },
	{ type: 'underline', label: 'Underline', Icon: IconUnderline },
	{ type: 'ai', label: 'AI pen', Icon: IconSparkle },
];

const TOOL_BTN =
	'flex items-center justify-center rounded-lg border-0 bg-transparent p-0 text-neutral-700';
const CARD = 'rounded-xl border border-black/10 bg-white shadow-lg';

export default function PenToolbar({ tool, colors, onToolChange, orientation = 'vertical' }: PenToolbarProps) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const paletteRef = useRef<HTMLDivElement>(null);
	const horizontal = orientation === 'horizontal';
	// Only the painting tools carry a color; the pointer and AI pen do not, so the
	// swatch shows as a disabled placeholder to keep the rack width stable.
	const hasColor = tool.type === 'highlight' || tool.type === 'underline';

	useEffect(() => {
		if (!paletteOpen) return;
		function onDown(e: MouseEvent) {
			if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
				setPaletteOpen(false);
			}
		}
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [paletteOpen]);

	useEffect(() => {
		if (!hasColor) setPaletteOpen(false);
	}, [hasColor]);

	function pickTool(type: ToolType) {
		if (type !== tool.type) onToolChange({ type, color: tool.color });
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
	const toolSize = horizontal ? 'h-8 w-8' : 'h-9 w-9';
	// The AI pen keeps violet as its theme accent, but shares the tool rack's one
	// visual language: same size, same light-tinted-fill selected state as the
	// blue tools — no gradient block, no size change.
	const toolBtn = (active: boolean, ai: boolean) =>
		`${TOOL_BTN} ${toolSize} cursor-pointer ` +
		(ai
			? active
				? 'bg-violet-100 text-violet-700'
				: 'text-violet-500 hover:bg-black/5'
			: active
				? 'bg-sky-100 text-sky-700'
				: 'hover:bg-black/5');

	return (
		<div
			className={rack}
			role="toolbar"
			aria-orientation={orientation}
			aria-label="Annotation tools"
		>
			{TOOLS.map(({ type, label, Icon }) => (
				<button
					key={type}
					type="button"
					className={toolBtn(tool.type === type, type === 'ai')}
					title={label}
					aria-label={label}
					aria-pressed={tool.type === type}
					onClick={() => pickTool(type)}
				>
					<Icon size={20} />
				</button>
			))}

			{/* The divider and swatch always hold their place so the rack width never
			    jumps between tools; colorless tools (pointer, AI pen) show the swatch
			    as a disabled placeholder rather than removing it. */}
			<div className={horizontal ? 'mx-1 h-5 w-px bg-black/10' : 'my-0.5 h-px w-6 bg-black/10'} />

			<div className="relative flex" ref={paletteRef}>
				<button
					type="button"
					className={
						`${TOOL_BTN} ${toolSize} ` +
						(!hasColor
							? 'cursor-not-allowed opacity-40'
							: paletteOpen
								? 'cursor-pointer bg-sky-100 text-sky-700'
								: 'cursor-pointer hover:bg-black/5')
					}
					title="Color"
					aria-label="Color"
					aria-haspopup="true"
					aria-expanded={paletteOpen}
					disabled={!hasColor}
					onClick={() => setPaletteOpen((v) => !v)}
				>
					<IconColorSwatch color={tool.color} size={20} />
				</button>

				{paletteOpen && (
					<div
						className={
							// Fixed column tracks: an absolutely-positioned popover shrinks to its
							// 32px positioning wrapper, so 1fr tracks would collapse.
							`absolute z-10 grid grid-cols-[repeat(4,1.75rem)] gap-0.5 p-1.5 shadow-xl ${CARD} ` +
							(horizontal ? 'left-1/2 top-full mt-2 -translate-x-1/2' : 'left-full top-0 ml-2')
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
									'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 hover:bg-black/5' +
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
