// Push-to-talk voice input (docs/15). Hold to record, release to transcribe and
// clean up; the polished text lands in the composer for review, not auto-sent.
// Recording runs in Rust (WebKitGTK's getUserMedia is unreliable on Linux); this
// component only drives the pointer gesture and the STT -> cleanup pipeline.
//
// Gesture: pointerdown starts, releasing anywhere stops. If the pointer leaves
// the button first, releasing cancels (a slide-off "never mind"); Escape cancels
// too. No pointer capture — a window pointerup catches releases outside the
// button, which keeps the leave/enter cancel gesture working.

import { useEffect, useRef, useState } from 'react';
import { IconMic } from './icons';
import {
	cancelRecording,
	chatCleanupRunner,
	cleanupTranscript,
	loadSttConfig,
	sttFetch,
	startRecording,
	stopRecording,
	transcribe,
	type CleanupModel,
	type SttConfig,
} from '../voice';

type Status = 'idle' | 'recording' | 'transcribing';

const NEEDS_KEY_HINT = 'Add a voice input STT key in Settings to use the mic.';

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

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
	const [status, setStatus] = useState<Status>('idle');
	const [elapsed, setElapsed] = useState(0);
	const [cancelArmed, setCancelArmed] = useState(false);

	const busyRef = useRef(false); // a press/pipeline is in flight
	const releasedRef = useRef(false); // pointer released (maybe mid-arming)
	const startedRef = useRef(false); // recording actually running
	const cancelArmedRef = useRef(false);
	const configRef = useRef<SttConfig | null>(null);
	const timerRef = useRef<number | null>(null);
	const startAtRef = useRef(0);

	const stopTimer = () => {
		if (timerRef.current !== null) {
			window.clearInterval(timerRef.current);
			timerRef.current = null;
		}
	};

	// Cancel a live recording if the component unmounts mid-press.
	useEffect(() => {
		return () => {
			stopTimer();
			if (startedRef.current) void cancelRecording().catch(() => {});
		};
	}, []);

	// While recording, a release anywhere or Escape ends the gesture.
	useEffect(() => {
		if (status !== 'recording') return;
		const onUp = () => {
			releasedRef.current = true;
			if (startedRef.current) void finish(cancelArmedRef.current);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				releasedRef.current = true;
				if (startedRef.current) void finish(true);
			}
		};
		window.addEventListener('pointerup', onUp);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('keydown', onKey);
		};
		// finish is stable enough for this gesture; deps intentionally minimal.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [status, glossary, cleanupModel]);

	async function begin() {
		const cfg = await loadSttConfig();
		// No key: point to Settings even on a quick tap (checked before the
		// released-early bail).
		if (!cfg) {
			busyRef.current = false;
			onHint(NEEDS_KEY_HINT);
			return;
		}
		if (releasedRef.current) {
			busyRef.current = false;
			return;
		}
		configRef.current = cfg;
		try {
			await startRecording();
		} catch (e) {
			busyRef.current = false;
			onHint(errMsg(e));
			return;
		}
		if (releasedRef.current) {
			// Released before recording got going: drop it.
			await cancelRecording().catch(() => {});
			busyRef.current = false;
			return;
		}
		startedRef.current = true;
		startAtRef.current = Date.now();
		setElapsed(0);
		setStatus('recording');
		timerRef.current = window.setInterval(() => setElapsed(Date.now() - startAtRef.current), 200);
	}

	async function finish(cancel: boolean) {
		if (!startedRef.current) return;
		startedRef.current = false;
		stopTimer();
		setCancelArmed(false);
		cancelArmedRef.current = false;
		if (cancel) {
			setStatus('idle');
			busyRef.current = false;
			await cancelRecording().catch(() => {});
			return;
		}
		setStatus('transcribing');
		try {
			const wav = await stopRecording();
			const raw = await transcribe(configRef.current!, wav, sttFetch);
			const polished = await cleanupTranscript(raw, glossary, cleanupModel, chatCleanupRunner);
			const text = polished.trim();
			if (text) onInsert(text);
			else onHint('No speech detected.');
			setStatus('idle');
		} catch (e) {
			onHint(errMsg(e));
			setStatus('idle');
		} finally {
			busyRef.current = false;
		}
	}

	function onPointerDown(e: React.PointerEvent) {
		if (disabled || busyRef.current) return;
		e.preventDefault(); // keep composer focus; don't start a text selection
		busyRef.current = true;
		releasedRef.current = false;
		startedRef.current = false;
		cancelArmedRef.current = false;
		setCancelArmed(false);
		onHint(null);
		void begin();
	}

	// During arming (before the window listener is live), a release here records
	// the intent so begin() can bail. Also arms cancel on leave / re-arms on enter.
	const onPointerUp = () => {
		releasedRef.current = true;
	};
	const onPointerLeave = () => {
		if (startedRef.current) {
			cancelArmedRef.current = true;
			setCancelArmed(true);
		}
	};
	const onPointerEnter = () => {
		if (startedRef.current) {
			cancelArmedRef.current = false;
			setCancelArmed(false);
		}
	};

	const dim = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7';
	const seconds = Math.floor(elapsed / 1000);

	const btnClass =
		'flex shrink-0 items-center justify-center rounded-full transition-colors ' +
		dim +
		' ' +
		(status === 'recording'
			? cancelArmed
				? 'bg-neutral-200 text-neutral-500'
				: 'bg-red-50 text-red-600'
			: 'text-neutral-400 hover:bg-black/5 hover:text-neutral-600 disabled:opacity-40');

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
				onPointerUp={onPointerUp}
				onPointerLeave={onPointerLeave}
				onPointerEnter={onPointerEnter}
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
