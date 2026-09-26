// The status line, centred at the top of a call (docs/09). It sits where the mode
// pills used to and is not a control: the focus is set by what the reader asks
// for, preparation by what the reader did, and the only thing to press here is
// the ✕ that drops the focus.
//
// Two things share the row because there is no second row to give them. The
// focus comes and goes with the conversation; preparation runs on the book and
// can be going before any chapter is in focus, so either one alone is enough to
// draw it. Renders nothing when neither has anything to say.

import { IconClose } from '../../base/icons';
import { chapterFocusLabel, prepProgressLabel, type ChapterFocus } from './chapterFocus';
import { Button } from '../../ui/button';

export interface ChapterFocusBarProps extends ChapterFocus {
	// Drop the focus. Absent = the line only states it.
	onClear?(): void;
	// How far this book's preparation has got. Passed only while a run is going;
	// absent = nothing is being prepared and the line says nothing about it.
	prep?: { done: number; total: number } | null;
	// A row of its own under a bar, rather than floating over the top of the
	// conversation. The phone's lesson has a bar across the top (docs/77), and
	// the floating line would sit on it.
	row?: boolean;
}

export default function ChapterFocusBar({ onClear, prep, row, ...focus }: ChapterFocusBarProps) {
	const label = chapterFocusLabel(focus);
	const prepLabel = prepProgressLabel(prep);
	if (!label && !prepLabel) return null;
	if (row) {
		return (
			<div className="flex min-h-9 flex-none items-center gap-1.5 border-b border-border-subtle pl-4 pr-1 text-xs text-muted-foreground">
				<span className="h-1.5 w-1.5 flex-none rounded-full bg-accent-line" />
				<span className="min-w-0 flex-1 truncate [font-variant-numeric:tabular-nums]">
					{label ? (prepLabel ? `${label} · ${prepLabel}` : label) : prepLabel}
				</span>
				{label && onClear && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						title="Clear chapter focus"
						aria-label="Clear chapter focus"
						onClick={onClear}
						className="flex-none text-neutral-400"
					>
						<IconClose size={14} />
					</Button>
				)}
			</div>
		);
	}
	return (
		<div className="absolute left-1/2 top-4 z-10 flex max-w-[70%] -translate-x-1/2 items-center gap-1">
			{label && <span className="truncate text-xs text-neutral-500">{label}</span>}
			{label && onClear && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					title="Clear chapter focus"
					aria-label="Clear chapter focus"
					onClick={onClear}
					className="rounded-full text-neutral-400"
				>
					<IconClose size={14} />
				</Button>
			)}
			{prepLabel && (
				<span className="flex-none whitespace-nowrap text-xs text-neutral-400">
					{label ? `· ${prepLabel}` : prepLabel}
				</span>
			)}
		</div>
	);
}
