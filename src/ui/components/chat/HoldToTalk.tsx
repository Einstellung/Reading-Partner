// The composer in voice mode (docs/15): a bar the user holds to talk, with the
// landing zones floating above it. Only on a host that dictates on device —
// nothing is uploaded, so the transcript appears the moment the finger lifts.
//
// Deliberately no live text while the finger is down. A recognizer rewrites its
// own tail as it goes, and watching that happen turns speaking into proofreading;
// the zones say what will happen to the words, not what they are.
//
// The gesture, its states and its four races live in ai/voice/hold-machine.ts,
// the zone hit-test and the meter in hold-zones.ts. What is left here is pointer
// capture, the finishing timer and JSX. The overlay is a positioned child of the
// composer, not a portal: it belongs to the bar it sits on and moves with it.
//
// This component's lifetime is the voice mode, and the microphone's is the same.
// The native side keeps the audio stack standing between holds — that is what
// makes every press after the first one 300 ms instead of a second — and the
// orange indicator stays lit for as long as it does. Nothing but the unmount
// below puts it out.

import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { IconMic } from '../base/icons';
import {
	FINISH_TIMEOUT_MS,
	START_TIMEOUT_HINT,
	START_TIMEOUT_MS,
	INITIAL_HOLD_STATE,
	holdReducer,
	nativeDictation,
	releaseDictationMicrophone,
	type DictationSource,
	type HoldEffect,
	type HoldEvent,
	type HoldState,
	type Zone,
} from '../../../ai/voice';
import { METER_BARS, RELEASE_LABEL, barHeights, zoneAt, type Box } from './hold-zones';
import type { DictationLocale } from '../../../platform/app/settings';

export function HoldToTalk({
	onSend,
	onInsert,
	onHint,
	glossary,
	locale,
	disabled = false,
}: {
	// Send the finished transcript as a message, with no review step.
	onSend(text: string): void;
	// Put it in the composer instead and hand the keyboard back.
	onInsert(text: string): void;
	// One-line hint under the composer; null clears it.
	onHint(message: string | null): void;
	// Proper names to bias recognition towards (book title, outline).
	glossary?: string;
	// Which language to listen for. Absent lets the phone follow its own
	// preferred language, which is only right when the two agree — the reader
	// this was built for has an en-US phone and speaks Chinese to the AI, and
	// docs/33 measured that the wrong model does not degrade, it invents
	// (docs/pitfall/164).
	locale?: DictationLocale;
	disabled?: boolean;
}) {
	const [state, setState] = useState<HoldState>(INITIAL_HOLD_STATE);

	// The machine's state as the async steps and the window listeners see it, and
	// a dispatch the unmount cleanup can reach with today's callbacks.
	const stateRef = useRef(state);
	const dispatchRef = useRef<(event: HoldEvent) => void>(() => {});
	const sourceRef = useRef<DictationSource | null>(null);
	const cancelRef = useRef<Box | null>(null);
	const editRef = useRef<Box | null>(null);
	const cancelEl = useRef<HTMLDivElement>(null);
	const editEl = useRef<HTMLDivElement>(null);

	const dispatch = (event: HoldEvent) => {
		const { effects, ...next } = holdReducer(stateRef.current, event);
		stateRef.current = next;
		setState(next);
		for (const effect of effects) runEffect(effect);
	};
	dispatchRef.current = dispatch;

	function runEffect(effect: HoldEffect) {
		switch (effect.type) {
			case 'hint':
				onHint(effect.message);
				return;
			case 'send':
				onSend(effect.text);
				return;
			case 'insert':
				onInsert(effect.text);
				return;
			case 'start':
				void begin();
				return;
			case 'stop':
				void finish();
				return;
			case 'cancel':
				void sourceRef.current?.cancel().catch(() => {});
				sourceRef.current = null;
				return;
		}
	}

	async function begin() {
		const source = nativeDictation({
			locale,
			contextualStrings: glossary ? glossary.split('\n').filter(Boolean) : undefined,
		});
		if (!source) {
			dispatch({ type: 'failed', message: 'This device cannot dictate.' });
			return;
		}
		sourceRef.current = source;

		// Nothing bounds the native start, and its first-hold path downloads a
		// speech model (START_TIMEOUT_MS). The machine has no timer for `arming`,
		// so without this the bar says "Listening…" over a session that does not
		// exist and then refuses every press until the download finishes.
		let abandoned = false;
		const timer = window.setTimeout(() => {
			abandoned = true;
			dispatch({ type: 'failed', message: START_TIMEOUT_HINT });
		}, START_TIMEOUT_MS);

		try {
			await source.start((e) => dispatchRef.current({ type: 'event', event: e }));
		} catch (e) {
			window.clearTimeout(timer);
			// A start that failed after being abandoned has nothing to report: the
			// machine is back at idle and already told the user.
			if (abandoned) return;
			sourceRef.current = null;
			dispatch({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
			return;
		}
		window.clearTimeout(timer);

		if (abandoned) {
			// It came up after the machine stopped waiting. `started` would be
			// dropped in `idle`, so nothing else would ever release it — that is a
			// live microphone with no path to it but the native backstop.
			if (sourceRef.current === source) sourceRef.current = null;
			void source.cancel().catch(() => {});
			return;
		}
		dispatch({ type: 'started' });
	}

	async function finish() {
		const source = sourceRef.current;
		sourceRef.current = null;
		if (!source) {
			dispatch({ type: 'timeout' });
			return;
		}
		try {
			dispatch({ type: 'finished', text: await source.stop() });
		} catch (e) {
			dispatch({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
		}
	}

	// The flush is unbounded; past FINISH_TIMEOUT_MS the machine goes with the
	// text that streamed in and drops the late answer.
	useEffect(() => {
		if (state.status !== 'finishing') return;
		const timer = window.setTimeout(() => dispatchRef.current({ type: 'timeout' }), FINISH_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [state.status]);

	// The bar is going away: back to the keyboard, out of the chat, or the whole
	// composer with it. A live recognizer is cancelled first, then the microphone
	// itself goes — the native side was keeping it for a next hold that is not
	// coming, and the orange indicator over it has to go out now rather than
	// whenever something else happens to want the microphone.
	useEffect(
		() => () => {
			dispatchRef.current({ type: 'unmount' });
			void releaseDictationMicrophone();
		},
		[],
	);

	const holding = state.status === 'arming' || state.status === 'listening';

	// Zone boxes are measured once per hold: the overlay does not move while a
	// finger is on it, and measuring per pointermove would lay out the page on
	// every frame of the drag.
	useEffect(() => {
		if (!holding) {
			cancelRef.current = null;
			editRef.current = null;
			return;
		}
		cancelRef.current = cancelEl.current?.getBoundingClientRect() ?? null;
		editRef.current = editEl.current?.getBoundingClientRect() ?? null;
	}, [holding]);

	function onPointerDown(e: React.PointerEvent) {
		if (disabled || stateRef.current.status !== 'idle') return;
		// Keep the drag on this element after the finger leaves it, and keep the
		// press from starting a text selection or a scroll.
		e.preventDefault();
		e.currentTarget.setPointerCapture?.(e.pointerId);
		dispatch({ type: 'down' });
	}

	function onPointerMove(e: React.PointerEvent) {
		if (!holding) return;
		const zone = zoneAt(e.clientX, e.clientY, { cancel: cancelRef.current, edit: editRef.current });
		if (zone !== stateRef.current.zone) dispatch({ type: 'zone', zone });
	}

	const zone = state.zone;
	const bar =
		'w-full select-none touch-none rounded-xl text-[15px] font-medium ' +
		(holding ? 'bg-muted text-muted-foreground' : 'text-neutral-700');

	return (
		<div className="relative min-w-0 flex-1">
			{holding && <HoldOverlay zone={zone} level={state.level} cancelEl={cancelEl} editEl={editEl} />}
			<Button
				type="button"
				variant="outline"
				size="lg"
				disabled={disabled || state.status === 'finishing'}
				aria-label={holding ? 'Listening' : undefined}
				className={bar}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={() => dispatch({ type: 'up' })}
				onPointerCancel={() => dispatch({ type: 'up' })}
				onContextMenu={(e) => e.preventDefault()}
			>
				{state.status === 'finishing' ? (
					'Finishing…'
				) : holding ? (
					'Listening…'
				) : (
					<>
						<IconMic size={15} />
						Hold to Talk
					</>
				)}
			</Button>
		</div>
	);
}

// The layer that floats over the bar while the finger is down: the level meter,
// the two landing zones, and one line saying what letting go will do.
function HoldOverlay({
	zone,
	level,
	cancelEl,
	editEl,
}: {
	zone: Zone;
	level: number;
	cancelEl: React.RefObject<HTMLDivElement>;
	editEl: React.RefObject<HTMLDivElement>;
}) {
	const heights = barHeights(level, METER_BARS);
	return (
		<div className="pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-3 select-none">
			<div className="rounded-2xl border border-border bg-popover px-4 py-4 shadow-lg">
				<div className="flex items-end justify-between gap-3">
					<ZoneTarget boxRef={cancelEl} label="Cancel" active={zone === 'cancel'} tone="destructive" />
					<div className="flex h-12 flex-1 items-center justify-center gap-[3px]">
						{heights.map((h, i) => (
							<span
								key={i}
								className={
									'w-[3px] rounded-full transition-[height] duration-75 ' +
									(zone === 'cancel' ? 'bg-muted-foreground' : 'bg-primary')
								}
								style={{ height: `${Math.round(h * 40)}px` }}
							/>
						))}
					</div>
					<ZoneTarget boxRef={editEl} label="Edit" active={zone === 'edit'} tone="primary" />
				</div>
				<div className="mt-3 text-center text-[13px] text-muted-foreground">{RELEASE_LABEL[zone]}</div>
			</div>
		</div>
	);
}

// One landing zone. 56px across, over the 44px target, because it is hit by a
// thumb that is also holding the phone. `boxRef` and not `ref`: React 18 drops a
// ref handed to a plain function component and says nothing (docs/pitfall/95),
// and this one is what the hit-test measures.
const ZoneTarget = ({
	boxRef,
	label,
	active,
	tone,
}: {
	boxRef: React.RefObject<HTMLDivElement>;
	label: string;
	active: boolean;
	tone: 'destructive' | 'primary';
}) => (
	<div
		ref={boxRef}
		className={
			'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border text-[12px] transition-colors ' +
			(active
				? tone === 'destructive'
					? 'border-transparent bg-destructive text-destructive-foreground'
					: 'border-transparent bg-primary text-primary-foreground'
				: 'border-border bg-muted text-muted-foreground')
		}
	>
		{label}
	</div>
);
