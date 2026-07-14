// Shared chat pieces for the call UI (CallBubble, CallView). Tailwind-only.
// No preflight in this project, so box-sizing and control resets are explicit.

import { memo, useEffect, useRef, useState } from 'react';
import { IconSend } from './icons';
import { Markdown } from './Markdown';
import type { ChatImage, PendingImage, ThreadMessage } from './types';

// Thumbnails inside a message bubble. Constrained height so a tall screenshot
// doesn't blow out the column; no lightbox in v1 (docs: original-size, bounded).
function MessageImages({ images }: { images: ChatImage[] }) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{images.map((img, i) => (
				<img
					key={i}
					src={`data:${img.mediaType};base64,${img.data}`}
					alt="attachment"
					className="max-h-60 max-w-full rounded-lg object-contain"
				/>
			))}
		</div>
	);
}

// One message row. Memoized so that while the AI reply streams (the last
// message's text grows on every delta), only that row re-parses its Markdown —
// the earlier rows keep their rendered output.
const MessageBubble = memo(function MessageBubble({
	role,
	text,
	images,
	bubbleClass,
}: {
	role: ThreadMessage['role'];
	text: string;
	images?: ChatImage[];
	bubbleClass: string;
}) {
	const isUser = role === 'user';
	const hasImages = !!images && images.length > 0;
	return (
		<div className={'flex ' + (isUser ? 'justify-end' : 'justify-start')}>
			<div
				className={
					'box-border ' + bubbleClass + ' ' +
					(isUser
						? 'whitespace-pre-wrap bg-blue-600 text-white rounded-br-sm'
						: 'bg-black/[0.05] text-neutral-800 rounded-bl-sm dark:bg-white/10 dark:text-neutral-100')
				}
			>
				{hasImages && (
					<div className={text ? 'mb-1.5' : ''}>
						<MessageImages images={images!} />
					</div>
				)}
				{text && (isUser ? text : <Markdown text={text} />)}
			</div>
		</div>
	);
});

export function MessageList({
	messages,
	size = 'sm',
	className = '',
}: {
	messages: ThreadMessage[];
	size?: 'sm' | 'lg';
	className?: string;
}) {
	const endRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: 'end' });
	}, [messages.length]);

	const bubble =
		size === 'lg'
			? 'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed'
			: 'max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug';

	return (
		<div className={'flex flex-col ' + (size === 'lg' ? 'gap-3 ' : 'gap-2 ') + 'overflow-y-auto ' + className}>
			{messages.map((m, i) => (
				<MessageBubble key={i} role={m.role} text={m.text} images={m.images} bubbleClass={bubble} />
			))}
			<div ref={endRef} />
		</div>
	);
}

// Staged images inside the composer: a placeholder card with a spinner while the
// paste compresses, then the preview. Black round ✕ at the top-right removes one.
function StagingCards({ images, onRemove, size }: { images: PendingImage[]; onRemove?: (id: string) => void; size: number }) {
	return (
		<div className="flex flex-wrap gap-2">
			{images.map((img) => (
				<div key={img.id} className="relative shrink-0" style={{ width: size, height: size }}>
					{img.status === 'loading' ? (
						<div className="flex h-full w-full items-center justify-center rounded-lg bg-black/[0.06] dark:bg-white/10">
							<span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500 dark:border-neutral-600 dark:border-t-neutral-300" />
						</div>
					) : (
						<img
							src={`data:${img.mediaType};base64,${img.data}`}
							alt="attachment"
							className="h-full w-full rounded-lg object-cover"
						/>
					)}
					<button
						type="button"
						aria-label="Remove image"
						onClick={() => onRemove?.(img.id)}
						className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] leading-none text-white shadow"
					>
						✕
					</button>
				</div>
			))}
		</div>
	);
}

// Presentational composer. Paste is handled globally by the host (a single
// document-level listener), so this only renders the staged images (inside the
// input container) + an optional hint, and reports text sends.
export function Composer({
	onSend,
	placeholder,
	pill = false,
	pendingImages = [],
	onRemoveImage,
	hint,
}: {
	onSend(text: string): void;
	placeholder: string;
	pill?: boolean;
	pendingImages?: PendingImage[];
	onRemoveImage?(id: string): void;
	hint?: string;
}) {
	const [value, setValue] = useState('');

	const hasImages = pendingImages.length > 0;
	const hasLoading = pendingImages.some((p) => p.status === 'loading');
	const hasReady = pendingImages.some((p) => p.status === 'ready');
	const canSend = (!!value.trim() || hasReady) && !hasLoading;

	function send() {
		if (!canSend) return;
		onSend(value.trim());
		setValue('');
	}
	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	const cardSize = pill ? 96 : 72;
	const container = pill
		? 'box-border rounded-3xl border border-black/10 bg-white px-2 py-2 shadow-sm dark:border-white/15 dark:bg-neutral-800'
		: 'box-border rounded-xl border border-black/10 bg-white p-2 focus-within:border-blue-500 dark:border-white/15 dark:bg-neutral-800';

	return (
		<div className="flex flex-col gap-2">
			<div className={container}>
				{hasImages && (
					<div className="mb-2 px-1">
						<StagingCards images={pendingImages} onRemove={onRemoveImage} size={cardSize} />
					</div>
				)}
				<div className={pill ? 'flex items-center gap-2 pl-3' : 'flex items-center gap-2'}>
					<input
						className={
							'min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-neutral-400 ' +
							(pill ? 'text-[15px] text-neutral-800 dark:text-neutral-100' : 'px-1 text-[13px] text-neutral-800 dark:text-neutral-100')
						}
						placeholder={placeholder}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={onKeyDown}
					/>
					{pill && (
						<button
							type="button"
							aria-label="Send"
							onClick={send}
							disabled={!canSend}
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40"
						>
							<IconSend size={17} />
						</button>
					)}
				</div>
			</div>
			{hint && <div className="px-1 text-[12px] leading-snug text-amber-600 dark:text-amber-400">{hint}</div>}
		</div>
	);
}
