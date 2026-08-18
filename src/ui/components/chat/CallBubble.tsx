// CallBubble: the bubble state of a reading call (docs/03). Anchored beside the
// mark, it opens with a row of intent chips rather than an answer; the reader
// can pick one, type, expand, or click away to keep reading (close, not hang
// up). Closing at any time is safe, mid-answer included: the turn goes on
// writing into the thread. Tailwind-only.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReadingIntent } from '../../../reading/intents';
import { IconExpand } from '../base/icons';
import { Composer, MessageList, type ComposerVoice } from './chat';
import IntentChips from './IntentChips';
import type { CardActionHandler } from './chatParts';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import { OVERLAY_Z, useOverlaySafePadding } from '../ui/overlay';
import DeleteThreadButton from './DeleteThreadButton';
import { overlayLayerOpen } from '../base/overlay-layer';
import { fitPanelWidth, placePanel, pointAnchor } from '../common/panel-position';
import { useViewportSize } from '../common/useViewportSize';
import type { PendingImage, ThreadMessage } from './types';

interface CallBubbleProps {
	anchor: { x: number; y: number };
	messages: ThreadMessage[];
	onSend(text: string): void;
	onExpand(): void;
	onClose(): void;
	// Delete this conversation and its anchoring mark. Absent = no delete control.
	onDelete?(): void;
	pendingImages?: PendingImage[];
	onRemoveImage?(id: string): void;
	hint?: string;
	streaming?: boolean;
	onStop?(): void;
	voice?: ComposerVoice | false;
	// What a card in this conversation raises. The bubble carries cards too — a
	// diagram drawn in a classroom turn lands here when the reader never expanded
	// to chat-main — so it forwards the dispatcher the same way CallView does.
	onCardAction?: CardActionHandler;
	// What an empty conversation offers instead of an unprompted answer
	// (reading/intents.ts). Shown only while the thread has nothing in it.
	intents?: readonly ReadingIntent[];
}

const WIDTH = 360;
const GAP = 10;

export default function CallBubble({
	anchor,
	messages,
	onSend,
	onExpand,
	onClose,
	onDelete,
	pendingImages,
	onRemoveImage,
	hint,
	streaming,
	onStop,
	voice,
	onCardAction,
	intents,
}: CallBubbleProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	// The usable viewport, re-read when the keyboard opens and when the device
	// rotates; both the width and the placement follow it.
	const viewport = useViewportSize();
	// Smallest distance from the bubble to a viewport edge, per edge: the bubble is
	// `fixed`, so the shell's safe-area padding misses it (docs/pitfall/74). With
	// no inset every edge is the plain 8px gutter, as it was.
	const margin = useOverlaySafePadding();
	// The bubble's fixed width, shrunk on a phone narrower than WIDTH+margins so it
	// never spills past the viewport edge. Inert on desktop/iPad (WIDTH fits).
	const width = fitPanelWidth(WIDTH, viewport.width, margin);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { height } = el.getBoundingClientRect();
		setPos(
			placePanel({
				anchor: pointAnchor(anchor.x, anchor.y),
				panel: { width, height },
				viewport,
				gap: GAP,
				margin,
			}),
		);
	}, [anchor.x, anchor.y, messages.length, width, viewport, margin]);

	// A press outside closes the bubble. pointerdown, not mousedown, and capture:
	// docs/pitfall/67-webkit-tap-does-not-focus-a-button.md — on touch the mouse
	// events are compatibility events and the reader's taps on the top bar and the
	// sidebar never reached this.
	//
	// While an overlay layer is up, every press belongs to it. The bubble's own
	// delete confirmation is one of those layers, and it renders under <body>, so
	// containment would read the press on its Delete button as a press outside
	// and close the bubble out from under it (base/overlay-layer).
	useEffect(() => {
		function onDown(e: PointerEvent) {
			if (overlayLayerOpen()) return;
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		}
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	}, [onClose]);

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label="AI conversation"
			style={{ width, left: pos?.left, top: pos?.top, visibility: pos ? 'visible' : 'hidden' }}
			className={cn(
				'fixed box-border flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-3 shadow-[0_8px_40px_rgba(0,0,0,0.18)]',
				OVERLAY_Z.floating,
			)}
		>
			<div className="flex items-center justify-between">
				<span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Reading with AI</span>
				<div className="flex items-center gap-0.5">
					{onDelete && <DeleteThreadButton onDelete={onDelete} />}
					<Button
						type="button"
						variant="ghost"
						size={null}
						title="Expand"
						aria-label="Expand"
						onClick={onExpand}
						className="h-6 w-6 rounded-md text-neutral-500 coarse:h-11 coarse:w-11"
					>
						<IconExpand size={15} />
					</Button>
				</div>
			</div>

			{messages.length > 0 ? (
				<MessageList
					messages={messages}
					surface="bubble"
					className="max-h-64 pr-0.5"
					onCardAction={onCardAction}
				/>
			) : (
				intents && intents.length > 0 && <IntentChips intents={intents} onPick={onSend} />
			)}

			<Composer
				onSend={onSend}
				placeholder="Ask about this passage…"
				pendingImages={pendingImages}
				onRemoveImage={onRemoveImage}
				hint={hint}
				streaming={streaming}
				onStop={onStop}
				voice={voice}
			/>
		</div>
	);
}
