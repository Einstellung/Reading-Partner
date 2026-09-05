// The orb (docs/45): one shape, four states, no face and no character. It exists
// only while the info voice session does — tapped open on the briefing, gone when
// the call ends — so the animation is not something the reader has to be able to
// stop (WCAG 2.2.2 is about content that plays beside other content), and the
// reduced-motion answer is a still orb rather than no orb.
//
// Rendering and event binding only. Every number is orb.ts.
//
// The level never becomes React state. It arrives about ten times a second for
// as long as the call lasts; HoldToTalk re-renders on each one and gets away with
// it because a hold is three seconds long. Here one effect subscribes, writes the
// value to a ref, and a single rAF loop reads it and writes two CSS custom
// properties onto the element — no component in the tree re-renders between one
// phase change and the next.

import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import {
	INITIAL_HOLD,
	ORB_LABEL,
	SILENCE_HOLD_MS,
	clampLevel,
	holdPhase,
	orbVisual,
	smoothLevel,
	type OrbPhase,
	type VoiceCallHandle,
} from "./orb";

export function VoiceOrb({
	handle,
	// The orb's diameter, as the caller's own box classes. Everything inside is
	// a percentage of it, so the same component is the small button on the page
	// and the thing in the middle of the screen during a call.
	className,
}: {
	handle: VoiceCallHandle;
	className?: string;
}) {
	const phase = useHeldPhase(handle.phase);

	const orbRef = useRef<HTMLSpanElement>(null);
	// What the loop reads: the phase it is drawing, the level that arrived last,
	// and the smoothed level it left behind. Refs rather than state — the loop
	// outlives every render, and a restart that reset the smoothed value would
	// show as a dip in the middle of a sentence.
	const phaseRef = useRef<OrbPhase>(phase);
	phaseRef.current = phase;
	const targetRef = useRef(0);
	const levelRef = useRef(0);

	// Keyed on the subscribe function alone. `handle` is a new object on every
	// render — its phase field is part of it — so depending on the handle would
	// tear the subscription down and stand it up again on every render, which on
	// the native side is a listener churn nobody asked for.
	const subscribe = handle.subscribeLevel;

	useEffect(() => {
		const el = orbRef.current;
		if (!el) return;

		// Asked once, at the start of the call. The orb's whole life is one call;
		// a reader who changes this setting mid-call gets the answer on the next.
		const reduced =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const unsubscribe = subscribe((value) => {
			targetRef.current = clampLevel(value);
		});

		let frame = 0;
		let last = -1;
		let shown = phaseRef.current;
		let phaseAt = -1;

		const draw = (now: number) => {
			frame = requestAnimationFrame(draw);
			const dt = last < 0 ? 0 : now - last;
			last = now;
			if (phaseAt < 0 || phaseRef.current !== shown) {
				shown = phaseRef.current;
				phaseAt = now;
			}
			levelRef.current = smoothLevel(levelRef.current, targetRef.current, dt);
			const { scale, glow } = orbVisual(shown, levelRef.current, now - phaseAt, reduced);
			el.style.setProperty("--orb-scale", scale.toFixed(4));
			el.style.setProperty("--orb-glow", glow.toFixed(4));
		};
		frame = requestAnimationFrame(draw);

		return () => {
			unsubscribe();
			cancelAnimationFrame(frame);
		};
	}, [subscribe]);

	// One tap is the whole control surface: it opens the call and it ends it.
	// There is nothing else on the orb — no transcript, no mute, no progress.
	const idle = handle.phase === "idle";

	return (
		<Button
			type="button"
			variant="link"
			size={null}
			aria-label={ORB_LABEL[phase]}
			onClick={() => (idle ? handle.start() : handle.stop())}
			// No touch-target modifier: every size this is drawn at is well over
			// 44px, and the round shape is the target.
			className={cn("relative block shrink-0 rounded-full", className)}
		>
			{/* The two custom properties live here and are inherited by both
			    layers, so one style write per frame moves the whole orb. The
			    defaults are the idle resting shape: whatever the first frame
			    costs, nothing is ever painted unstyled. */}
			<span
				ref={orbRef}
				aria-hidden="true"
				// The element the loop writes to, named so the simulator bridge
				// can read the two properties back out of a running app
				// (scripts/ios-sim.sh eval).
				data-orb=""
				className="pointer-events-none absolute inset-0 block [--orb-glow:0.3] [--orb-scale:1]"
			>
				{/* The halo. Its opacity is the level's second reading: an orb that
				    only grew would say the same thing twice at half the strength. */}
				<span className="absolute inset-[-25%] rounded-full bg-primary/30 opacity-(--orb-glow) blur-2xl scale-(--orb-scale) motion-reduce:scale-100" />
				{/* The body. One colour for every phase (docs/45): the states are
				    told apart by how it moves, the way every shipped orb does it. */}
				<span className="absolute inset-0 rounded-full bg-primary shadow-md scale-(--orb-scale) motion-reduce:scale-100" />
			</span>
		</Button>
	);
}

// The phase the orb shows: the session's, except that it leaves `speaking` late
// (orb.ts). A phase change is a handful of events in a call and re-rendering on
// one is free; it is the level that must never take this path.
function useHeldPhase(source: OrbPhase): OrbPhase {
	const [held, setHeld] = useState(INITIAL_HOLD);

	useEffect(() => {
		const next = holdPhase(held, source, Date.now());
		if (next !== held) {
			setHeld(next);
			return;
		}
		// Nothing changed and a hold is running: come back when it is up. Without
		// this the orb would sit in `speaking` until the session says something
		// else, which after a last sentence it never does.
		if (next.leftAt === null) return;
		const wait = Math.max(0, SILENCE_HOLD_MS - (Date.now() - next.leftAt));
		const timer = window.setTimeout(
			() => setHeld((state) => holdPhase(state, source, Date.now())),
			wait,
		);
		return () => window.clearTimeout(timer);
	}, [held, source]);

	return held.shown;
}
