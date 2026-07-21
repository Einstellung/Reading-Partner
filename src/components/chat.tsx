// Shared chat pieces for the call UI (CallBubble, CallView). Tailwind-only.
// No preflight in this project, so box-sizing and control resets are explicit.

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconCheck, IconCopy, IconSend, IconStop } from './icons';
import { Markdown } from './Markdown';
import { MicButton } from './MicButton';
import { useFlickerProbe } from './useFlickerProbe';
import type { ChatImage, PendingImage, ThreadMessage, ToolStatus } from './types';
import type { CleanupModel } from '../voice';
import type { ProviderId } from '../ai/providers';
import { loadSettings, toReasoning } from '../settings';

// Optional enrichment for the composer's built-in voice input. The mic is on by
// default; this only adds context. `glossary` seeds the STT cleanup pass with
// the current surface's proper names (book title + outline, article title) so
// mis-transcriptions of those terms get corrected. The cleanup model is derived
// from settings inside the composer, not passed here.
export interface ComposerVoice {
	glossary?: string;
}

// Resolve the `voice` prop into what the mic needs. The mic is enabled unless a
// caller explicitly opts out with `voice={false}`; anything else (omitted or an
// enrichment object) enables it, with an empty glossary as the default.
export function resolveComposerVoice(
	voice: ComposerVoice | false | undefined,
): { glossary: string } | null {
	if (voice === false) return null;
	return { glossary: voice?.glossary ?? '' };
}

// The cleanup model the composer's voice input runs on, derived from settings so
// any composer has working voice input without the caller wiring it. Null until
// settings load, and null when no default provider/model is configured (the mic
// then skips the polish pass and keeps the raw transcript).
function useDefaultCleanupModel(): CleanupModel | null {
	const [model, setModel] = useState<CleanupModel | null>(null);
	useEffect(() => {
		let alive = true;
		loadSettings()
			.then((s) => {
				if (!alive) return;
				setModel(
					s.defaultProviderId && s.defaultModelId
						? {
								providerId: s.defaultProviderId as ProviderId,
								modelId: s.defaultModelId,
								reasoning: toReasoning(s.chatThinking),
							}
						: null,
				);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	return model;
}

// The async clipboard API is unreliable in WebKitGTK (pitfall 16), so a failure
// falls back to the legacy execCommand path on an offscreen textarea.
async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.top = '-1000px';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		ta.remove();
		return ok;
	}
}

// Copy the reply's Markdown source. Hidden until the row is hovered or the
// button itself is focused; confirms for a moment, then returns.
function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(() => () => window.clearTimeout(timer.current ?? undefined), []);

	async function copy() {
		if (!(await copyText(text))) return;
		setCopied(true);
		window.clearTimeout(timer.current ?? undefined);
		timer.current = window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<button
			type="button"
			aria-label={copied ? 'Copied' : 'Copy'}
			onClick={copy}
			className="flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] leading-none text-neutral-400 opacity-0 transition-opacity hover:bg-black/5 hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100"
		>
			{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
			{copied && 'Copied'}
		</button>
	);
}

// Attached images, right-aligned above a user message. Constrained height so a
// tall screenshot doesn't blow out the column; no lightbox in v1 (docs:
// original-size, bounded).
function MessageImages({ images }: { images: ChatImage[] }) {
	return (
		<div className="flex flex-wrap justify-end gap-1.5">
			{images.map((img, i) => (
				<img
					key={i}
					src={`data:${img.mediaType};base64,${img.data}`}
					alt="attachment"
					className="max-h-52 max-w-full rounded-xl object-contain"
				/>
			))}
		</div>
	);
}

// The "thinking" state before the first streamed token arrives: three quiet
// pulsing dots where the reply will appear.
function TypingDots() {
	return (
		<div className="flex items-center gap-1 py-1 text-neutral-400" aria-label="Thinking">
			<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
			<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
			<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
		</div>
	);
}

// Tool-call trace above a streaming AI reply (M6): a running tool is a subdued
// line ending in an ellipsis; a failed one reuses the soft-error red.
function ToolTrace({ tools, size }: { tools: ToolStatus[]; size: 'sm' | 'lg' }) {
	const text = size === 'lg' ? 'text-sm' : 'text-xs';
	return (
		<div className="flex flex-col gap-0.5">
			{tools.map((t, i) =>
				t.state === 'error' ? (
					<div key={i} className={'text-red-600/90 ' + text}>
						{t.label} — failed
					</div>
				) : (
					<div key={i} className={'text-neutral-400 ' + text}>
						{t.label}…
					</div>
				),
			)}
		</div>
	);
}

// One message row, ChatGPT-style: the AI reply is plain body text set right on
// the background (no bubble), carried by the Markdown typography; the user's
// message is a compact light pill, right-aligned, with any images above it.
// Memoized so that while the AI reply streams (the last message's text grows on
// every delta), only that row re-parses its Markdown.
const MessageBubble = memo(function MessageBubble({
	role,
	text,
	images,
	streaming,
	failed,
	tools,
	size,
}: {
	role: ThreadMessage['role'];
	text: string;
	images?: ChatImage[];
	streaming?: boolean;
	failed?: boolean;
	tools?: ToolStatus[];
	size: 'sm' | 'lg';
}) {
	const lg = size === 'lg';
	// Dev-only diagnostic for the streaming gray-line glitch; no-op in prod and
	// when this row isn't a streaming AI reply. Ref is attached to the prose row.
	const rowRef = useRef<HTMLDivElement>(null);
	useFlickerProbe(rowRef, role, streaming);

	if (role === 'user') {
		const hasImages = !!images && images.length > 0;
		return (
			<div className="flex flex-col items-end gap-1.5">
				{hasImages && <MessageImages images={images!} />}
				{text && (
					<div
						className={
							'box-border max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-neutral-100 text-neutral-900 ' +
							(lg ? 'px-4 py-2.5 text-base leading-7' : 'px-3 py-1.5 text-[13px] leading-relaxed')
						}
					>
						{text}
					</div>
				)}
			</div>
		);
	}

	// AI: failed turns are a muted notice, not prose; an empty streaming reply
	// shows the thinking dots; otherwise the Markdown body fills the column.
	if (failed) {
		return (
			<div className={'text-red-600/90 ' + (lg ? 'text-[15px] leading-7' : 'text-[13px] leading-relaxed')}>
				{text}
			</div>
		);
	}
	const trace = tools && tools.length > 0 ? <ToolTrace tools={tools} size={size} /> : null;
	// While a tool runs with no reply text yet, the trace stands in for the dots.
	if (streaming && !text) {
		return trace ?? <TypingDots />;
	}
	if (!text) return trace;
	return (
		<div ref={rowRef} className="group flex flex-col gap-2">
			{trace}
			<div className={'text-neutral-800 ' + (lg ? 'text-base' : 'text-[13px]')}>
				<Markdown text={text} />
			</div>
			{!streaming && <CopyButton text={text} />}
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

	return (
		<div className={'flex flex-col ' + (size === 'lg' ? 'gap-6 ' : 'gap-3 ') + 'overflow-y-auto ' + className}>
			{messages.map((m, i) => (
				<MessageBubble
					key={i}
					role={m.role}
					text={m.text}
					images={m.images}
					streaming={m.streaming}
					failed={m.failed}
					tools={m.tools}
					size={size}
				/>
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
						<div className="flex h-full w-full items-center justify-center rounded-lg bg-black/[0.06]">
							<span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500" />
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
	streaming = false,
	onStop,
	voice,
}: {
	onSend(text: string): void;
	placeholder: string;
	pill?: boolean;
	pendingImages?: PendingImage[];
	onRemoveImage?(id: string): void;
	hint?: string;
	streaming?: boolean;
	onStop?(): void;
	// Voice input is on by default. Pass an enrichment object to add a glossary,
	// or `voice={false}` to explicitly opt a surface out of the mic.
	voice?: ComposerVoice | false;
}) {
	const [value, setValue] = useState('');
	const [voiceHint, setVoiceHint] = useState<string | null>(null);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const maxHeight = pill ? 160 : 100;
	const resolvedVoice = resolveComposerVoice(voice);
	const cleanupModel = useDefaultCleanupModel();

	// Drop a cleaned voice transcript into the composer for review (never
	// auto-sent), appended after any text the user already typed.
	function insertVoiceText(text: string) {
		setValue((v) => (v.trim() ? v.replace(/\s+$/, '') + ' ' + text : text));
		requestAnimationFrame(() => taRef.current?.focus());
	}

	// Auto-grow: collapse to one row, then take the content height up to the cap
	// (past it the textarea scrolls).
	useLayoutEffect(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
	}, [value, maxHeight]);

	const hasImages = pendingImages.length > 0;
	const hasLoading = pendingImages.some((p) => p.status === 'loading');
	const hasReady = pendingImages.some((p) => p.status === 'ready');
	const canSend = (!!value.trim() || hasReady) && !hasLoading;

	function send() {
		if (!canSend) return;
		onSend(value.trim());
		setValue('');
	}
	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		// An Enter that commits an IME composition must not send (keyCode 229 is
		// the pre-standard signal some engines still use).
		if (e.nativeEvent.isComposing || e.keyCode === 229) return;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	const cardSize = pill ? 96 : 72;
	const container = pill
		? 'box-border rounded-3xl border border-black/10 bg-white px-2 py-2 shadow-sm'
		: 'box-border rounded-xl border border-black/10 bg-white p-2 focus-within:border-blue-500';
	// box-border: the auto-grow sets height from scrollHeight, which includes the
	// padding. Hidden scrollbar: an appearing gutter would reflow the text mid-typing.
	const field =
		'box-border min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent outline-none placeholder:text-neutral-400 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
		(pill
			? 'py-1.5 text-[15px] leading-6 text-neutral-800'
			: 'px-1 py-1 text-[13px] leading-5 text-neutral-800');
	const stopBtn = 'flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-white';

	return (
		<div className="flex flex-col gap-2">
			<div className={container}>
				{hasImages && (
					<div className="mb-2 px-1">
						<StagingCards images={pendingImages} onRemove={onRemoveImage} size={cardSize} />
					</div>
				)}
				<div className={pill ? 'flex items-end gap-2 pl-3' : 'flex items-end gap-2'}>
					<textarea
						ref={taRef}
						rows={1}
						className={field}
						placeholder={placeholder}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={onKeyDown}
					/>
					{resolvedVoice && !streaming && (
						<MicButton
							onInsert={insertVoiceText}
							glossary={resolvedVoice.glossary}
							cleanupModel={cleanupModel}
							onHint={setVoiceHint}
							size={pill ? 'lg' : 'sm'}
						/>
					)}
					{pill &&
						(streaming ? (
							<button type="button" aria-label="Stop" onClick={onStop} className={`${stopBtn} h-9 w-9`}>
								<IconStop size={16} />
							</button>
						) : (
							<button
								type="button"
								aria-label="Send"
								onClick={send}
								disabled={!canSend}
								className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40"
							>
								<IconSend size={17} />
							</button>
						))}
					{!pill && streaming && (
						<button type="button" aria-label="Stop" onClick={onStop} className={`${stopBtn} mb-0.5 h-6 w-6`}>
							<IconStop size={12} />
						</button>
					)}
				</div>
			</div>
			{hint && <div className="px-1 text-[12px] leading-snug text-amber-600">{hint}</div>}
			{voiceHint && <div className="px-1 text-[12px] leading-snug text-amber-600">{voiceHint}</div>}
		</div>
	);
}
