// Shared chat pieces for the call UI (CallBubble, CallView). Tailwind-only.
// No preflight in this project, so box-sizing and control resets are explicit.

import { memo, useEffect, useRef, useState } from 'react';
import { IconSend } from './icons';
import { Markdown } from './Markdown';
import type { ChatImage, ThreadMessage } from './types';

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

// Presentational composer. Paste is handled globally by the host (a single
// document-level listener), so this only renders staged images + an optional
// hint and reports text sends.
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
	pendingImages?: ChatImage[];
	onRemoveImage?(index: number): void;
	hint?: string;
}) {
	const [value, setValue] = useState('');

	function send() {
		const text = value.trim();
		if (!text && pendingImages.length === 0) return;
		onSend(text);
		setValue('');
	}
	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	const canSend = !!value.trim() || pendingImages.length > 0;

	const previews = (pendingImages.length > 0 || hint) && (
		<div className="flex flex-col gap-1">
			{pendingImages.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{pendingImages.map((img, i) => (
						<div key={i} className="relative">
							<img
								src={`data:${img.mediaType};base64,${img.data}`}
								alt="attachment"
								className="h-14 w-14 rounded-md border border-black/10 object-cover dark:border-white/15"
							/>
							<button
								type="button"
								aria-label="Remove image"
								onClick={() => onRemoveImage?.(i)}
								className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-black/10 bg-white text-[11px] leading-none text-neutral-600 shadow dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-200"
							>
								✕
							</button>
						</div>
					))}
				</div>
			)}
			{hint && <div className="text-[12px] leading-snug text-amber-600 dark:text-amber-400">{hint}</div>}
		</div>
	);

	if (pill) {
		return (
			<div className="flex flex-col gap-2">
				{previews}
				<div className="box-border flex items-center gap-2 rounded-full border border-black/10 bg-white py-2 pl-5 pr-2 shadow-sm dark:border-white/15 dark:bg-neutral-800">
					<input
						className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
						placeholder={placeholder}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={onKeyDown}
					/>
					<button
						type="button"
						aria-label="Send"
						onClick={send}
						disabled={!canSend}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40"
					>
						<IconSend size={17} />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{previews}
			<input
				className="box-border w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-100"
				placeholder={placeholder}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={onKeyDown}
			/>
		</div>
	);
}
