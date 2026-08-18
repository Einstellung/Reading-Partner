// The opening intents of an empty conversation (docs/03), as a row of chips.
// Pressing one sends its message down the ordinary send path, so the reader's
// pick lands in the thread as their own line. The wording and the sets live in
// reading/intents.ts; this only lays them out.
//
// It wraps, because the bubble is 360px wide and narrower on a phone: the chips
// sit two-across there and in one row wherever they fit.

import type { ReadingIntent } from '../../../reading/intents';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';

interface IntentChipsProps {
	intents: readonly ReadingIntent[];
	onPick(message: string): void;
	className?: string;
}

export default function IntentChips({ intents, onPick, className }: IntentChipsProps) {
	if (intents.length === 0) return null;
	return (
		<div className={cn('flex flex-wrap gap-1.5', className)}>
			{intents.map((intent) => (
				<Button
					key={intent.id}
					type="button"
					variant="subtle"
					size="chip"
					onClick={() => onPick(intent.message)}
					className="text-neutral-600"
				>
					{intent.label}
				</Button>
			))}
		</div>
	);
}
