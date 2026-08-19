// The chapter-focus status line, centred at the top of a call (docs/09). It sits
// where the mode pills used to and is not a control: the focus is set by what the
// reader asks for, and the only thing to press here is the ✕ that drops it.
// Renders nothing when there is no focus.

import { IconClose } from '../base/icons';
import { chapterFocusLabel, type ChapterFocus } from './chapterFocus';
import { Button } from '../ui/button';

export interface ChapterFocusBarProps extends ChapterFocus {
	// Drop the focus. Absent = the line only states it.
	onClear?(): void;
}

export default function ChapterFocusBar({ onClear, ...focus }: ChapterFocusBarProps) {
	const label = chapterFocusLabel(focus);
	if (!label) return null;
	return (
		<div className="absolute left-1/2 top-4 z-10 flex max-w-[70%] -translate-x-1/2 items-center gap-1">
			<span className="truncate text-xs text-neutral-500">{label}</span>
			{onClear && (
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
		</div>
	);
}
