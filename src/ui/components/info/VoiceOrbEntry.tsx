// The simulator harness's half of the companion (docs/pitfall/193): the same
// body the corner draws, with a call that has no audio under it, driven from
// `window.__orbStub`.
//
// The way into a real session is Lumen in the corner now, held rather than
// tapped (ui/components/lumen/LumenCorner.tsx, docs/68). What is left here is
// the stub layer the orb spike mounts, because the iOS simulator's audio stack
// cannot start at all and this is the only way to look at the four acts.
//
// Rendering and event binding only; the numbers are ui/components/lumen and
// ui/components/orb.

import { useCallback, useEffect, useRef, useState } from "react";

import { Lumen } from "../lumen/Lumen";
import type { Attention } from "../lumen/lumen-motion";
import { orbErrorLine, type OrbPhase, type SpeechEnvelope, type VoiceCallHandle } from "../orb/orb";
import { cn } from "../lib/utils";
import { OVERLAY_Z } from "../ui/overlay";

// The layer the harness mounts. Everything below it is the same code a real
// call runs.
export function StubOrbLayer() {
	const { handle, rest, attention } = useStubCall();
	return <OrbLayer call={handle} rest={rest} attention={attention} />;
}

// One box, in one place, whether or not a call is up. 72 px: at 56 the brows
// are a smudge and the flat mouth and the closed smile are the same picture,
// and past about 80 the corner stops being a corner.
function OrbLayer({
	call,
	rest = false,
	attention = "reader",
}: {
	call: VoiceCallHandle;
	rest?: boolean;
	attention?: Attention;
}) {
	const line = orbErrorLine(call.error);

	return (
		<div
			className={cn(
				"pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-end gap-2 pb-safe-6 pr-safe-4",
				OVERLAY_Z.floating,
			)}
		>
			{line && <ErrorLine line={line} />}
			<Lumen
				handle={call}
				rest={rest}
				attention={attention}
				className="pointer-events-auto h-18 w-18"
			/>
		</div>
	);
}

// What a call that died says. One line, and the orb behind it is back at rest —
// a broken call cannot be resumed, and a tap starts a new one (docs/33).
function ErrorLine({ line }: { line: string }) {
	return (
		<p
			role="status"
			className="pointer-events-none m-0 max-w-[16rem] rounded-lg border border-border-soft bg-popover px-3 py-1.5 text-[13px] leading-snug text-muted-foreground shadow-sm"
		>
			{line}
		</p>
	);
}

// A call with no audio behind it, for the simulator harness only. A tap opens
// and closes it, and in a dev build `window.__orbStub` drives the phase, the
// level and the error line — which is the only way to see the four states in the
// iOS simulator, where the audio stack cannot start at all (docs/pitfall/193).
// `import.meta.env.DEV` keeps the handle off a production build.
function useStubCall(): { handle: VoiceCallHandle; rest: boolean; attention: Attention } {
	const [phase, setPhase] = useState<OrbPhase>("idle");
	const [error, setError] = useState<string | null>(null);
	// Asleep is not a phase (src/ui/components/lumen/lumen-motion.ts) and nothing in the
	// app sets it yet, so the harness is the only thing that can show it.
	const [rest, setRest] = useState(false);
	// A live call gets this from its turns' tool calls (lumen/use-voice-call.ts); here
	// it is a knob, so the check act can be seen without a turn behind it.
	const [attention, setAttention] = useState<Attention>("reader");
	const subscribers = useRef(new Set<(value: number) => void>());
	const envelopes = useRef(new Set<(envelope: SpeechEnvelope | null) => void>());

	const subscribeLevel = useCallback((cb: (value: number) => void) => {
		subscribers.current.add(cb);
		return () => {
			subscribers.current.delete(cb);
		};
	}, []);

	const subscribeEnvelope = useCallback((cb: (envelope: SpeechEnvelope | null) => void) => {
		envelopes.current.add(cb);
		return () => {
			envelopes.current.delete(cb);
		};
	}, []);

	useEffect(() => {
		if (!import.meta.env.DEV) return;
		window.__orbStub = {
			phase: setPhase,
			error: setError,
			level: (value: number) => subscribers.current.forEach((cb) => cb(value)),
			// One synthetic sentence, starting now. What the device sends is the
			// same shape with a delay on it; a harness has no queue to wait out.
			envelope: (values: number[], windowMs = 25, startsInMs = 0) => {
				const event: SpeechEnvelope = {
					utterance: stubUtterance,
					sentence: stubSentence++,
					startsInMs,
					windowMs,
					values,
				};
				envelopes.current.forEach((cb) => cb(event));
			},
			rest: setRest,
			attention: setAttention,
		};
		return () => {
			delete window.__orbStub;
		};
	}, []);

	return {
		handle: {
			phase,
			start: () => setPhase("listening"),
			stop: () => {
				setPhase("idle");
				setError(null);
			},
			error,
			subscribeLevel,
			subscribeEnvelope,
		},
		rest,
		attention,
	};
}

// The harness's own sentence numbering. One turn for the life of the page: the
// queue is keyed by turn and sentence, and a second sentence with the same pair
// would replace the first instead of following it.
const stubUtterance = 1;
let stubSentence = 0;

declare global {
	interface Window {
		__orbStub?: {
			phase: (phase: OrbPhase) => void;
			error: (message: string | null) => void;
			level: (value: number) => void;
			envelope: (values: number[], windowMs?: number, startsInMs?: number) => void;
			rest: (asleep: boolean) => void;
			attention: (attention: Attention) => void;
		};
	}
}
