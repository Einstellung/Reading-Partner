// CallBubble: the bubble state of a reading call (docs/03). Anchored beside the
// mark, the AI starts answering; the reader can follow up, expand, or click away
// to keep reading (close, not hang up). Tailwind-only.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconExpand } from './icons';
import { Composer, MessageList } from './chat';
import type { ChatImage, ThreadMessage } from './types';

interface CallBubbleProps {
	anchor: { x: number; y: number };
	messages: ThreadMessage[];
	onSend(text: string): void;
	onExpand(): void;
	onClose(): void;
	pendingImages?: ChatImage[];
	onRemoveImage?(index: number): void;
	hint?: string;
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
	pendingImages,
	onRemoveImage,
	hint,
}: CallBubbleProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left = anchor.x - width / 2;
		left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));

		let top = anchor.y + GAP;
		if (top + height > vh - MARGIN) {
			const above = anchor.y - GAP - height;
			top = above >= MARGIN ? above : Math.max(MARGIN, vh - height - MARGIN);
		}
		setPos({ left, top });
	}, [anchor.x, anchor.y, messages.length]);

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
			style={{ width: WIDTH, left: pos?.left, top: pos?.top, visibility: pos ? 'visible' : 'hidden' }}
			className="fixed z-[1000] box-border flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-3 shadow-[0_8px_40px_rgba(0,0,0,0.18)] dark:border-white/15 dark:bg-neutral-900"
		>
			<div className="flex items-center justify-between">
				<span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Reading with AI</span>
				<button
					type="button"
					title="Expand"
					aria-label="Expand"
					onClick={onExpand}
					className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10"
				>
					<IconExpand size={15} />
				</button>
			</div>

			{messages.length > 0 && <MessageList messages={messages} className="max-h-64 pr-0.5" />}

			<Composer
				onSend={onSend}
				placeholder="Ask about this passage…"
				pendingImages={pendingImages}
				onRemoveImage={onRemoveImage}
				hint={hint}
			/>
		</div>
	);
}
