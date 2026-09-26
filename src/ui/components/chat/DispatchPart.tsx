// A piece of work the soul handed off, as the thread records it (docs/72).
//
// The ticket is derived from this row's own trace and never moves; what changes
// is the run behind it, so the line under the title is read live off the runner
// the way the translation line is (reading/translate/watch.ts). Nothing is
// polled: the runner announces every write to a run and the watch re-reads then.
//
// Back means back in this conversation. A run's answer is delivered into the
// thread it was asked in, so when it has landed the ticket points down at it
// rather than opening anything.

import { useMemo, useSyncExternalStore } from 'react';
import { Button } from '../ui/button';
import { ReceiptFrame, receiptText } from './ReceiptPart';
import { dispatchView, dispatchWatch, type DispatchWatch } from './dispatch-view';
import { useDeliveredRuns } from './deliveredRuns';
import type { Receipt } from '../../../ai/turn-view/tool-status';

export function DispatchPart({
	runId,
	receipt,
	size,
	// The device's watch unless a test hands one in.
	watch = dispatchWatch(),
}: {
	runId: string;
	receipt: Receipt;
	size: 'sm' | 'lg';
	watch?: DispatchWatch;
}) {
	const snap = useSyncExternalStore(watch.subscribe, () => watch.snapshot(runId));
	const view = useMemo(() => dispatchView(receipt, snap), [receipt, snap]);
	const delivered = useDeliveredRuns();
	const text = receiptText(size);
	const back = view.state === 'done' && !!delivered?.has(runId);
	return (
		<ReceiptFrame>
			<div className={'font-medium text-neutral-600 ' + text}>
				{view.title}
				{view.state === 'running' && <span className="text-neutral-400"> — still out</span>}
				{view.state === 'failed' && (
					<span className="text-destructive"> — needs your decision</span>
				)}
			</div>
			<div className={(view.state === 'failed' ? 'text-destructive ' : 'text-neutral-500 ') + text}>
				{view.line}
			</div>
			{back && (
				<Button
					variant="link"
					size="link"
					onClick={() => delivered?.scrollTo(runId)}
					className={'self-start font-normal text-neutral-500 underline underline-offset-2 ' + text}
				>
					Back — see below
				</Button>
			)}
		</ReceiptFrame>
	);
}
