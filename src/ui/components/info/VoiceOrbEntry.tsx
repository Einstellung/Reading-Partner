// The way into the info voice session (docs/33, docs/45): a small orb resting in
// the corner of the briefing, tapped to start talking. It grows to the call and
// shrinks back when the call ends — there is no other screen, no transcript
// panel and no controls, because the conversation is the interface.
//
// Rendering and event binding only; the orb's own numbers are ui/components/orb.
//
// Placement. Bottom right at rest and out of the way of the briefing's own
// sticky header and its Ask button; centred during a call on a tablet or a
// desktop, and in the lower third on a phone, where the middle of the screen is
// the middle of nothing and the bottom is where the hand is. The layer wraps the
// whole viewport but takes no presses of its own, so the briefing underneath
// stays scrollable and tappable while a call is up.

import { useCallback, useEffect, useRef, useState } from "react";

import { hasNativeSpeech } from "../../../platform/app/platform";
import { VoiceOrb } from "../orb/VoiceOrb";
import { orbErrorLine, type OrbPhase, type VoiceCallHandle } from "../orb/orb";
import { cn } from "../lib/utils";
import { OVERLAY_Z } from "../ui/overlay";
import { useVoiceCall, type VoiceCallView } from "./use-voice-call";

export function VoiceOrbEntry({ dateKey, stub = false }: { dateKey: string; stub?: boolean }) {
	// A host that cannot speak has nothing to enter: the whole audio path is the
	// iOS plugin's (docs/33), and on the desktop this draws nothing at all.
	// Constant for the life of the process, so the early return never changes
	// which hooks run below it.
	if (!hasNativeSpeech()) return null;
	// The stub is the simulator harness's: no audio stack can start there
	// (docs/pitfall/193), so the four states are driven from `window.__orbStub`.
	if (stub) return <StubOrbLayer />;
	return <VoiceOrbLayer dateKey={dateKey} />;
}

function VoiceOrbLayer({ dateKey }: { dateKey: string }) {
	const call = useVoiceCall({ dateKey });
	return <OrbLayer call={asHandle(call)} />;
}

function StubOrbLayer() {
	return <OrbLayer call={useStubCall()} />;
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

function OrbLayer({ call }: { call: VoiceCallHandle }) {
	const line = orbErrorLine(call.error);
	const calling = call.phase !== "idle";

	if (!calling) {
		return (
			<div
				className={cn(
					"pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-end gap-2 pb-safe-6 pr-safe-4",
					OVERLAY_Z.floating,
				)}
			>
				{line && <ErrorLine line={line} />}
				<VoiceOrb handle={call} className="pointer-events-auto h-14 w-14" />
			</div>
		);
	}

	return (
		<div
			className={cn(
				"pointer-events-none fixed inset-0 flex flex-col items-center justify-end gap-5 pb-[22vh] sm:justify-center sm:pb-0",
				OVERLAY_Z.floating,
			)}
		>
			<VoiceOrb handle={call} className="pointer-events-auto h-40 w-40" />
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
function useStubCall(): VoiceCallHandle {
	const [phase, setPhase] = useState<OrbPhase>("idle");
	const [error, setError] = useState<string | null>(null);
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
		};
		return () => {
			delete window.__orbStub;
		};
	}, []);

	return {
		phase,
		start: () => setPhase("listening"),
		stop: () => {
			setPhase("idle");
			setError(null);
		},
		error,
		subscribeLevel,
	};
}

declare global {
	interface Window {
		__orbStub?: {
			phase: (phase: OrbPhase) => void;
			error: (message: string | null) => void;
			level: (value: number) => void;
		};
	}
}
