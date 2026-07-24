// CallBubble: the bubble state of a reading call (docs/03). Anchored beside the
// mark, the AI starts answering; the reader can follow up, expand, or click away
// to keep reading (close, not hang up). Tailwind-only.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconExpand } from '../common/icons';
import { Composer, MessageList, type ComposerVoice } from './chat';
import DeleteThreadButton from './DeleteThreadButton';
import { useKeyboardInset } from '../common/useKeyboardInset';
import type { PendingImage, ThreadMessage } from '../common/types';

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
}

const WIDTH = 360;
const GAP = 10;
const MARGIN = 8;

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
}: CallBubbleProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	// Re-clamp above the soft keyboard when it opens/closes (iPad).
	const keyboardInset = useKeyboardInset();
	// The bubble's fixed width, shrunk on a phone narrower than WIDTH+margins so it
	// never spills past the viewport edge. Inert on desktop/iPad (WIDTH fits).
	const [width, setWidth] = useState(WIDTH);

	useLayoutEffect(() => {
		const vw = window.innerWidth;
		setWidth(Math.min(WIDTH, vw - 2 * MARGIN));
	}, []);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { height } = el.getBoundingClientRect();
		const vw = window.innerWidth;
		// The visual viewport height already excludes the keyboard; fall back to the
		// layout height where the API is unavailable (desktop).
		const vh = window.visualViewport?.height ?? window.innerHeight;

		let left = anchor.x - width / 2;
		left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));

		let top = anchor.y + GAP;
		if (top + height > vh - MARGIN) {
			const above = anchor.y - GAP - height;
			top = above >= MARGIN ? above : Math.max(MARGIN, vh - height - MARGIN);
		}
		setPos({ left, top });
	}, [anchor.x, anchor.y, messages.length, keyboardInset, width]);

	useEffect(() => {
		function onDown(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		}
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [onClose]);

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label="AI conversation"
			style={{ width, left: pos?.left, top: pos?.top, visibility: pos ? 'visible' : 'hidden' }}
			className="fixed z-[1000] box-border flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-3 shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
		>
			<div className="flex items-center justify-between">
				<span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Reading with AI</span>
				<div className="flex items-center gap-0.5">
					{onDelete && <DeleteThreadButton onDelete={onDelete} />}
					<button
						type="button"
						title="Expand"
						aria-label="Expand"
						onClick={onExpand}
						className="flex h-6 w-6 coarse:h-11 coarse:w-11 items-center justify-center rounded-md text-neutral-500 hover:bg-black/5"
					>
						<IconExpand size={15} />
					</button>
				</div>
			</div>

			{messages.length > 0 && <MessageList messages={messages} surface="bubble" className="max-h-64 pr-0.5" />}

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
