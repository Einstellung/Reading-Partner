// The way into the info voice session (docs/33, docs/66): Lumen resting in the
// corner of the briefing, tapped to start talking. There is no other screen, no
// transcript panel and no controls, because the conversation is the interface.
//
// Rendering and event binding only; the numbers are ui/components/lumen and
// ui/components/orb.
//
// Placement. Bottom right, out of the way of the briefing's own sticky header
// and its Ask button, and it stays there: one size for the whole call. The box
// used to grow to 160 px and re-centre itself when a call opened, which meant
// every call began by throwing a body across the screen and covering the thing
// being talked about. The four acts are legible at 72 px (docs/66), so the
// corner is enough. The layer wraps the whole viewport but takes no presses of
// its own, so the briefing underneath stays scrollable and tappable.

import { useCallback, useEffect, useRef, useState } from "react";

import { hasNativeSpeech } from "../../../platform/app/platform";
import { Lumen } from "../lumen/Lumen";
import type { Attention } from "../lumen/lumen-motion";
import { orbErrorLine, type OrbPhase, type VoiceCallHandle } from "../orb/orb";
import { cn } from "../lib/utils";
import { OVERLAY_Z } from "../ui/overlay";
import { useVoiceCall, type VoiceCallView } from "./use-voice-call";
import type { Briefing } from "../../../info/boxes/types";

// `briefing` is the day's briefing as this page holds it, passed down rather
// than loaded by the call: see LiveVoiceCallOptions.
export function VoiceOrbEntry({
	dateKey,
	briefing,
	stub = false,
}: {
	dateKey: string;
	briefing: Briefing | null;
	stub?: boolean;
}) {
	// A host that cannot speak has nothing to enter: the whole audio path is the
	// iOS plugin's (docs/33), and on the desktop this draws nothing at all.
	// Constant for the life of the process, so the early return never changes
	// which hooks run below it.
	if (!hasNativeSpeech()) return null;
	// The stub is the simulator harness's: no audio stack can start there
	// (docs/pitfall/193), so the four states are driven from `window.__orbStub`.
	if (stub) return <StubOrbLayer />;
	return <VoiceOrbLayer dateKey={dateKey} briefing={briefing} />;
}

function VoiceOrbLayer({ dateKey, briefing }: { dateKey: string; briefing: Briefing | null }) {
	const call = useVoiceCall({ dateKey, briefing });
	// No attention here yet. The session reports four phases and nothing about
	// what the soul is doing inside a turn, so a live call never reaches the
	// check act — thinking always looks up. It arrives with SoulIntent
	// (docs/66); until then the harness is the only thing that can drive it.
	return <OrbLayer call={asHandle(call)} />;
}

// Exported for the dev harness (orb-spike-harness.tsx), which has no native
// speech behind it and so never gets past the gate above. Everything below it
// is the same code the real entry runs.
export function StubOrbLayer() {
	const { handle, rest, attention } = useStubCall();
	return <OrbLayer call={handle} rest={rest} attention={attention} />;
}

// The orb reads an error as a key into its own lines (interrupted, lost) or as
// a sentence to show as-is; the call reports a reason and a sentence, so the
// reason goes first where the orb has a line for it.
function asHandle(call: VoiceCallView): VoiceCallHandle {
	const error = call.error
		? call.error.reason === "interrupted" || call.error.reason === "lost"
			? call.error.reason
			: call.error.message
		: null;
	return { phase: call.phase, start: call.start, stop: call.stop, error, subscribeLevel: call.subscribeLevel };
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
	// Nothing in a live call sets this yet either, so the check act exists only
	// where the harness forces it.
	const [attention, setAttention] = useState<Attention>("reader");
	const subscribers = useRef(new Set<(value: number) => void>());

	const subscribeLevel = useCallback((cb: (value: number) => void) => {
		subscribers.current.add(cb);
		return () => {
			subscribers.current.delete(cb);
		};
	}, []);

	useEffect(() => {
		if (!import.meta.env.DEV) return;
		window.__orbStub = {
			phase: setPhase,
			error: setError,
			level: (value: number) => subscribers.current.forEach((cb) => cb(value)),
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
		},
		rest,
		attention,
	};
}

declare global {
	interface Window {
		__orbStub?: {
			phase: (phase: OrbPhase) => void;
			error: (message: string | null) => void;
			level: (value: number) => void;
			rest: (asleep: boolean) => void;
			attention: (attention: Attention) => void;
		};
	}
}
