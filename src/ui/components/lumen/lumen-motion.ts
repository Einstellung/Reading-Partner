// Lumen's arithmetic (docs/45): what a body made of light does with time, with
// the microphone level, and with a pointer it can look at. The orb's four
// pipeline states are unchanged and its smoothing is unchanged — orb.ts owns
// both, and this module imports them rather than restating them. What is new is
// everything a body has that a disc does not: a breath that never repeats, a
// blink, a gaze, a tuft, and a pool of its own light on the desk.
//
// A ui-layer display module with no React in it, the same way orb.ts is. Every
// number a frame writes comes from here, so a test can state a time and read the
// frame back instead of watching for it. Named lumen-motion and not lumen: bun
// resolves an import case-insensitively and `./lumen` next to `Lumen.tsx` loads
// the component (docs/pitfall/218), which is the same trap orb.ts sidestepped by
// calling its renderer VoiceOrb.
//
// Two rules run through the whole file. Nothing here returns a hue: the states
// are told apart by movement, as they were on the orb. And nothing here repeats:
// the idle motion is five sines whose periods share no small common multiple
// plus a slow value noise, so two minutes apart the body is never in the same
// pose it was in.

import { SILENCE_HOLD_MS, clampLevel, type OrbPhase } from "../orb/orb";

// The five periods are Live2D's own, kept to the tenth of a millisecond they
// are published at (docs/45): breath 3.2345 s, head X 6.5345 s, head Y 3.5345 s,
// head Z 5.5345 s, body X 15.5345 s. The trailing 0.0345 is what makes them
// incommensurate — round them to 3.2 / 6.5 / 3.5 / 5.5 / 15.5 and the whole
// thing repeats every 1.5 minutes, which is inside a reading session.
export const BREATH_MS = 3234.5;
export const SWAY_MS = 6534.5;
export const BOB_MS = 3534.5;
export const TILT_MS = 5534.5;
export const DRIFT_MS = 15534.5;

export const BREATH_PERIODS_MS = [BREATH_MS, SWAY_MS, BOB_MS, TILT_MS, DRIFT_MS] as const;

// How long one node of the slow noise lasts. Long enough that the drift reads as
// a mood rather than as a jitter, and not a whole multiple of any period above.
export const NOISE_NODE_MS = 2311;

// A deterministic value noise: one pseudo-random value per node, smoothstepped
// between neighbours. Deterministic in `seed` and `tMs` alone, so a test asserts
// the curve instead of tolerating it, and the drift still never repeats because
// the node values do not.
export function noiseAt(tMs: number, seed: number): number {
	if (!Number.isFinite(tMs)) return 0;
	const x = tMs / NOISE_NODE_MS;
	const i = Math.floor(x);
	const f = x - i;
	const a = nodeValue(i, seed);
	const b = nodeValue(i + 1, seed);
	// Smoothstep rather than a straight line: a linear ramp between two nodes
	// has a corner at every node, and a corner in a slow drift reads as a twitch.
	const s = f * f * (3 - 2 * f);
	return a + (b - a) * s;
}

// One node's value in -1..1. An integer hash, not Math.random: the loop asks for
// the same node several frames running and must get the same answer.
function nodeValue(i: number, seed: number): number {
	let h = (Math.imul(i, 0x27d4eb2d) ^ Math.imul(seed, 0x165667b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
	h = (h ^ (h >>> 16)) >>> 0;
	return (h / 0xffffffff) * 2 - 1;
}

// The idle motion, before any phase or level touches it. Every field is a pure
// function of the clock: no state, so a paused tab that comes back a minute later
// resumes where the clock says rather than where it left off.
export interface Breath {
	// 0..1, starts at 0 — the swell adds to the resting size instead of stepping
	// away from it on the first frame, as orbVisual's does.
	swell: number;
	// -1..1 each: sideways drift, vertical bob, and the lean.
	sway: number;
	bob: number;
	tilt: number;
	// -1..1, the slowest of the five plus the noise: where the body is standing.
	drift: number;
}

export function breathAt(tMs: number, seed: number = 1): Breath {
	const t = Number.isFinite(tMs) ? tMs : 0;
	const wave = (periodMs: number) => Math.sin((2 * Math.PI * t) / periodMs);
	return {
		swell: (1 - Math.cos((2 * Math.PI * t) / BREATH_MS)) / 2,
		sway: wave(SWAY_MS),
		bob: wave(BOB_MS),
		tilt: wave(TILT_MS),
		// The one place the noise enters. Two thirds sine, one third noise: the
		// sine keeps it moving, the noise keeps it from coming back.
		drift: clamp(wave(DRIFT_MS) * 0.66 + noiseAt(t, seed) * 0.34, -1, 1),
	};
}

// The blink, at Live2D's published constants (docs/45): closing 0.1 s, held shut
// 0.05 s, opening 0.15 s, and the next one somewhere in the following 0–7 s on
// top of a 4 s base — about seventeen a minute, which is a resting human rate.
export const BLINK_CLOSE_MS = 100;
export const BLINK_HOLD_MS = 50;
export const BLINK_OPEN_MS = 150;
export const BLINK_BASE_MS = 4000;
export const BLINK_JITTER_MS = 7000;
export const BLINK_TOTAL_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;

// `startedAt` is when the blink in progress began, or null between blinks;
// `nextAt` is when the next one is due, on whatever clock the caller reads.
export interface BlinkState {
	startedAt: number | null;
	nextAt: number;
}

// `rand` returns 0..1. Injected rather than reached for, so the tests below state
// the schedule instead of sampling it.
export function initBlink(now: number, rand: () => number): BlinkState {
	return { startedAt: null, nextAt: now + BLINK_BASE_MS + rand() * BLINK_JITTER_MS };
}

// One step. A blink that is running finishes before another is scheduled, so a
// tab that was hidden for ten minutes comes back and blinks once, not sixty
// times: the missed blinks are gone, not queued.
export function stepBlink(state: BlinkState, now: number, rand: () => number): BlinkState {
	if (state.startedAt !== null) {
		if (now - state.startedAt < BLINK_TOTAL_MS) return state;
		return { startedAt: null, nextAt: now + BLINK_BASE_MS + rand() * BLINK_JITTER_MS };
	}
	if (now >= state.nextAt) return { startedAt: now, nextAt: state.nextAt };
	return state;
}

// How open the eyes are, 1 open and 0 shut. The three segments are linear on
// purpose: an eyelid is fast and mechanical, and easing it makes the blink look
// like a slow wink.
export function blinkOpenness(state: BlinkState, now: number): number {
	if (state.startedAt === null) return 1;
	const t = now - state.startedAt;
	if (t < 0) return 1;
	if (t < BLINK_CLOSE_MS) return 1 - t / BLINK_CLOSE_MS;
	if (t < BLINK_CLOSE_MS + BLINK_HOLD_MS) return 0;
	if (t < BLINK_TOTAL_MS) return (t - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS;
	return 1;
}

// Where the eyes are pointed, in eye-widths: -1 is as far left as an iris goes
// inside its own white, 1 as far right. Not pixels — the same pair of numbers
// drives the 56px orb in the corner and the 160px one in the middle of a call.
export interface Gaze {
	x: number;
	y: number;
}

export const GAZE_ZERO: Gaze = { x: 0, y: 0 };

// How far from the body's centre a pointer has to be for the gaze to reach its
// limit, as a multiple of the body's own half-width. Beyond that the eyes are
// already as far over as they go and following further would only make them
// twitch at the edge of the socket.
export const GAZE_REACH = 3;

// The gaze a pointer at `point` earns, given where the body's centre is and how
// wide it is. Clamped to the unit disc rather than the unit square: a pointer in
// the corner must not push the iris diagonally further than one straight up.
export function gazeToward(
	point: { x: number; y: number },
	centre: { x: number; y: number },
	halfWidth: number,
): Gaze {
	if (!(halfWidth > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return GAZE_ZERO;
	const reach = halfWidth * GAZE_REACH;
	return clampGaze({ x: (point.x - centre.x) / reach, y: (point.y - centre.y) / reach });
}

export function clampGaze(gaze: Gaze): Gaze {
	const x = Number.isFinite(gaze.x) ? gaze.x : 0;
	const y = Number.isFinite(gaze.y) ? gaze.y : 0;
	const r = Math.hypot(x, y);
	if (r <= 1) return { x, y };
	return { x: x / r, y: y / r };
}

// Per-frame pull on the gaze, at 60 fps. Slower than the level's rise: an eye
// that snapped to the pointer would read as a cursor, not as a glance.
export const GAZE_K = 0.08;

export function easeGaze(current: Gaze, target: Gaze, dtMs: number, k: number = GAZE_K): Gaze {
	if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
	const pull = Number.isFinite(k) ? clamp(k, 0.001, 1) : GAZE_K;
	const factor = 1 - Math.pow(1 - pull, dtMs / (1000 / 60));
	return {
		x: current.x + (target.x - current.x) * factor,
		y: current.y + (target.y - current.y) * factor,
	};
}

// Where the eyes go when nothing is pointing at them: a slow wander on two more
// incommensurate periods, shallow enough to read as thinking rather than as
// searching the room.
export const WANDER_X_MS = 9134.5;
export const WANDER_Y_MS = 13334.5;
export const WANDER_DEPTH = 0.34;

export function wanderGaze(tMs: number, seed: number = 2): Gaze {
	const t = Number.isFinite(tMs) ? tMs : 0;
	return clampGaze({
		x: (Math.sin((2 * Math.PI * t) / WANDER_X_MS) * 0.6 + noiseAt(t, seed) * 0.4) * WANDER_DEPTH,
		y: (Math.sin((2 * Math.PI * t) / WANDER_Y_MS) * 0.6 + noiseAt(t, seed + 7) * 0.4) * WANDER_DEPTH * 0.6,
	});
}

// How long a pointer has to be away before the gaze goes back to wandering.
export const GAZE_RELEASE_MS = 3000;

// --- the four acts --------------------------------------------------------
//
// Lumen does not animate states, it performs four acts: watch you, look up,
// glance down at the desk and scan it, look back and talk. The eye direction
// and the three mouth shapes carry the story; everything else stays small
// enough that the whole thing still reads at 72 px.

// Where the soul says its attention is (docs/66). Deliberately not folded into
// OrbPhase: the pipeline reports four states and this is a second axis, so
// every switch over a phase stays exhaustive.
export type Attention = "reader" | "work" | "away";

// The act, which is the phase crossed with the attention. `rest` is idle —
// named for what the body is doing rather than for the pipeline, because the
// table below is about a body.
export type LumenAct = "rest" | "listen" | "think" | "check" | "speak";

export function actFor(phase: OrbPhase, attention: Attention = "reader"): LumenAct {
	switch (phase) {
		case "listening":
			return "listen";
		// Checking is thinking with the attention on the desk. If a turn never
		// puts it there, the act never happens and the answer comes straight
		// back from the look upward — a glance down at nothing would be a lie
		// about what the soul was doing.
		case "thinking":
			return attention === "work" ? "check" : "think";
		case "speaking":
			return "speak";
		default:
			return "rest";
	}
}

// Everything an act does to the body. What the disc's MOTION table said about
// scale and glow is restated here rather than borrowed: the acts changed the
// rules it encoded (listening no longer pulses with the room), and orb.ts stays
// the owner of the two things the acts did not touch, the smoothing and the
// hold.
export interface ActBody {
	// The resting size, and the level's share of it.
	base: number;
	drive: number;
	// The act's own breath: depth and period.
	breath: number;
	periodMs: number;
	// The halo, at rest and per unit of level.
	glowBase: number;
	glowDrive: number;
	// The bright middle — the electricity half of docs/66.
	coreBase: number;
	coreDrive: number;
	// The tuft's height as a multiple of its resting height. The tuft is the one
	// part the microphone always moves, in every act that has a signal.
	tuftBase: number;
	tuftDrive: number;
	// How much of the never-repeating idle motion survives. Listening is zero:
	// going still is how a body says it is paying attention.
	idleMix: number;
	// The act's own sway, which stands in for the idle one where it is damped.
	swayMs: number;
	swayAmp: number;
	// Leaning toward the reader, who is below and to the left of the corner the
	// body sits in: a tilt, a shift down, and the body a little closer.
	leanDeg: number;
	leanY: number;
	// How wide the eyes are held, as a multiple of their painted size.
	eyeScale: number;
	// The two brow strokes. They exist only while it is working.
	brow: number;
	// The mouth: 1 is the closed smile and 0 the flat line. `mouthOpen` is the
	// crossfade to the third shape, the small round one.
	mouthCurve: number;
	mouthOpen: number;
}

export const ACT: Record<LumenAct, ActBody> = {
	// Nothing is happening. One slow breath, the blink, the drift: alive, not
	// inflating.
	rest: {
		base: 1,
		drive: 0,
		breath: 0.026,
		periodMs: 4200,
		glowBase: 0.3,
		glowDrive: 0,
		coreBase: 0.42,
		coreDrive: 0,
		tuftBase: 1,
		tuftDrive: 0,
		idleMix: 1,
		swayMs: 0,
		swayAmp: 0,
		leanDeg: 0,
		leanY: 0,
		eyeScale: 1,
		brow: 0,
		mouthCurve: 1,
		mouthOpen: 0,
	},
	// Leaning in, eyes wide and fixed, and nothing else moving. The level only
	// reaches the tuft: a body that swelled at the room would be reporting the
	// microphone rather than listening to it.
	listen: {
		base: 1.06,
		drive: 0,
		breath: 0,
		periodMs: 0,
		glowBase: 0.44,
		glowDrive: 0.16,
		coreBase: 0.5,
		coreDrive: 0.2,
		tuftBase: 1.04,
		tuftDrive: 0.18,
		idleMix: 0,
		swayMs: 0,
		swayAmp: 0,
		leanDeg: 3.5,
		leanY: 0.022,
		eyeScale: 1.1,
		brow: 0,
		mouthCurve: 1,
		mouthOpen: 0,
	},
	// Looking up and away, brows in, tuft up, core bright, and a slow sway on a
	// three-second period so the stillness of listening is not mistaken for it.
	think: {
		base: 1.02,
		drive: 0,
		breath: 0.012,
		periodMs: 1600,
		glowBase: 0.52,
		glowDrive: 0,
		coreBase: 0.78,
		coreDrive: 0,
		tuftBase: 1.18,
		tuftDrive: 0,
		idleMix: 0.2,
		swayMs: 3000,
		swayAmp: 1,
		leanDeg: 0,
		leanY: 0,
		eyeScale: 0.96,
		brow: 1,
		mouthCurve: 0,
		mouthOpen: 0,
	},
	// The same body as thinking, with the eyes down on the desk. The sway stops:
	// the scan is the movement, and two movements at once is a wobble.
	check: {
		base: 1.02,
		drive: 0,
		breath: 0.012,
		periodMs: 1600,
		glowBase: 0.5,
		glowDrive: 0,
		coreBase: 0.7,
		coreDrive: 0,
		tuftBase: 1.12,
		tuftDrive: 0,
		idleMix: 0.1,
		swayMs: 0,
		swayAmp: 0,
		leanDeg: 0,
		leanY: 0.01,
		eyeScale: 0.94,
		brow: 1,
		mouthCurve: 0,
		mouthOpen: 0,
	},
	// Talking. The mouth carries it, so the body only leans back toward the
	// reader and keeps the smallest drive it can be seen to have.
	speak: {
		base: 1.03,
		drive: 0.05,
		breath: 0,
		periodMs: 0,
		glowBase: 0.5,
		glowDrive: 0.45,
		coreBase: 0.58,
		coreDrive: 0.4,
		tuftBase: 1.06,
		tuftDrive: 0.2,
		idleMix: 0.45,
		swayMs: 0,
		swayAmp: 0,
		leanDeg: 2,
		leanY: 0.01,
		eyeScale: 1.02,
		brow: 0,
		mouthCurve: 0.35,
		mouthOpen: 1,
	},
};

// Where each act points the eyes, in the same eye-widths `gazeToward` returns.
// Positive y is down.
export const EYE_TARGET: Record<LumenAct, Gaze> = {
	rest: { x: 0, y: 0 },
	listen: { x: 0, y: 0.08 },
	// Up and to one side, as in docs/assets/lumen/lumen-thinking.png.
	think: { x: 0.62, y: -0.72 },
	check: { x: 0, y: 0.8 },
	speak: { x: 0, y: 0.06 },
};

// How hard each act pulls the eyes toward their target, per frame at 60 fps.
// The scan is the one place an eye is allowed to snap: a hop that eased would
// still be halfway across when the next one started.
export const GAZE_K_ACT: Record<LumenAct, number> = {
	rest: GAZE_K,
	listen: 0.16,
	think: 0.14,
	check: 0.45,
	speak: 0.16,
};

// The scan: two passes left and right across the desk, each hop about the
// length of a saccade plus its fixation, then a beat holding the middle before
// it goes round again.
export const SCAN_HOP_MS = 120;
export const SCAN_HOPS = 4;
export const SCAN_BEAT_MS = 520;
export const SCAN_CYCLE_MS = SCAN_HOP_MS * SCAN_HOPS + SCAN_BEAT_MS;
export const SCAN_REACH = 0.5;
export const SCAN_DOWN = 0.8;

// Deterministic in the time since the act began, so a test states a moment and
// reads the hop back. Hop 0 goes left: the desk is read the way a page is.
export function scanGaze(actMs: number): Gaze {
	const t = Number.isFinite(actMs) && actMs > 0 ? actMs % SCAN_CYCLE_MS : 0;
	const hop = Math.floor(t / SCAN_HOP_MS);
	if (hop >= SCAN_HOPS) return { x: 0, y: SCAN_DOWN };
	return { x: hop % 2 === 0 ? -SCAN_REACH : SCAN_REACH, y: SCAN_DOWN };
}

// The gaze an act asks for at a moment in it. Everything but the scan is a
// fixed direction — the story is told by where the eyes are, not by how they
// travel.
export function actGaze(act: LumenAct, actMs: number): Gaze {
	return act === "check" ? scanGaze(actMs) : EYE_TARGET[act];
}

// The mouth. Three shapes and no fourth: a closed smile, a flat line, and a
// small round opening whose height follows the level. Never a phoneme — an
// envelope at 10 Hz is two samples a syllable (docs/45), and a mouth driven off
// it is a puppet, not a face.
//
// The level during `speak` is the voice's own envelope, replayed against the
// local clock (envelope.ts); in every other act it is the microphone. The two
// are the same 0..1 mapping on the native side (SpeechOut.mapLevel), so one
// number reaches everything below whichever it came from.
export const MOUTH_MIN_OPEN = 0.15;
// Under this the room counts as quiet. Above the noise floor a closed
// microphone reports, and below the quietest syllable in an answer.
export const MOUTH_VOICE_LEVEL = 0.06;

// When the level was last loud enough to be a voice, or null. The hold that
// keeps the gaps between words from chattering the mouth shut is the orb's own
// SILENCE_HOLD_MS: the same 450 ms that keeps the phase from flickering.
export interface MouthState {
	voicedAt: number | null;
}

export const MOUTH_SHUT: MouthState = { voicedAt: null };

export function stepMouth(state: MouthState, act: LumenAct, level: number, now: number): MouthState {
	if (act !== "speak") return state.voicedAt === null ? state : MOUTH_SHUT;
	if (clampLevel(level) > MOUTH_VOICE_LEVEL) return { voicedAt: now };
	return state;
}

// 0 shut, MOUTH_MIN_OPEN barely open, 1 wide. Shut in every act but speaking,
// and shut in speaking only once the hold has run out.
export function mouthOpenness(state: MouthState, act: LumenAct, level: number, now: number): number {
	if (act !== "speak") return 0;
	const value = clampLevel(level);
	const voiced = value > MOUTH_VOICE_LEVEL;
	const held = state.voicedAt !== null && now - state.voicedAt < SILENCE_HOLD_MS;
	if (!voiced && !held) return 0;
	return MOUTH_MIN_OPEN + (1 - MOUTH_MIN_OPEN) * value;
}

// The nod at the start of a sentence (docs/66). A body that begins to speak
// does something, and the something is small: the whole move is 120 ms, which
// is under one syllable, so it reads as the start of a phrase and not as a
// bounce of its own.
//
// A dip first and an overshoot after, which is what a body does when it drops
// its weight to speak. One period of a sine, so it leaves 1 and returns to 1
// and nothing has to unwind it if the next sentence arrives early.
export const BOUNCE_MS = 120;
export const BOUNCE_DIP = 0.055;
export const BOUNCE_RISE = 0.03;

export function bounceScaleY(sinceMs: number, reduced: boolean = false): number {
	if (reduced) return 1;
	if (!Number.isFinite(sinceMs) || sinceMs < 0 || sinceMs >= BOUNCE_MS) return 1;
	const t = sinceMs / BOUNCE_MS;
	const swing = Math.sin(2 * Math.PI * t);
	return 1 - swing * (swing > 0 ? BOUNCE_DIP : BOUNCE_RISE);
}

// How long one act takes to become the next. Long enough to read as a turn of
// the head and short enough that the answer does not arrive before the face
// has finished asking for it.
export const ACT_EASE_MS = 280;

// Cubic ease-in-out over 0..1. The acts are poses, and a linear cut between two
// poses reads as a slide.
export function actEase(t: number): number {
	const x = clamp(t, 0, 1);
	return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Asleep. Not an OrbPhase — the pipeline never reports it, and putting it in the
// phase union would make every switch over the four states wrong. It is a
// separate input that eases in over its own ramp, so falling asleep is a settle
// and not a cut.
export const REST_EASE_MS = 900;

export const REST = {
	// Settling: wider, lower, flatter. The numbers are the brief's.
	scaleX: 1.08,
	scaleY: 0.88,
	// As a fraction of the body's own height, downward.
	sink: 0.045,
	glow: 0.16,
	core: 0.2,
	// The tuft droops rather than shrinks: shorter would read as smaller, and
	// the body is not smaller asleep. Eight degrees and not sixteen — the tuft
	// is a second raster cut off the first, and past about ten the curl visibly
	// parts company with the head it grows out of.
	tuftScaleY: 0.86,
	tuftLeanDeg: 8,
} as const;

// Everything one frame writes. All of it dimensionless: the component turns
// these into CSS custom properties and the stylesheet decides what a unit is.
export interface LumenVisual {
	scaleX: number;
	scaleY: number;
	// Fractions of the body's own box; the component writes them as percentages.
	shiftX: number;
	shiftY: number;
	tiltDeg: number;
	// 0..1 each.
	glow: number;
	core: number;
	// The pool of light on the desk under the body.
	poolOpacity: number;
	poolScaleX: number;
	// The tuft's own transform, on top of the body's.
	tuftScaleY: number;
	tuftLeanDeg: number;
	// 1 open, 0 shut. The blink and the rest state both write here.
	eyeOpen: number;
	// How wide the eyes are held, before the blink closes them.
	eyeScale: number;
	gaze: Gaze;
	// The two brow strokes, 0 absent and 1 there.
	browOpacity: number;
	// The mouth: 1 is the closed smile and 0 the flat line; `mouthMix` fades
	// from that stroke to the small round opening, which is `mouthOpen` high.
	mouthCurve: number;
	mouthMix: number;
	mouthOpen: number;
}

export interface LumenInput {
	act: LumenAct;
	// 0..1, already smoothed by orb.ts's smoothLevel.
	level: number;
	// Since this phase began, for the breath's own zero.
	elapsedMs: number;
	// The wall clock the sines read, so the idle motion is continuous across a
	// phase change while the breath's swell is not.
	tMs: number;
	// 1 fully asleep, 0 awake, anything between while it settles.
	rest: number;
	// From the blink scheduler.
	eyeOpen: number;
	gaze: Gaze;
	// How open the mouth is this frame, from mouthOpenness above.
	mouthOpen: number;
	// prefers-reduced-motion: the resting pose, a breath small enough to see only
	// if you are looking for it, and no drift. The blink stays — an eye that never
	// closes is not a motion effect, it is a stare.
	reduced: boolean;
	seed?: number;
}

export function lumenVisual(input: LumenInput): LumenVisual {
	const a = ACT[input.act];
	const level = clampLevel(input.level);
	const rest = clamp(input.rest, 0, 1);
	const awake = 1 - rest;

	const breath = breathAt(input.tMs, input.seed ?? 1);
	// Reduced motion keeps a tenth of the amplitude rather than none. A body that
	// is perfectly still on a desk reads as a picture of Lumen, and the point of
	// the setting is to stop motion pulling an eye, not to kill the character.
	const damp = input.reduced ? 0.1 : 1;

	// The act's own breath, on the act's clock, so it starts at its resting size
	// on every change of act exactly as the orb's did. Nothing here inflates:
	// the depth is a fraction of a percent of the body at every act that has
	// one, and listening and speaking have none at all.
	const swell =
		a.breath > 0 && a.periodMs > 0
			? (a.breath * (1 - Math.cos((2 * Math.PI * input.elapsedMs) / a.periodMs))) / 2
			: 0;

	const scale = a.base + swell * damp + a.drive * level;
	// Volume is conserved: a body that swells sideways rises less, which is what
	// keeps the breath from reading as a zoom.
	const squash = (breath.swell - 0.5) * 0.018 * damp * awake * a.idleMix;

	const glow = Math.min(1, a.glowBase + a.glowDrive * level + swell * damp);
	const core = Math.min(1, a.coreBase + a.coreDrive * level + breath.swell * 0.08 * damp * a.idleMix);

	// The act's own sway, where it has one, and the idle drift wherever the act
	// leaves room for it.
	const idle = damp * awake * a.idleMix;
	const actSway =
		a.swayAmp > 0 && a.swayMs > 0
			? Math.sin((2 * Math.PI * input.tMs) / a.swayMs) * a.swayAmp * damp * awake
			: 0;

	return {
		scaleX: lerp(scale * (1 + squash), scale * REST.scaleX, rest),
		scaleY: lerp(scale * (1 - squash), scale * REST.scaleY, rest),
		shiftX: breath.sway * 0.012 * idle + breath.drift * 0.01 * idle + actSway * 0.016,
		shiftY: lerp(-breath.bob * 0.009 * idle + a.leanY * awake, REST.sink, rest),
		tiltDeg: lerp(breath.tilt * 1.6 * idle + actSway * 1.8 + a.leanDeg * awake, 0, rest),
		glow: lerp(glow, REST.glow, rest),
		core: lerp(core, REST.core, rest),
		// The pool is the body's own light landing on the desk: it tracks the glow
		// and spreads as the body widens, and it is the last thing to go out.
		poolOpacity: lerp(0.3 + glow * 0.42, 0.14, rest),
		poolScaleX: lerp(1 + swell * 0.6 * damp + level * 0.05, REST.scaleX, rest),
		tuftScaleY: lerp(
			a.tuftBase + a.tuftDrive * level + breath.swell * 0.03 * idle,
			REST.tuftScaleY,
			rest,
		),
		tuftLeanDeg: lerp(
			breath.sway * 3.2 * idle + breath.drift * 1.4 * idle + actSway * 2.6 + a.leanDeg * 0.8 * awake,
			REST.tuftLeanDeg,
			rest,
		),
		// Shut asleep, and the ramp closes them before the body has finished
		// settling: eyes that were still open on a body already lying flat looked
		// like the animation had broken.
		eyeOpen: input.eyeOpen * Math.max(0, 1 - rest * 2),
		eyeScale: lerp(a.eyeScale, 1, rest),
		gaze: rest > 0 ? { x: input.gaze.x * awake, y: input.gaze.y * awake } : input.gaze,
		browOpacity: a.brow * awake,
		mouthCurve: a.mouthCurve,
		mouthMix: a.mouthOpen * awake,
		mouthOpen: clamp(input.mouthOpen, 0, 1) * awake,
	};
}

// One act dissolving into the next. Every field is a number and every number
// is linear in the mix, so the whole pose crossfades: the eyes travel, the
// brows fade, the mouth goes from one shape to the other, and nothing cuts.
export function blendVisual(from: LumenVisual, to: LumenVisual, t: number): LumenVisual {
	const k = clamp(t, 0, 1);
	if (k <= 0) return from;
	if (k >= 1) return to;
	const mix = (key: keyof LumenVisual) => lerp(from[key] as number, to[key] as number, k);
	return {
		scaleX: mix("scaleX"),
		scaleY: mix("scaleY"),
		shiftX: mix("shiftX"),
		shiftY: mix("shiftY"),
		tiltDeg: mix("tiltDeg"),
		glow: mix("glow"),
		core: mix("core"),
		poolOpacity: mix("poolOpacity"),
		poolScaleX: mix("poolScaleX"),
		tuftScaleY: mix("tuftScaleY"),
		tuftLeanDeg: mix("tuftLeanDeg"),
		eyeOpen: mix("eyeOpen"),
		eyeScale: mix("eyeScale"),
		gaze: { x: lerp(from.gaze.x, to.gaze.x, k), y: lerp(from.gaze.y, to.gaze.y, k) },
		browOpacity: mix("browOpacity"),
		mouthCurve: mix("mouthCurve"),
		mouthMix: mix("mouthMix"),
		mouthOpen: mix("mouthOpen"),
	};
}

// Where the eyes sit and how big they are, measured off the master painting
// (m-noring.png, 1254 px square) and expressed as fractions of the rendered box
// so the SVG face lands where the painted one was at any size. The pair is
// symmetric about the face's centre even though the painting's is not — the
// painting is a little three-quarter and Lumen is drawn straight on.
export const FACE = {
	centreX: 0.503,
	centreY: 0.583,
	// Half the distance between the two irises.
	spread: 0.111,
	eyeRx: 0.062,
	eyeRy: 0.084,
	// How far the iris travels inside its own white, as a fraction of the eye.
	irisTravelX: 0.5,
	irisTravelY: 0.42,
	// How far the whole face slides with the gaze, in the same box fractions.
	// The iris alone cannot say "looking up" on an eye 12 px tall: the pupil
	// fills nine tenths of its own white, so a quarter of the remaining travel
	// is under a pixel. The face moving with it is what reads as a head turn.
	faceTravelX: 0.016,
	faceTravelY: 0.014,
	mouthY: 0.663,
	mouthWidth: 0.055,
	// How far the smile's curve drops below its two ends. Zero is the flat
	// line, and the stroke morphs between the two on one number.
	smileDepth: 0.028,
	// The round mouth, fully open: half its width and half its height. Smaller
	// than the smile is wide — an open mouth as wide as the smile reads as a
	// shout at 72 px.
	mouthOpenRx: 0.032,
	mouthOpenRy: 0.042,
	// The brows: how far above the eyes they sit, how long they are, and how
	// far the inner end drops: a hair, so the face ponders rather than frowns.
	// They are the only line on the face that is not
	// there all the time.
	browY: 0.415,
	browWidth: 0.058,
	browTiltDeg: 2,
} as const;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp(value: number, lo: number, hi: number): number {
	if (!Number.isFinite(value)) return lo;
	return value < lo ? lo : value > hi ? hi : value;
}
