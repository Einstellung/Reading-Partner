// The status line, centred at the top of a call (docs/09). It sits where the mode
// pills used to and is not a control: the focus is set by what the reader asks
// for, preparation by what the reader did, and the only thing to press here is
// the ✕ that drops the focus.
//
// Two things share the row because there is no second row to give them. The
// focus comes and goes with the conversation; preparation runs on the book and
// can be going before any chapter is in focus, so either one alone is enough to
// draw it. Renders nothing when neither has anything to say.

import { IconClose } from '../base/icons';
import { chapterFocusLabel, prepProgressLabel, type ChapterFocus } from './chapterFocus';
import { Button } from '../ui/button';

export interface ChapterFocusBarProps extends ChapterFocus {
	// Drop the focus. Absent = the line only states it.
	onClear?(): void;
	// How far this book's preparation has got. Passed only while a run is going;
	// absent = nothing is being prepared and the line says nothing about it.
	prep?: { done: number; total: number } | null;
}

export default function ChapterFocusBar({ onClear, prep, ...focus }: ChapterFocusBarProps) {
	const label = chapterFocusLabel(focus);
	const prepLabel = prepProgressLabel(prep);
	if (!label && !prepLabel) return null;
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
