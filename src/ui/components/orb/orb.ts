// The orb's arithmetic (docs/45): the level a microphone reports turned into a
// scale and a glow, the smoothing that turns a 10 Hz signal into something an
// eye reads as breathing, and the hold that keeps the shape from flickering
// between two sentences.
//
// A ui-layer display module with no React in it, the way hold-zones.ts is: the
// numbers below decide what the orb looks like, and eyeballing them on a device
// is not a way to find out whether they are right. VoiceOrb.tsx is rendering and
// one rAF loop over these functions — named that and not Orb.tsx, which bun's
// resolver cannot tell from this file (docs/pitfall/218).
//
// One colour for the whole conversation loop, four kinds of motion. Every orb
// with a published state list says the same thing — the states are pipeline
// states, and Alexa has spent ten years telling listening from thinking from
// speaking with movement alone. Nothing here returns a hue.

// The four states the info voice session pushes (docs/33). Nothing else: there
// is no error state and no connecting state, because a call that broke shows a
// line of text and an orb back at rest.
export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";

// What the orb needs from the session driving it. The hook that implements this
// lives in ui/components/info/use-voice-call.ts; the type is declared here so
// the orb depends on the shape and not on the hook.
//
// `subscribeLevel` and not a `level` field: the level arrives about ten times a
// second for as long as the call lasts, and a twenty-minute call is not a
// re-render budget. The subscriber writes to a ref and a single rAF loop reads
// it (VoiceOrb.tsx).
export interface VoiceCallHandle {
	phase: OrbPhase;
	start: () => void;
	stop: () => void;
	// "lost" | "interrupted" | a message to show as it stands; null when fine.
	error: string | null;
	// 0..1, about 10 Hz. Returns the unsubscribe.
	subscribeLevel: (cb: (value: number) => void) => () => void;
}

// The smoothing, at the frame rate the two constants were chosen for. Rising is
// fast (~48 ms) and falling is slow (~167 ms), and the asymmetry is the whole
// point: the gaps between words in ordinary speech are long enough that a
// symmetric filter makes the orb shiver on every consonant (docs/45).
export const RISE_K = 0.35;
export const FALL_K = 0.1;
export const FRAME_MS = 1000 / 60;

// How long the orb goes on looking like it is speaking after the session stops
// saying so. docs/45 asks for 400–500 ms: long enough to cover the gap between
// two sentences of the same answer, short enough that the turn still feels
// handed back.
export const SILENCE_HOLD_MS = 450;

// A level as the orb is allowed to use it. A native side that misses a buffer
// can report a NaN, and one NaN through the smoother poisons every frame after
// it — the orb never comes back, and nothing on screen says why.
export function clampLevel(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

// One step of `x += (target - x) * k`, over an arbitrary gap rather than over
// exactly one frame. The k values are per-frame at 60 fps, so a frame that took
// twice as long applies the same pull twice: 1 - (1-k)^n. A dropped frame then
// leaves the orb where it would have been rather than behind, and the same
// function serves a test that steps by hand.
export function smoothLevel(current: number, target: number, dtMs: number): number {
	if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
	const k = target > current ? RISE_K : FALL_K;
	const factor = 1 - Math.pow(1 - k, dtMs / FRAME_MS);
	return current + (target - current) * factor;
}

// What a phase does with the level and with time.
export interface PhaseMotion {
	// The resting size.
	base: number;
	// How much of the scale the level owns. Zero in the two phases where there
	// is nothing to listen to: an orb that swelled at the room while it was
	// thinking would be reporting the microphone, not the answer.
	drive: number;
	// The built-in oscillation: its depth and its period.
	breath: number;
	periodMs: number;
	// The halo at rest, and the level's share of it.
	glowBase: number;
	glowDrive: number;
}

export const MOTION: Record<OrbPhase, PhaseMotion> = {
	// Waiting to be tapped: one slow breath, deep enough to read as alive from
	// across the page and slow enough not to pull an eye off the briefing.
	idle: { base: 1, drive: 0, breath: 0.05, periodMs: 4200, glowBase: 0.3, glowDrive: 0 },
	// The room drives it. A shallow breath stays under the level so the orb is
	// never completely still while the microphone is open — silence at the start
	// of a sentence is not the same thing as a call that died.
	listening: { base: 1.02, drive: 0.14, breath: 0.012, periodMs: 3600, glowBase: 0.42, glowDrive: 0.4 },
	// The gap docs/33 asks to cover: 600–900 ms of pipeline plus however long the
	// model takes. Faster than the idle breath and shallower than it, which is
	// what makes it read as working rather than as resting.
	thinking: { base: 1.02, drive: 0, breath: 0.022, periodMs: 900, glowBase: 0.5, glowDrive: 0 },
	// The answer's own envelope drives it, so no breath of its own — two
	// oscillations at once is a wobble.
	speaking: { base: 1.04, drive: 0.18, breath: 0, periodMs: 0, glowBase: 0.5, glowDrive: 0.45 },
};

// The two numbers a frame writes: the scale of the orb and the opacity of the
// halo around it.
export interface OrbVisual {
	scale: number;
	glow: number;
}

// The visual for one frame. `elapsedMs` is time since this phase began, so the
// breath starts at its own zero on every change of phase and the size is
// continuous across one.
//
// `reduced` is the reduced-motion answer: the resting shape of the phase and
// nothing else — no breath, no level. The phase stays legible in the glow, which
// is a difference between two still pictures rather than a movement.
export function orbVisual(
	phase: OrbPhase,
	level: number,
	elapsedMs: number,
	reduced: boolean = false,
): OrbVisual {
	const m = MOTION[phase];
	if (reduced) return { scale: m.base, glow: m.glowBase };

	const value = clampLevel(level);
	const t = Number.isFinite(elapsedMs) ? elapsedMs : 0;
	// (1 - cos)/2 rather than a sine: it starts at zero, so the breath adds to
	// the resting size instead of stepping away from it on the first frame.
	const swell =
		m.breath > 0 && m.periodMs > 0
			? (m.breath * (1 - Math.cos((2 * Math.PI * t) / m.periodMs))) / 2
			: 0;

	return {
		scale: m.base + swell + m.drive * value,
		glow: Math.min(1, m.glowBase + m.glowDrive * value + swell),
	};
}

// The phase the orb shows, which trails the phase the session reports.
//
// `leftAt` is when the session stopped saying "speaking", on whatever clock the
// caller reads; null when nothing is pending.
export interface HoldState {
	shown: OrbPhase;
	leftAt: number | null;
}

export const INITIAL_HOLD: HoldState = { shown: "idle", leftAt: null };

// One step of the hold. Pure: the caller supplies the clock, so a test states
// the time instead of waiting for it.
//
// Leaving for idle is not held. The hold exists for the gaps inside one answer —
// speaking to thinking and back while the next sentence is synthesised — and
// idle means the call is over, which is the one transition the user asked for
// and the one that must not lag behind their tap.
export function holdPhase(state: HoldState, source: OrbPhase, now: number): HoldState {
	if (source === state.shown) {
		return state.leftAt === null ? state : { shown: state.shown, leftAt: null };
	}
	if (state.shown === "speaking" && source !== "idle") {
		if (state.leftAt === null) return { shown: "speaking", leftAt: now };
		if (now - state.leftAt < SILENCE_HOLD_MS) return state;
	}
	return { shown: source, leftAt: null };
}

// What a screen reader is told the orb is, and what a tap on it will do.
export const ORB_LABEL: Record<OrbPhase, string> = {
	idle: "Talk to the briefing",
	listening: "Listening — tap to end the call",
	thinking: "Thinking — tap to end the call",
	speaking: "Speaking — tap to end the call",
};

// The one line a broken call gets. Plain about what happened and about the way
// back, because the way back is the only thing left to offer: a call that was
// interrupted cannot be resumed, and tapping starts a new one (docs/33).
const ORB_ERROR: Record<string, string> = {
	interrupted: "The call was cut off. Tap to start again.",
	lost: "The call dropped. Tap to start again.",
};

export function orbErrorLine(error: string | null): string | null {
	if (!error) return null;
	return ORB_ERROR[error] ?? error;
}
