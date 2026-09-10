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

import { MOTION, clampLevel, type OrbPhase } from "../orb/orb";

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

export function easeGaze(current: Gaze, target: Gaze, dtMs: number): Gaze {
	if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
	const factor = 1 - Math.pow(1 - GAZE_K, dtMs / (1000 / 60));
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

// What a phase does to a body, on top of what MOTION already says about scale
// and glow. The four fields here are the ones a disc had nowhere to put: the
// core inside the light, the height of the tuft, how fast the breath runs, and
// how much of the pool below is lit.
export interface PhaseBody {
	// Multiplies the breath period: thinking breathes fast, speaking barely
	// breathes at all because the answer's envelope is already moving it.
	breathRate: number;
	// The bright middle, 0..1, and the level's share of it.
	coreBase: number;
	coreDrive: number;
	// The tuft's height as a multiple of its resting height, and the level's
	// share. Thinking stands it up; nothing else touches it.
	tuftBase: number;
	tuftDrive: number;
}

export const BODY: Record<OrbPhase, PhaseBody> = {
	idle: { breathRate: 1, coreBase: 0.42, coreDrive: 0, tuftBase: 1, tuftDrive: 0 },
	listening: { breathRate: 1.15, coreBase: 0.5, coreDrive: 0.34, tuftBase: 1.04, tuftDrive: 0.06 },
	// The one state that reads as effort. The core is the brightest it gets and
	// the tuft stands up: docs/45 asks the states to be told apart by movement,
	// and a tuft is the fastest-reading movement a round body has.
	thinking: { breathRate: 3.6, coreBase: 0.72, coreDrive: 0, tuftBase: 1.16, tuftDrive: 0 },
	speaking: { breathRate: 1, coreBase: 0.58, coreDrive: 0.4, tuftBase: 1.06, tuftDrive: 0.1 },
};

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
	gaze: Gaze;
}

export interface LumenInput {
	phase: OrbPhase;
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
	// prefers-reduced-motion: the resting pose, a breath small enough to see only
	// if you are looking for it, and no drift. The blink stays — an eye that never
	// closes is not a motion effect, it is a stare.
	reduced: boolean;
	seed?: number;
}

export function lumenVisual(input: LumenInput): LumenVisual {
	const m = MOTION[input.phase];
	const b = BODY[input.phase];
	const level = clampLevel(input.level);
	const rest = clamp(input.rest, 0, 1);
	const awake = 1 - rest;

	const breath = breathAt(input.tMs, input.seed ?? 1);
	// Reduced motion keeps a tenth of the amplitude rather than none. A body that
	// is perfectly still on a desk reads as a picture of Lumen, and the point of
	// the setting is to stop motion pulling an eye, not to kill the character.
	const damp = input.reduced ? 0.1 : 1;

	// The phase's own breath, on the phase's clock, so it starts at its resting
	// size on every change of phase exactly as the orb's did.
	const rate = input.reduced ? 1 : b.breathRate;
	const swell =
		m.breath > 0 && m.periodMs > 0
			? (m.breath *
					(1 - Math.cos((2 * Math.PI * input.elapsedMs * rate) / m.periodMs))) /
				2
			: 0;

	const scale = m.base + swell * damp + m.drive * level;
	// Volume is conserved: a body that swells sideways rises less, which is what
	// keeps the breath from reading as a zoom.
	const squash = (breath.swell - 0.5) * 0.018 * damp * awake;

	const glow = Math.min(1, m.glowBase + m.glowDrive * level + swell * damp);
	const core = Math.min(1, b.coreBase + b.coreDrive * level + breath.swell * 0.08 * damp);

	return {
		scaleX: lerp(scale * (1 + squash), scale * REST.scaleX, rest),
		scaleY: lerp(scale * (1 - squash), scale * REST.scaleY, rest),
		shiftX: breath.sway * 0.012 * damp * awake + breath.drift * 0.01 * damp * awake,
		shiftY: lerp(-breath.bob * 0.009 * damp, REST.sink, rest),
		tiltDeg: lerp(breath.tilt * 1.6 * damp, 0, rest),
		glow: lerp(glow, REST.glow, rest),
		core: lerp(core, REST.core, rest),
		// The pool is the body's own light landing on the desk: it tracks the glow
		// and spreads as the body widens, and it is the last thing to go out.
		poolOpacity: lerp(0.3 + glow * 0.42, 0.14, rest),
		poolScaleX: lerp(1 + swell * 0.6 * damp + level * 0.05, REST.scaleX, rest),
		tuftScaleY: lerp(
			b.tuftBase + b.tuftDrive * level + breath.swell * 0.03 * damp,
			REST.tuftScaleY,
			rest,
		),
		tuftLeanDeg: lerp(breath.sway * 3.2 * damp + breath.drift * 1.4 * damp, REST.tuftLeanDeg, rest),
		// Shut asleep, and the ramp closes them before the body has finished
		// settling: eyes that were still open on a body already lying flat looked
		// like the animation had broken.
		eyeOpen: input.eyeOpen * Math.max(0, 1 - rest * 2),
		gaze: rest > 0 ? { x: input.gaze.x * awake, y: input.gaze.y * awake } : input.gaze,
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
	irisTravelX: 0.3,
	irisTravelY: 0.22,
	mouthY: 0.663,
	mouthWidth: 0.055,
} as const;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp(value: number, lo: number, hi: number): number {
	if (!Number.isFinite(value)) return lo;
	return value < lo ? lo : value > hi ? hi : value;
}
