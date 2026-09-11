// Lumen (docs/45): the companion with a body. A chubby round thing made of
// translucent blue-white light, a flame-shaped tuft curling off the top, two
// glossy deep-blue eyes and a closed-mouth smile, resting on the desk in a pool
// of its own light.
//
// Rendering and event binding only. Every number is lumen-motion.ts, and the
// smoothing and the hold are still orb.ts — this replaces the drawn disc, not
// the arithmetic behind it.
//
// It performs four acts rather than animating four states: listen (watch you),
// think (look up), check (glance down at the desk and scan it) and speak (look
// back and talk). The act is the phase crossed with where the attention is, the
// eye direction and the three mouth shapes carry it, and one act dissolves into
// the next over ACT_EASE_MS. Nothing grows: the body is one size in one corner
// for the whole call.
//
// Four layers, back to front: the pool on the desk, the halo, the body raster
// with its tuft cut into a second raster, and the face as inline SVG. The face
// is SVG and not paint because a blink, a glance and a pair of shut eyes are
// three transforms on a path and three more pictures otherwise; the master was
// generated with the face left blank for exactly that reason.
//
// The tuft is the same generated image as the body, split across the stem's
// narrowest waist with a feather that composites back to the original alpha.
// It only ever rotates and scales about a pivot inside that band, where the two
// layers barely move relative to each other, so the seam never opens.
//
// One rAF loop writes CSS custom properties on one element. Nothing in the tree
// re-renders per frame — not for the level, which arrives ten times a second for
// the length of a call, and not for the breath, the blink or the gaze. The loop
// stops when the tab is hidden or the body has scrolled out of view, because a
// companion nobody can see is a companion nobody should be paying for.

import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import {
	INITIAL_HOLD,
	ORB_LABEL,
	SILENCE_HOLD_MS,
	clampLevel,
	holdPhase,
	smoothLevel,
	type OrbPhase,
	type VoiceCallHandle,
} from "../orb/orb";
import {
	ACT_EASE_MS,
	bounceScaleY,
	FACE,
	GAZE_K_ACT,
	GAZE_RELEASE_MS,
	GAZE_ZERO,
	MOUTH_SHUT,
	REST_EASE_MS,
	actEase,
	actFor,
	actGaze,
	blendVisual,
	blinkOpenness,
	easeGaze,
	gazeToward,
	initBlink,
	lumenVisual,
	mouthOpenness,
	stepBlink,
	stepMouth,
	wanderGaze,
	type Attention,
	type Gaze,
	type LumenAct,
	type MouthState,
} from "./lumen-motion";
import {
	ENVELOPE_EMPTY,
	clearEnvelope,
	levelFor,
	queueEnvelope,
	readEnvelope,
	type EnvelopeQueue,
} from "./envelope";
import bodyUrl from "./lumen-body.webp";
import tuftUrl from "./lumen-tuft.webp";

// The face, in the SVG's own 1000-unit box. Kept here rather than in the markup
// so the two eyes and the four transforms below all read the same numbers.
const BOX = 1000;
const EYE_CX = FACE.centreX * BOX;
const EYE_CY = FACE.centreY * BOX;
const EYE_DX = FACE.spread * BOX;
const EYE_RX = FACE.eyeRx * BOX;
const EYE_RY = FACE.eyeRy * BOX;
const IRIS_TX = FACE.irisTravelX * EYE_RX;
const IRIS_TY = FACE.irisTravelY * EYE_RY;
const FACE_TX = FACE.faceTravelX * BOX;
const FACE_TY = FACE.faceTravelY * BOX;

// How often the pointer's position is re-measured against the body's box. A
// pointermove can arrive on every frame and getBoundingClientRect on every one
// of them is a layout per frame for a glance.
const RECT_STALE_MS = 500;

export function Lumen({
	handle,
	// Where the soul's attention is (docs/66). It splits thinking into two acts:
	// looking up with the attention on the reader, and glancing down at the
	// desk with it on the work.
	attention = "reader",
	// Asleep. Not an OrbPhase: the voice pipeline never reports it (lumen.ts),
	// so it comes in as its own input and nothing is wired to it yet.
	rest = false,
	// The body's box, as the caller's own classes. Everything inside is a
	// percentage of it — the same component is the small one in the corner of
	// the briefing and the big one in the middle of a call.
	className,
}: {
	handle: VoiceCallHandle;
	attention?: Attention;
	rest?: boolean;
	className?: string;
}) {
	const phase = useHeldPhase(handle.phase);

	const rootRef = useRef<HTMLSpanElement>(null);
	const phaseRef = useRef<OrbPhase>(phase);
	phaseRef.current = phase;
	const attentionRef = useRef<Attention>(attention);
	attentionRef.current = attention;
	const restRef = useRef(rest);
	restRef.current = rest;
	const targetRef = useRef(0);
	const levelRef = useRef(0);
	const restMixRef = useRef(rest ? 1 : 0);
	const gazeRef = useRef<Gaze>(GAZE_ZERO);

	const subscribe = handle.subscribeLevel;
	const subscribeEnvelope = handle.subscribeEnvelope;

	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;

		const reduced =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const unsubscribe = subscribe((value) => {
			targetRef.current = clampLevel(value);
		});

		// The voice's own shape, one sentence at a time and ahead of being heard
		// (docs/45). Stamped on arrival, which is where the native clock and this
		// one meet; `null` is a barge-in or the end of the call, and what was
		// queued for it will never be spoken.
		let envelope: EnvelopeQueue = ENVELOPE_EMPTY;
		let bounceAt = -Infinity;
		const unsubscribeEnvelope = subscribeEnvelope((event) => {
			envelope =
				event === null
					? clearEnvelope(envelope)
					: queueEnvelope(envelope, event, performance.now());
		});

		// Where the pointer last was, in client coordinates, and when. Null until
		// something has moved: a touch device that never hovers leaves the gaze
		// wandering, which is the right answer for it.
		let pointer: { x: number; y: number } | null = null;
		let pointerAt = -Infinity;
		const onPointer = (event: PointerEvent) => {
			pointer = { x: event.clientX, y: event.clientY };
			pointerAt = performance.now();
		};
		window.addEventListener("pointermove", onPointer, { passive: true });

		let rect = el.getBoundingClientRect();
		let rectAt = -Infinity;

		let blink = initBlink(performance.now(), Math.random);
		let mouth: MouthState = MOUTH_SHUT;
		let frame = 0;
		let last = -1;
		// The act on screen, the one it is coming from, and when each began. The
		// outgoing act goes on running on its own clock for the length of the
		// crossfade, so a body caught mid-sway does not jump to the sway's zero
		// on its way out.
		let shown: LumenAct = actFor(phaseRef.current, attentionRef.current);
		let leaving: LumenAct = shown;
		let actAt = -1;
		let leavingAt = -1;

		const draw = (now: number) => {
			frame = requestAnimationFrame(draw);
			const dt = last < 0 ? 0 : now - last;
			last = now;
			const act = actFor(phaseRef.current, attentionRef.current);
			if (actAt < 0) {
				shown = act;
				leaving = act;
				actAt = now;
				leavingAt = now;
			} else if (act !== shown) {
				// A second change inside one crossfade leaves from wherever the
				// blend had got to in the act it was already leaving, which is the
				// one still on screen for most of it.
				leaving = shown;
				leavingAt = actAt;
				shown = act;
				actAt = now;
			}
			const actMs = now - actAt;
			const mix = actEase(actMs / ACT_EASE_MS);

			const voice = readEnvelope(envelope, now);
			envelope = voice.queue;
			if (voice.started) bounceAt = now;
			// Speaking reads the envelope; everything else reads the microphone. The
			// microphone is open through the whole call, so during an answer it is
			// the room and not the voice — a mouth on it would open at whoever is
			// nearest rather than at what Lumen is saying.
			const source = levelFor(shown, targetRef.current, voice.level);
			levelRef.current = smoothLevel(levelRef.current, source, dt);
			mouth = stepMouth(mouth, shown, levelRef.current, now);

			blink = stepBlink(blink, now, Math.random);

			// Asleep eases in over its own ramp rather than cutting, so falling
			// asleep is a settle. dt and not a frame count: a loop that was paused
			// while the tab was hidden must not finish the ramp in one frame.
			const restTarget = restRef.current ? 1 : 0;
			const step = dt > 0 ? dt / REST_EASE_MS : 0;
			restMixRef.current +=
				Math.sign(restTarget - restMixRef.current) *
				Math.min(step, Math.abs(restTarget - restMixRef.current));

			if (now - rectAt > RECT_STALE_MS) {
				rect = el.getBoundingClientRect();
				rectAt = now;
			}
			// Only a body with nothing to do follows the pointer. In the four acts
			// the eye direction is the act — looking at the cursor while it was
			// meant to be looking up at a thought would be the wrong story told
			// louder.
			const following = shown === "rest" && pointer !== null && now - pointerAt < GAZE_RELEASE_MS;
			const target =
				shown !== "rest"
					? actGaze(shown, actMs)
					: following && pointer
						? gazeToward(
								pointer,
								{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
								rect.width / 2,
							)
						: reduced
							? GAZE_ZERO
							: wanderGaze(now);
			gazeRef.current = easeGaze(gazeRef.current, target, dt, GAZE_K_ACT[shown]);

			const common = {
				level: levelRef.current,
				tMs: now,
				rest: restMixRef.current,
				eyeOpen: blinkOpenness(blink, now),
				gaze: gazeRef.current,
				mouthOpen: mouthOpenness(mouth, shown, levelRef.current, now),
				reduced,
			};
			const v =
				mix >= 1 || leaving === shown
					? lumenVisual({ act: shown, elapsedMs: actMs, ...common })
					: blendVisual(
							lumenVisual({ act: leaving, elapsedMs: now - leavingAt, ...common }),
							lumenVisual({ act: shown, elapsedMs: actMs, ...common }),
							mix,
						);

			const set = (name: string, value: number) => el.style.setProperty(name, value.toFixed(4));
			set("--lumen-sx", v.scaleX);
			set("--lumen-sy", v.scaleY * bounceScaleY(now - bounceAt, reduced));
			set("--lumen-glow", v.glow);
			set("--lumen-core", v.core);
			set("--lumen-pool", v.poolOpacity);
			set("--lumen-pool-x", v.poolScaleX);
			set("--lumen-tuft-y", v.tuftScaleY);
			set("--lumen-eye", v.eyeOpen);
			set("--lumen-eye-scale", v.eyeScale);
			set("--lumen-gx", v.gaze.x);
			set("--lumen-gy", v.gaze.y);
			set("--lumen-brow", v.browOpacity);
			set("--lumen-mouth-curve", v.mouthCurve);
			set("--lumen-mouth-mix", v.mouthMix);
			set("--lumen-mouth-open", v.mouthOpen);
			el.style.setProperty("--lumen-x", `${(v.shiftX * 100).toFixed(3)}%`);
			el.style.setProperty("--lumen-y", `${(v.shiftY * 100).toFixed(3)}%`);
			el.style.setProperty("--lumen-tilt", `${v.tiltDeg.toFixed(3)}deg`);
			el.style.setProperty("--lumen-tuft-lean", `${v.tuftLeanDeg.toFixed(3)}deg`);
		};

		// The loop runs only while there is someone to see it. `last` is reset on
		// every resume, or the first frame back would carry the whole pause as its
		// dt and jump every smoothed value to its target at once.
		let visible = !document.hidden;
		let onScreen = true;
		const sync = () => {
			const shouldRun = visible && onScreen;
			if (shouldRun && frame === 0) {
				last = -1;
				frame = requestAnimationFrame(draw);
			} else if (!shouldRun && frame !== 0) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
		};
		const onVisibility = () => {
			visible = !document.hidden;
			sync();
		};
		document.addEventListener("visibilitychange", onVisibility);

		const observer =
			typeof IntersectionObserver === "function"
				? new IntersectionObserver((entries) => {
						onScreen = entries.some((entry) => entry.isIntersecting);
						sync();
					})
				: null;
		observer?.observe(el);

		frame = requestAnimationFrame(draw);

		return () => {
			unsubscribe();
			unsubscribeEnvelope();
			window.removeEventListener("pointermove", onPointer);
			document.removeEventListener("visibilitychange", onVisibility);
			observer?.disconnect();
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [subscribe, subscribeEnvelope]);

	const idle = handle.phase === "idle";

	return (
		<Button
			type="button"
			variant="link"
			size={null}
			aria-label={ORB_LABEL[phase]}
			onClick={() => (idle ? handle.start() : handle.stop())}
			// No touch-target modifier: every size this is drawn at is over 44px,
			// and the body is the target.
			className={cn("relative block shrink-0", className)}
		>
			{/* Every custom property lives here and is inherited by all four
			    layers, so one element's style is the whole frame. The defaults are
			    the idle resting pose: nothing is ever painted unstyled. */}
			<span
				ref={rootRef}
				aria-hidden="true"
				// Named so the simulator bridge can read the properties back out of
				// a running app (scripts/ios-sim.sh eval), as data-orb was.
				data-lumen=""
				className="pointer-events-none absolute inset-0 block [--lumen-brow:0] [--lumen-core:0.42] [--lumen-eye-scale:1] [--lumen-eye:1] [--lumen-glow:0.3] [--lumen-gx:0] [--lumen-gy:0] [--lumen-mouth-curve:1] [--lumen-mouth-mix:0] [--lumen-mouth-open:0] [--lumen-pool-x:1] [--lumen-pool:0.42] [--lumen-sx:1] [--lumen-sy:1] [--lumen-tilt:0deg] [--lumen-tuft-lean:0deg] [--lumen-tuft-y:1] [--lumen-x:0%] [--lumen-y:0%]"
			>
				{/* The pool of light it is standing in. An ellipse under the body,
				    not a shadow: the light comes from Lumen, so the desk is brighter
				    where it sits, not darker. A radial gradient and not a blur —
				    iOS WebKit clips a filter to the element's own box and the
				    blurred version is a hard-edged square (docs/pitfall/219). */}
				<span className="absolute bottom-[9%] left-1/2 h-[12%] w-[72%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,#7ba9ff,transparent)] [opacity:calc(var(--lumen-pool)*0.62)] scale-x-(--lumen-pool-x)" />
				{/* The halo. The level's second reading, the way the orb's was — but
				    not in the app's accent green: Lumen is blue light, and the token
				    is the ink of a control. Faint on purpose. The page is paper, and
				    on paper a glow can only be a cool tint; anything strong enough to
				    read as light reads instead as a dirty ring. */}
				<span className="absolute inset-[-16%] rounded-full bg-[radial-gradient(circle,#8fb8ff_16%,transparent_60%)] [opacity:calc(var(--lumen-glow)*0.34)] [scale:var(--lumen-sx)_var(--lumen-sy)]" />
				{/* The body group: one transform for the whole character, so the
				    tuft, the light inside it and the face all breathe together. */}
				<span className="absolute inset-0 block [transform-origin:50%_86%] translate-x-(--lumen-x) translate-y-(--lumen-y) rotate-(--lumen-tilt) [scale:var(--lumen-sx)_var(--lumen-sy)] motion-reduce:rotate-0">
					{/* The tuft, above the body in paint order because that is how it
					    was cut. Its pivot is the middle of the feather band. */}
					<img
						src={tuftUrl}
						alt=""
						draggable={false}
						className="absolute inset-0 h-full w-full select-none [transform-origin:51%_22%] [transform:rotate(var(--lumen-tuft-lean))_scaleY(var(--lumen-tuft-y))]"
					/>
					<img src={bodyUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />
					{/* The core: the bright middle that says how hard it is working.
					    Screened over the body so it lights the paint rather than
					    covering it. */}
					<span className="absolute left-1/2 top-[54%] h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,#f6faff,transparent)] opacity-(--lumen-core) mix-blend-screen" />
					<LumenFace />
				</span>
			</span>
		</Button>
	);
}

// The face. Two eyes and a smile, over the blank body the master was generated
// with. Every transform below is written in the SVG's own user units rather than
// through `transform-box`, so nothing depends on how a WebKit build resolves a
// percentage origin inside an SVG.
function LumenFace() {
	return (
		<svg
			viewBox={`0 0 ${BOX} ${BOX}`}
			className="absolute inset-0 h-full w-full overflow-visible"
			aria-hidden="true"
		>
			<defs>
				<radialGradient id="lumen-iris" cx="38%" cy="28%" r="82%">
					<stop offset="0%" stopColor="#4f7ff5" />
					<stop offset="45%" stopColor="#1c33c8" />
					<stop offset="100%" stopColor="#0b1470" />
				</radialGradient>
				<linearGradient id="lumen-sclera" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#f9fcff" />
					<stop offset="100%" stopColor="#dce9ff" />
				</linearGradient>
			</defs>
			{/* The whole face slides a little with the gaze, which is what turns
			    two irises 2 px off centre into a head looking somewhere. */}
			<g
				style={{
					transform: `translate(calc(var(--lumen-gx) * ${FACE_TX}px), calc(var(--lumen-gy) * ${FACE_TY}px))`,
				}}
			>
				<Brow cx={EYE_CX - EYE_DX} sign={1} />
				<Brow cx={EYE_CX + EYE_DX} sign={-1} />
				<Eye cx={EYE_CX - EYE_DX} />
				<Eye cx={EYE_CX + EYE_DX} />
				<Mouth />
			</g>
		</svg>
	);
}

// The mouth, in three shapes and never a fourth: the closed smile, the flat
// line, and a small round opening. The two strokes crossfade into each other
// on one number and the round one fades in over both, because an open mouth is
// a hole and a hole is not a line.
//
// Three drawings and not one path squashed about its ends, which is what this
// was first: a scale of exactly zero is a singular matrix and the browser drops
// the element, and the non-scaling stroke that would have survived the squash
// takes its width in screen pixels, so the thinking mouth came out a slab.
//
// Not lip-sync. The level moves the height of the round mouth and nothing
// picks a shape per syllable (docs/66).
function Mouth() {
	const y = FACE.mouthY * BOX;
	const half = FACE.mouthWidth * BOX;
	const flat = half * 0.82;
	const open = `translate(0px, ${y}px) scaleY(calc(0.24 + 0.76 * var(--lumen-mouth-open))) translate(0px, ${-y}px)`;
	return (
		<>
			<path
				d={`M ${EYE_CX - half} ${y} Q ${EYE_CX} ${y + FACE.smileDepth * BOX} ${EYE_CX + half} ${y}`}
				fill="none"
				stroke="#152a86"
				strokeWidth={9}
				strokeLinecap="round"
				style={{ opacity: "calc(0.82 * var(--lumen-mouth-curve) * (1 - var(--lumen-mouth-mix)))" }}
			/>
			<path
				d={`M ${EYE_CX - flat} ${y} L ${EYE_CX + flat} ${y}`}
				fill="none"
				stroke="#152a86"
				strokeWidth={9}
				strokeLinecap="round"
				style={{
					opacity: "calc(0.82 * (1 - var(--lumen-mouth-curve)) * (1 - var(--lumen-mouth-mix)))",
				}}
			/>
			<ellipse
				cx={EYE_CX}
				cy={y + FACE.mouthOpenRy * BOX * 0.3}
				rx={FACE.mouthOpenRx * BOX}
				ry={FACE.mouthOpenRy * BOX}
				fill="#152a86"
				style={{ transform: open, opacity: "calc(0.86 * var(--lumen-mouth-mix))" }}
			/>
		</>
	);
}

// One brow. Two thin dark strokes that are simply not there except while it is
// working: a face that wore its brows all the time would have an expression at
// rest, and the resting face is the one in the painting.
function Brow({ cx, sign }: { cx: number; sign: 1 | -1 }) {
	const y = FACE.browY * BOX;
	const half = FACE.browWidth * BOX;
	// The inner end drops. `sign` is which side the inner end is on.
	const tilt = `rotate(${sign * FACE.browTiltDeg}deg)`;
	return (
		<path
			d={`M ${cx - half} ${y} Q ${cx} ${y - 0.008 * BOX} ${cx + half} ${y}`}
			fill="none"
			stroke="#152a86"
			strokeWidth={12}
			strokeLinecap="round"
			style={{
				transform: `translate(${cx}px, ${y}px) ${tilt} translate(${-cx}px, ${-y}px)`,
				opacity: "calc(0.78 * var(--lumen-brow))",
			}}
		/>
	);
}

// One eye. The open eye squashes to nothing as the lid comes down and the closed
// curve fades in under it, which is how a 2D rig blinks — the shut eye is a
// second drawing, not the same drawing at zero height.
function Eye({ cx }: { cx: number }) {
	// The lid and how wide the eye is held, about the eye's own centre: the two
	// multiply, so a blink during the wide-eyed listening act still shuts.
	const lid = `translate(${cx}px, ${EYE_CY}px) scale(var(--lumen-eye-scale), calc(var(--lumen-eye) * var(--lumen-eye-scale))) translate(${-cx}px, ${-EYE_CY}px)`;
	const gaze = `translate(calc(var(--lumen-gx) * ${IRIS_TX}px), calc(var(--lumen-gy) * ${IRIS_TY}px))`;
	return (
		<>
			<g style={{ transform: lid }}>
				<ellipse cx={cx} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} fill="url(#lumen-sclera)" />
				<g style={{ transform: gaze }}>
					<ellipse cx={cx} cy={EYE_CY} rx={EYE_RX * 0.88} ry={EYE_RY * 0.9} fill="url(#lumen-iris)" />
					<ellipse cx={cx} cy={EYE_CY + EYE_RY * 0.06} rx={EYE_RX * 0.44} ry={EYE_RY * 0.46} fill="#070d4a" />
					{/* Two catchlights, one big and one small: one alone reads as a
					    highlight, two read as a wet eye. Cool near-white rather than
					    the pure article: a specular on blue glass is not neutral, and
					    the palette contract keeps flat white out of the UI
					    (tests/ui/components/paper-tint-contract.test.ts). */}
					<ellipse cx={cx - EYE_RX * 0.3} cy={EYE_CY - EYE_RY * 0.36} rx={EYE_RX * 0.26} ry={EYE_RY * 0.22} fill="#f7fbff" />
					<ellipse cx={cx + EYE_RX * 0.34} cy={EYE_CY + EYE_RY * 0.3} rx={EYE_RX * 0.13} ry={EYE_RY * 0.1} fill="#f7fbff" opacity={0.8} />
				</g>
				{/* The thin lighter rim the painting has around each eye. */}
				<ellipse
					cx={cx}
					cy={EYE_CY}
					rx={EYE_RX}
					ry={EYE_RY}
					fill="none"
					stroke="#eaf3ff"
					strokeWidth={5}
					opacity={0.75}
				/>
			</g>
			{/* Shut. Clamped by opacity's own range: this is 1 at a closed eye and
			    zero once the lid is a third of the way up. */}
			<path
				d={`M ${cx - EYE_RX} ${EYE_CY} Q ${cx} ${EYE_CY + EYE_RY * 0.42} ${cx + EYE_RX} ${EYE_CY}`}
				fill="none"
				stroke="#152a86"
				strokeWidth={9}
				strokeLinecap="round"
				style={{ opacity: "calc((0.35 - var(--lumen-eye)) / 0.35)" }}
			/>
		</>
	);
}

// The phase Lumen shows: the session's, except that it leaves `speaking` late
// (orb.ts). A handful of events in a call, so re-rendering on one is free.
function useHeldPhase(source: OrbPhase): OrbPhase {
	const [held, setHeld] = useState(INITIAL_HOLD);

	useEffect(() => {
		const next = holdPhase(held, source, Date.now());
		if (next !== held) {
			setHeld(next);
			return;
		}
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
