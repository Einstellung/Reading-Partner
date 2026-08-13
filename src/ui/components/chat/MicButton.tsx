// Push-to-talk voice input (docs/15). Hold to record, release to transcribe and
// clean up; the polished text lands in the composer for review, not auto-sent.
// Recording runs in Rust (WebKitGTK's getUserMedia is unreliable on Linux); this
// component only drives the pointer gesture and the STT -> cleanup pipeline.
//
// Gesture: pointerdown starts, releasing anywhere stops. If the pointer leaves
// the button first, releasing cancels (a slide-off "never mind"); Escape cancels
// too. No pointer capture — a window pointerup catches releases outside the
// button, which keeps the leave/enter cancel gesture working.
//
// The gesture's states and its four races live in ai/voice/press-machine.ts;
// what is left here is pointer binding, the elapsed timer and JSX.

import { useEffect, useRef, useState } from 'react';
import { IconMic } from '../common/icons';
import {
	INITIAL_PRESS_STATE,
	beginPress,
	cancelRecording,
	chatCleanupRunner,
	cleanupTranscript,
	errMsg,
	loadSttConfig,
	pressReducer,
	sttFetch,
	startRecording,
	stopRecording,
	transcribe,
	type CleanupModel,
	type PressEffect,
	type PressEvent,
	type PressState,
	type SttConfig,
} from '../../../ai/voice';

export function MicButton({
	onInsert,
	glossary,
	cleanupModel,
	onHint,
	size = 'lg',
	disabled = false,
}: {
	onInsert(text: string): void;
	glossary: string;
	cleanupModel: CleanupModel | null;
	// Surface a one-line hint/error to the composer (amber row); null clears it.
	onHint(message: string | null): void;
	size?: 'sm' | 'lg';
	disabled?: boolean;
}) {
	const [state, setState] = useState<PressState>(INITIAL_PRESS_STATE);
	const [elapsed, setElapsed] = useState(0);

	// The machine's state as the async steps see it, and a dispatch the window
	// listeners and the unmount cleanup can reach with today's callbacks.
	const stateRef = useRef(state);
	const dispatchRef = useRef<(event: PressEvent) => void>(() => {});
	const configRef = useRef<SttConfig | null>(null);

	const dispatch = (event: PressEvent) => {
		const { effects, ...next } = pressReducer(stateRef.current, event);
		stateRef.current = next;
		setState(next);
		for (const effect of effects) runEffect(effect);
	};
	dispatchRef.current = dispatch;

	function runEffect(effect: PressEffect) {
		switch (effect.type) {
			case 'hint':
				onHint(effect.message);
				return;
			case 'insert':
				onInsert(effect.text);
				return;
			case 'cancel':
				void cancelRecording().catch(() => {});
				return;
			case 'begin':
				void arm();
				return;
			case 'transcribe':
				void collect();
				return;
		}
	}

	async function arm() {
		const outcome = await beginPress<SttConfig>({
			loadConfig: loadSttConfig,
			aborted: () => stateRef.current.status === 'aborting',
			startRecording,
		});
		if (outcome.type === 'failed') {
			dispatch(outcome);
			return;
		}
		configRef.current = outcome.config;
		dispatch({ type: 'started' });
	}

	async function collect() {
		try {
			const wav = await stopRecording();
			const raw = await transcribe(configRef.current!, wav, sttFetch);
			const polished = await cleanupTranscript(raw, glossary, cleanupModel, chatCleanupRunner);
			dispatch({ type: 'transcribed', text: polished });
		} catch (e) {
			dispatch({ type: 'failed', message: errMsg(e) });
		}
	}

	// Cancel a live recording if the component unmounts mid-press.
	useEffect(() => () => dispatchRef.current({ type: 'unmount' }), []);

	// While recording, a release anywhere or Escape ends the gesture.
	useEffect(() => {
		if (state.status !== 'recording') return;
		const onUp = () => dispatchRef.current({ type: 'up' });
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') dispatchRef.current({ type: 'escape' });
		};
		window.addEventListener('pointerup', onUp);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('keydown', onKey);
		};
	}, [state.status]);

	// Elapsed seconds, restarted by each recording.
	useEffect(() => {
		if (state.status !== 'recording') return;
		const startedAt = Date.now();
		setElapsed(0);
		const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 200);
		return () => window.clearInterval(timer);
	}, [state.status]);

	function onPointerDown(e: React.PointerEvent) {
		if (disabled || stateRef.current.status !== 'idle') return;
		e.preventDefault(); // keep composer focus; don't start a text selection
		dispatch({ type: 'down' });
	}

	const { status, cancelArmed } = state;
	const dim = (size === 'lg' ? 'h-9 w-9' : 'h-7 w-7') + ' coarse:h-11 coarse:w-11';
	const seconds = Math.floor(elapsed / 1000);

	const btnClass =
		'flex shrink-0 items-center justify-center rounded-full transition-colors ' +
		dim +
		' ' +
		(status === 'recording'
			? cancelArmed
				? 'bg-neutral-200 text-neutral-500'
				: 'bg-red-50 text-red-600'
			: 'text-neutral-400 can-hover:hover:bg-accent can-hover:hover:text-neutral-600 disabled:opacity-40');

	return (
		<>
			{status === 'recording' && (
				<span
					className={
						'shrink-0 select-none text-xs tabular-nums ' +
						(cancelArmed ? 'text-neutral-400' : 'text-red-600')
					}
				>
					{cancelArmed ? 'Release to cancel' : `${seconds}s`}
				</span>
			)}
			{status === 'transcribing' && (
				<span className="shrink-0 select-none text-xs text-neutral-400">Transcribing…</span>
			)}
			<button
				type="button"
				aria-label={status === 'recording' ? 'Recording — release to send' : 'Hold to talk'}
				title="Hold to talk"
				disabled={disabled || status === 'transcribing'}
				onPointerDown={onPointerDown}
				onPointerUp={() => dispatch({ type: 'up' })}
				onPointerLeave={() => dispatch({ type: 'leave' })}
				onPointerEnter={() => dispatch({ type: 'enter' })}
				onContextMenu={(e) => e.preventDefault()}
				className={btnClass}
			>
				{status === 'recording' ? (
					<span
						className={
							'block rounded-full ' +
							(size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2') +
							(cancelArmed ? ' bg-neutral-400' : ' animate-pulse bg-red-500')
						}
					/>
				) : status === 'transcribing' ? (
					<span
						className={
							'animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500 ' +
							(size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5')
						}
					/>
				) : (
					<IconMic size={size === 'lg' ? 17 : 15} />
				)}
			</button>
		</>
	);
}
