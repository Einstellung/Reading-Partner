// PenToolbar: vertical tool rack on the left of the reading area, modeled on the
// Zotero iPad reader's annotation toolbar. Pure and controlled — the parent owns
// the current Tool (including sticky behaviour); this renders it and reports changes.

import { useEffect, useRef, useState } from 'react';
import { IconColorSwatch, IconHighlight, IconPointer, IconSparkle, IconUnderline } from './icons';
import type { ColorEntry, Tool, ToolType } from './types';
import './PenToolbar.css';

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

export default function PenToolbar({ tool, colors, onToolChange, orientation = 'vertical' }: PenToolbarProps) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const paletteRef = useRef<HTMLDivElement>(null);

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

	function pickTool(type: ToolType) {
		if (type !== tool.type) onToolChange({ type, color: tool.color });
	}

	function pickColor(color: string) {
		setPaletteOpen(false);
		if (color !== tool.color) onToolChange({ type: tool.type, color });
	}

	return (
		<div
			className={'pen-toolbar' + (orientation === 'horizontal' ? ' horizontal' : '')}
			role="toolbar"
			aria-orientation={orientation}
			aria-label="Annotation tools"
		>
			{TOOLS.map(({ type, label, Icon }) => (
				<button
					key={type}
					type="button"
					className={'pen-tool' + (type === 'ai' ? ' pen-ai' : '') + (tool.type === type ? ' active' : '')}
					title={label}
					aria-label={label}
					aria-pressed={tool.type === type}
					onClick={() => pickTool(type)}
				>
					<Icon size={20} />
				</button>
			))}

			{/* AI pen has a fixed, parent-managed color, so the picker has no role while it's active. */}
			{tool.type !== 'ai' && (
			<>
			<div className="pen-toolbar-sep" />

			<div className="pen-color" ref={paletteRef}>
				<button
					type="button"
					className={'pen-tool pen-color-current' + (paletteOpen ? ' active' : '')}
					title="Color"
					aria-label="Color"
					aria-haspopup="true"
					aria-expanded={paletteOpen}
					onClick={() => setPaletteOpen((v) => !v)}
				>
					<IconColorSwatch color={tool.color} size={20} />
				</button>

				{paletteOpen && (
					<div className="pen-palette" role="listbox" aria-label="Colors">
						{colors.map((c) => (
							<button
								key={c.color}
								type="button"
								role="option"
								aria-selected={tool.color === c.color}
								className={'pen-swatch' + (tool.color === c.color ? ' selected' : '')}
								title={c.name}
								onClick={() => pickColor(c.color)}
							>
								<IconColorSwatch color={c.color} size={18} />
							</button>
						))}
					</div>
				)}
			</div>
			</>
			)}
		</div>
	);
}
