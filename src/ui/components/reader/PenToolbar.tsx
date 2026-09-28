// PenToolbar: the annotation tool rack. Pure and controlled — the parent owns
// the current Tool (including sticky behaviour); this renders it and reports
// changes. Styled with Tailwind utilities. The highlighter draws in one color,
// so the rack has no color control.

import { useT, type Translate } from '../../../i18n';
import { IconAskHere, IconHighlight, IconPointer } from '../base/icons';
import { Button } from '../ui/button';
import type { Tool, ToolType } from './types';

interface PenToolbarProps {
	tool: Tool;
	onToolChange(tool: Tool): void;
	// 'horizontal' lays the rack out as a row for the header bar; 'vertical' is
	// the floating rack beside the page.
	orientation?: 'vertical' | 'horizontal';
	// Tools the rack draws but will not act with, each with the one line that
	// says why. Dim and unpressable, never dropped: the rack is where the rule
	// about levels is legible (docs/03, reading/call-state.ts).
	disabled?: Partial<Record<ToolType, string>>;
	// Tools this shell has no such thing for, dropped from the rack rather than
	// dimmed. Dim and omitted are different sentences: a dim tool is one the
	// reader could reach and this book will not open; an omitted one is a tool
	// the form factor does not have — the phone is one scroll with no pages to
	// lock, so a lock drawn there would state a rule about nothing.
	omit?: readonly ToolType[];
}

// 'none' is not a button: it is the state the rack is in when no button is
// pressed. Every button toggles, so tapping the active one returns to 'none'.
function tools(t: Translate): { type: ToolType; label: string; Icon: (p: { size?: number }) => JSX.Element }[] {
	return [
		{ type: 'navlock', label: t('reader.pen.navigateOnly'), Icon: IconPointer },
		{ type: 'highlight', label: t('reader.pen.highlight'), Icon: IconHighlight },
		{ type: 'ai', label: t('reader.pen.aiPen'), Icon: IconAskHere },
	];
}

const CARD = 'rounded-xl border border-black/10 bg-popover shadow-lg';

export default function PenToolbar({
	tool,
	onToolChange,
	orientation = 'vertical',
	disabled,
	omit,
}: PenToolbarProps) {
	const t = useT();
	const TOOLS = tools(t);
	const horizontal = orientation === 'horizontal';

	// Pressing the active button releases it: the rack drops to 'none', which is
	// the traditional mode, not another tool.
	function pickTool(type: ToolType) {
		onToolChange({ type: type === tool.type ? 'none' : type, color: tool.color });
	}

	// Horizontal lives inside the header bar (the header is its surface); the
	// vertical variant is a free-floating card.
	const rack = horizontal
		? 'inline-flex flex-row items-center gap-0.5 p-0.5 select-none'
		: `inline-flex flex-col items-center gap-1 p-1.5 select-none ${CARD}`;
	const toolSize = (horizontal ? 'h-8 w-8' : 'h-9 w-9') + ' coarse:h-11 coarse:w-11';
	// One selected state for the whole rack: --secondary, the neutral fill this
	// app gives a control that is standing on. The AI pen keeps an accent of its
	// own in the resting state (--accent-line) rather than a second selected
	// colour.
	// `can-hover:hover:bg-secondary` is not a no-op: it holds the selected fill
	// against the ghost variant's hover fill, and has to repeat the modifier chain
	// exactly to replace it (docs/pitfall/78).
	// The navigation lock is a latch, not a tool, so its pressed state carries an
	// extra inset ring — it has to read as held down across a whole reading
	// session, not just as "most recently tapped".
	// A dim tool drops the accent and the ghost variant's hover fill — the
	// modifier chain has to repeat exactly to replace it (docs/pitfall/78). The
	// 40% is the Button's own disabled opacity.
	const toolBtn = (active: boolean, type: ToolType, off: boolean) =>
		`rounded-lg ${toolSize} ` +
		(off
			? 'text-neutral-700 can-hover:hover:bg-transparent'
			: active
				? 'bg-secondary text-secondary-foreground can-hover:hover:bg-secondary' +
					(type === 'navlock' ? ' ring-2 ring-inset ring-primary' : '')
				: type === 'ai'
					? 'text-accent-line'
					: 'text-neutral-700');

	return (
		<div
			className={rack}
			role="toolbar"
			aria-orientation={orientation}
			aria-label={t('reader.pen.toolsLabel')}
		>
			{TOOLS.filter(({ type }) => !omit?.includes(type)).map(({ type, label, Icon }) => {
				const why = disabled?.[type];
				return (
					<Button
						key={type}
						type="button"
						variant="ghost"
						// The rack sets its own square geometry, so no size variant: the
						// table's `icon` is 32px and these are 32 or 36 by orientation.
						size={null}
						className={toolBtn(tool.type === type, type, why !== undefined)}
						disabled={why !== undefined}
						title={why ?? label}
						aria-label={why === undefined ? label : t('reader.pen.disabledReason', { label, reason: why })}
						aria-pressed={tool.type === type}
						onClick={() => pickTool(type)}
					>
						<Icon size={20} />
					</Button>
				);
			})}
		</div>
	);
}
