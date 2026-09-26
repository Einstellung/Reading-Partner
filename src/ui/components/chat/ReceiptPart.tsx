// What a write left behind, under the words that announced it (docs/72).
//
// One line naming what was done and one saying what it was. Set between the
// reply and the grey trace: heavier than the trace, which is a list of calls,
// and lighter than the prose, which is the answer. The rule down its left is
// what makes a run of them read as a column of records rather than as more
// sentences.
//
// Only a link somewhere the app can already open is drawn as a link. A receipt
// pointing at an observation or at another thread has nowhere to take the reader
// from here, and a dead affordance is worse than none.

import { Button } from '../ui/button';
import type { Receipt } from '../../../ai/turn-view/tool-status';

/** The receipt's own type scale, between the trace's and the prose's. */
export function receiptText(size: 'sm' | 'lg'): string {
	return size === 'lg'
		? 'text-[calc(0.9375rem*var(--chat-scale,1))] leading-[1.6]'
		: 'text-[12.5px] leading-relaxed';
}

/** The frame both a receipt and a dispatch ticket sit in. */
export function ReceiptFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5 border-l-2 border-border pl-2.5">{children}</div>
	);
}

export function ReceiptPart({
	receipt,
	size,
	onOpen,
}: {
	receipt: Receipt;
	size: 'sm' | 'lg';
	// Where the receipt points, when the host can go there. Absent leaves the
	// summary as plain text.
	onOpen?: () => void;
}) {
	const text = receiptText(size);
	return (
		<ReceiptFrame>
			<div className={'font-medium text-neutral-600 ' + text}>{receipt.label}</div>
			{onOpen ? (
				<Button
					variant="link"
					size="link"
					onClick={onOpen}
					className={'self-start text-left font-normal text-neutral-500 underline underline-offset-2 ' + text}
				>
					{receipt.summary}
				</Button>
			) : (
				<div className={'text-neutral-500 ' + text}>{receipt.summary}</div>
			)}
		</ReceiptFrame>
	);
}
