// The chat composer for the call UI (CallBubble, CallView). Tailwind-only.
//
// The pill form sizes its field off `--chat-scale`, read as a variable with a
// default so nothing here imports the zoom; the small form is the corner bubble
// and does not zoom.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HIT_44 } from '../base/buttons';
import { Button } from '../ui/button';
import { IconKeyboard, IconMic, IconSend, IconStop } from '../base/icons';
import { MicButton } from './MicButton';
import { HoldToTalk } from './HoldToTalk';
import type { PendingImage } from './types';
import type { CleanupModel } from '../../../ai/voice';
import type { ProviderId } from '../../../ai/providers';
import { loadSettings, toReasoning, type DictationLocale } from '../../../platform/app/settings';
import { hasNativeRecorder, hasOnDeviceDictation } from '../../../platform/app/platform';

// Optional enrichment for the composer's built-in voice input. The mic is on by
// default; this only adds context. `glossary` seeds the STT cleanup pass with
// the current surface's proper names (book title + outline, article title) so
// mis-transcriptions of those terms get corrected. The cleanup model is derived
// from settings inside the composer, not passed here.
export interface ComposerVoice {
	glossary?: string;
}

// Resolve the `voice` prop against one host capability. The control is enabled
// unless a caller explicitly opts out with `voice={false}`, or the host cannot
// do it — on a phone the capture commands are not compiled in, so a mic there is
// a button whose only outcome is an error (see hasNativeRecorder).
//
// The composer asks this once for the recorder and once for on-device dictation.
// The two are exclusive in practice — a host either records for an STT round
// trip or dictates on device — but they are asked separately, so a host that
// grew both would show both rather than silently pick one.
export function resolveComposerVoice(
	voice: ComposerVoice | false | undefined,
	hostCan: boolean,
): { glossary: string } | null {
	if (voice === false || !hostCan) return null;
	return { glossary: voice?.glossary ?? '' };
}

// Which language the phone listens for, from settings (docs/15). Undefined until
// settings load; a hold that begins in that window falls back to the device's
// own preferred language for that one hold rather than blocking the press.
function useDictationLocale(): DictationLocale | undefined {
	const [locale, setLocale] = useState<DictationLocale | undefined>(undefined);
	useEffect(() => {
		let alive = true;
		loadSettings()
			.then((s) => {
				if (alive) setLocale(s.dictationLocale);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	return locale;
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

// Staged images inside the composer: a placeholder card with a spinner while the
// paste compresses, then the preview. Black round ✕ at the top-right removes one;
// the badge stays 20px and HIT_44 carries the touch target, so it does not cover
// the thumbnail it sits on. Already absolute, so no `relative`.
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
						className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] leading-none text-white shadow ${HIT_44}`}
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
	const resolvedVoice = resolveComposerVoice(voice, hasNativeRecorder());
	const dictation = resolveComposerVoice(voice, hasOnDeviceDictation());
	// Which half of the composer is showing on a host that dictates. Keyboard
	// first: the mode is a place the user goes, not one they land in.
	const [voiceMode, setVoiceMode] = useState(false);
	const cleanupModel = useDefaultCleanupModel();
	const dictationLocale = useDictationLocale();

	// Drop a cleaned voice transcript into the composer for review (never
	// auto-sent), appended after any text the user already typed.
	function insertVoiceText(text: string) {
		setValue((v) => (v.trim() ? v.replace(/\s+$/, '') + ' ' + text : text));
		requestAnimationFrame(() => taRef.current?.focus());
	}

	// A hold released over Edit: the same drop, plus the keyboard back, because
	// asking to edit is asking for the thing you edit with.
	function editVoiceText(text: string) {
		setVoiceMode(false);
		insertVoiceText(text);
	}

	// Auto-grow: collapse to one row, then take the content height up to the cap
	// (past it the textarea scrolls). The cap is a CSS max-height and is measured
	// rather than held here — it follows the chat zoom, which this component is
	// not allowed to know about.
	const grow = useCallback(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = 'auto';
		const cap = Number.parseFloat(getComputedStyle(el).maxHeight);
		el.style.height = `${Number.isFinite(cap) ? Math.min(el.scrollHeight, cap) : el.scrollHeight}px`;
	}, []);
	useLayoutEffect(grow, [value, grow]);

	// A zoom changes the cap without re-rendering this component (the scope's
	// children are the same elements), so the column's new width is the signal.
	// Width only: the height this sets is the observed box, and reacting to it
	// would be a loop.
	const lastWidth = useRef(0);
	useEffect(() => {
		const el = taRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? 0;
			if (width === lastWidth.current) return;
			lastWidth.current = width;
			grow();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [grow]);

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
		? 'box-border rounded-3xl border border-black/10 bg-background px-2 py-2 shadow-sm'
		: 'box-border rounded-xl border border-black/10 bg-background p-2 focus-within:border-accent-line';
	// box-border: the auto-grow sets height from scrollHeight, which includes the
	// padding. Hidden scrollbar: an appearing gutter would reflow the text mid-typing.
	// 16px floor: WKWebView zooms the whole page in when a field smaller than that
	// takes focus, and the reader needs pinch-zoom left on. The big composer keeps
	// the floor inside its own size instead of as a coarse-pointer override — that
	// override would outrank the scaled size and pin the field at 16px on a tablet.
	const field =
		'box-border min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent outline-none placeholder:text-neutral-400 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
		(pill
			? 'max-h-[calc(10rem*var(--chat-scale,1))] py-1.5 text-[max(16px,calc(1rem*var(--chat-scale,1)))] leading-[1.5] text-neutral-800'
			: 'max-h-[100px] px-1 py-1 text-[13px] leading-5 coarse:text-[16px] coarse:leading-6 text-neutral-800');
	// Not a variant: nothing else in the app is this ink, and the composer's Stop
	// has been this colour since before there was a variant table.
	const stopInk = 'shrink-0 bg-neutral-800 text-white can-hover:hover:bg-neutral-700';

	return (
		<div className="flex flex-col gap-2">
			<div className={container}>
				{hasImages && (
					<div className="mb-2 px-1">
						<StagingCards images={pendingImages} onRemove={onRemoveImage} size={cardSize} />
					</div>
				)}
				<div className={pill && !dictation ? 'flex items-end gap-2 pl-3' : 'flex items-end gap-2'}>
					{dictation && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={voiceMode ? 'Switch to keyboard' : 'Switch to voice'}
							onClick={() => setVoiceMode((on) => !on)}
							className="shrink-0 rounded-full text-neutral-400"
						>
							{voiceMode ? <IconKeyboard size={18} /> : <IconMic size={17} />}
						</Button>
					)}
					{dictation && voiceMode ? (
						<HoldToTalk
							onSend={onSend}
							onInsert={editVoiceText}
							onHint={setVoiceHint}
							glossary={dictation.glossary}
							locale={dictationLocale}
							disabled={streaming}
						/>
					) : (
						<textarea
							ref={taRef}
							rows={1}
							className={field}
							placeholder={placeholder}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							onKeyDown={onKeyDown}
						/>
					)}
					{resolvedVoice && !streaming && (
						<MicButton
							onInsert={insertVoiceText}
							glossary={resolvedVoice.glossary}
							cleanupModel={cleanupModel}
							onHint={setVoiceHint}
							size={pill ? 'lg' : 'sm'}
						/>
					)}
					{/* Both keys are up while the reply streams (docs/72): Stop cuts it
					    off, Send says the next thing into it without cutting anything
					    off. Neither stands in for the other, so neither replaces the
					    other on the row. */}
					{pill && !(voiceMode && !streaming) && (
						<>
							{streaming && (
								<Button variant="ghost" size="composer" aria-label="Stop" onClick={onStop} className={stopInk}>
									<IconStop size={16} />
								</Button>
							)}
							<Button size="composer" aria-label="Send" onClick={send} disabled={!canSend} className="shrink-0">
								<IconSend size={17} />
							</Button>
						</>
					)}
					{!pill && streaming && (
						<>
							<Button
								variant="ghost"
								size="composer-sm"
								aria-label="Stop"
								onClick={onStop}
								className={`${stopInk} mb-0.5`}
							>
								<IconStop size={12} />
							</Button>
							<Button
								size="composer-sm"
								aria-label="Send"
								onClick={send}
								disabled={!canSend}
								className="mb-0.5 shrink-0"
							>
								<IconSend size={12} />
							</Button>
						</>
					)}
				</div>
			</div>
			{hint && <div className="px-1 text-[12px] leading-snug text-amber-600">{hint}</div>}
			{voiceHint && <div className="px-1 text-[12px] leading-snug text-amber-600">{voiceHint}</div>}
		</div>
	);
}
