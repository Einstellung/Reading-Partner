// Lumen's arithmetic (src/ui/components/lumen/lumen-motion.ts): the breath that must
// never repeat, the blink schedule, the gaze and its clamp, and what each phase
// and the rest state do to the body. None of it can be checked by looking at a
// device — "it looks alive" is not an assertion, and "it repeated after ninety
// seconds" is not something an eye catches.
//
// Run: bun test.

import { expect, test } from "bun:test";

import {
	BLINK_BASE_MS,
	BLINK_CLOSE_MS,
	BLINK_HOLD_MS,
	BLINK_JITTER_MS,
	BLINK_TOTAL_MS,
	BODY,
	BREATH_PERIODS_MS,
	GAZE_REACH,
	REST,
	blinkOpenness,
	breathAt,
	clampGaze,
	easeGaze,
	gazeToward,
	initBlink,
	lumenVisual,
	noiseAt,
	stepBlink,
	wanderGaze,
	type LumenInput,
} from "../../../../src/ui/components/lumen/lumen-motion";

const AWAKE: LumenInput = {
	phase: "idle",
	level: 0,
	elapsedMs: 0,
	tMs: 0,
	rest: 0,
	eyeOpen: 1,
	gaze: { x: 0, y: 0 },
	reduced: false,
};

// --- the breath -----------------------------------------------------------

test("the five breath periods share no small common multiple", () => {
	// The whole reason the Live2D constants carry that trailing 0.0345: round
	// them to 3.2 / 6.5 / 3.5 / 5.5 / 15.5 seconds and the pose repeats every
	// 90 seconds, which is well inside one sitting with a book.
	for (let i = 0; i < BREATH_PERIODS_MS.length; i++) {
		for (let j = i + 1; j < BREATH_PERIODS_MS.length; j++) {
			const ratio = BREATH_PERIODS_MS[i]! / BREATH_PERIODS_MS[j]!;
			let nearest = Infinity;
			for (let q = 1; q <= 64; q++) {
				const p = Math.round(ratio * q);
				if (p === 0) continue;
				nearest = Math.min(nearest, Math.abs(ratio - p / q));
			}
			expect(nearest).toBeGreaterThan(1e-4);
		}
	}
});

test("two minutes of breathing is never the same two minutes twice", () => {
	// Sixty seconds at 60 Hz, compared with the sixty seconds an hour later. A
	// signal that repeats inside an hour puts these within a rounding error of
	// each other.
	let worst = 0;
	for (let i = 0; i < 3600; i++) {
		const t = i * (1000 / 60);
		const a = breathAt(t);
		const b = breathAt(t + 3_600_000);
		worst = Math.max(
			worst,
			Math.abs(a.swell - b.swell),
			Math.abs(a.sway - b.sway),
			Math.abs(a.drift - b.drift),
		);
	}
	expect(worst).toBeGreaterThan(0.2);
});

test("the breath starts at its resting pose, not away from it", () => {
	// The swell is (1 - cos)/2 and not a sine, so the first frame after a phase
	// change adds nothing and the body does not step.
	expect(breathAt(0).swell).toBeCloseTo(0, 6);
});

test("the drift noise is the same every time it is asked and not the same twice over", () => {
	expect(noiseAt(12_345, 1)).toBe(noiseAt(12_345, 1));
	expect(noiseAt(12_345, 1)).not.toBe(noiseAt(12_345, 2));
	const values = Array.from({ length: 200 }, (_, i) => noiseAt(i * 977, 1));
	expect(Math.max(...values)).toBeGreaterThan(0.5);
	expect(Math.min(...values)).toBeLessThan(-0.5);
	// Smoothstepped: no step between neighbouring frames is a jump.
	for (let t = 0; t < 20_000; t += 16) {
		expect(Math.abs(noiseAt(t + 16, 1) - noiseAt(t, 1))).toBeLessThan(0.05);
	}
});

// --- the blink ------------------------------------------------------------

test("the next blink is due between four and eleven seconds out", () => {
	expect(initBlink(0, () => 0).nextAt).toBe(BLINK_BASE_MS);
	expect(initBlink(0, () => 1).nextAt).toBe(BLINK_BASE_MS + BLINK_JITTER_MS);
	expect(initBlink(1000, () => 0.5).nextAt).toBe(1000 + BLINK_BASE_MS + BLINK_JITTER_MS / 2);
});

test("a blink closes, holds and opens on Live2D's own clock", () => {
	let state = initBlink(0, () => 0);
	state = stepBlink(state, BLINK_BASE_MS, () => 0);
	expect(state.startedAt).toBe(BLINK_BASE_MS);
	const at = (offset: number) => blinkOpenness(state, BLINK_BASE_MS + offset);
	expect(at(0)).toBeCloseTo(1, 6);
	expect(at(BLINK_CLOSE_MS / 2)).toBeCloseTo(0.5, 6);
	expect(at(BLINK_CLOSE_MS)).toBe(0);
	expect(at(BLINK_CLOSE_MS + BLINK_HOLD_MS - 1)).toBe(0);
	expect(at(BLINK_CLOSE_MS + BLINK_HOLD_MS + 75)).toBeCloseTo(0.5, 6);
	expect(at(BLINK_TOTAL_MS)).toBe(1);
});

test("a tab that was hidden for ten minutes comes back and blinks once", () => {
	// Not sixty times: the missed blinks are gone, not queued.
	let state = initBlink(0, () => 0);
	state = stepBlink(state, 600_000, () => 0);
	expect(state.startedAt).toBe(600_000);
	// And nothing else starts until this one has finished.
	state = stepBlink(state, 600_000 + BLINK_TOTAL_MS - 1, () => 0);
	expect(state.startedAt).toBe(600_000);
	state = stepBlink(state, 600_000 + BLINK_TOTAL_MS, () => 0);
	expect(state.startedAt).toBeNull();
	expect(state.nextAt).toBe(600_000 + BLINK_TOTAL_MS + BLINK_BASE_MS);
});

test("the eyes are open when no blink is running", () => {
	expect(blinkOpenness(initBlink(0, () => 0.5), 3000)).toBe(1);
});

// --- the gaze -------------------------------------------------------------

test("a pointer at the far corner does not push the iris out of the eye", () => {
	const g = gazeToward({ x: 10_000, y: 10_000 }, { x: 0, y: 0 }, 28);
	expect(Math.hypot(g.x, g.y)).toBeCloseTo(1, 6);
});

test("the gaze reaches its limit at three body-widths and is linear before that", () => {
	const half = 28;
	const centre = { x: 100, y: 100 };
	const straight = gazeToward({ x: 100 + half * GAZE_REACH, y: 100 }, centre, half);
	expect(straight.x).toBeCloseTo(1, 6);
	const halfway = gazeToward({ x: 100 + (half * GAZE_REACH) / 2, y: 100 }, centre, half);
	expect(halfway.x).toBeCloseTo(0.5, 6);
	expect(gazeToward({ x: 100, y: 100 }, centre, half)).toEqual({ x: 0, y: 0 });
});

test("a body with no width on screen is looked away from, not divided by", () => {
	expect(gazeToward({ x: 5, y: 5 }, { x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
	expect(clampGaze({ x: NaN, y: 2 })).toEqual({ x: 0, y: 1 });
});

test("the gaze eases toward the pointer instead of snapping to it", () => {
	let g = { x: 0, y: 0 };
	const target = { x: 1, y: 0 };
	g = easeGaze(g, target, 1000 / 60);
	expect(g.x).toBeGreaterThan(0);
	expect(g.x).toBeLessThan(0.2);
	for (let i = 0; i < 200; i++) g = easeGaze(g, target, 1000 / 60);
	expect(g.x).toBeCloseTo(1, 3);
	// A dropped frame applies the same pull for the time it took, not once.
	const one = easeGaze({ x: 0, y: 0 }, target, 1000 / 60).x;
	const four = easeGaze({ x: 0, y: 0 }, target, 4000 / 60).x;
	expect(four).toBeGreaterThan(one * 3);
});

test("the idle wander stays shallow and never repeats", () => {
	let worst = 0;
	for (let i = 0; i < 2000; i++) {
		const t = i * 50;
		const g = wanderGaze(t);
		expect(Math.hypot(g.x, g.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(g.x)).toBeLessThan(0.4);
		worst = Math.max(worst, Math.abs(g.x - wanderGaze(t + 3_600_000).x));
	}
	expect(worst).toBeGreaterThan(0.1);
});

// --- the phases -----------------------------------------------------------

test("thinking is the brightest core and the tallest tuft", () => {
	const cores = (["idle", "listening", "thinking", "speaking"] as const).map(
		(p) => BODY[p].coreBase,
	);
	expect(BODY.thinking.coreBase).toBe(Math.max(...cores));
	expect(BODY.thinking.tuftBase).toBeGreaterThan(BODY.idle.tuftBase);
	// And it breathes faster than anything else, which is what reads as effort.
	expect(BODY.thinking.breathRate).toBeGreaterThan(BODY.listening.breathRate);
});

test("only the two phases with something to listen to let the level in", () => {
	const loud = (phase: LumenInput["phase"]) =>
		lumenVisual({ ...AWAKE, phase, level: 1 }).glow - lumenVisual({ ...AWAKE, phase }).glow;
	expect(loud("listening")).toBeGreaterThan(0.2);
	expect(loud("speaking")).toBeGreaterThan(0.2);
	expect(loud("idle")).toBeCloseTo(0, 6);
	expect(loud("thinking")).toBeCloseTo(0, 6);
});

test("a level that is not a number leaves the body where it was", () => {
	const v = lumenVisual({ ...AWAKE, phase: "listening", level: NaN });
	expect(v.scaleX).toBeCloseTo(lumenVisual({ ...AWAKE, phase: "listening" }).scaleX, 6);
	expect(Number.isFinite(v.glow)).toBe(true);
});

test("the breath conserves volume: what widens does not also rise", () => {
	// Sampled across a whole breath. A body that swelled on both axes at once
	// reads as a zoom rather than as breathing.
	let sawWider = false;
	let sawTaller = false;
	for (let t = 0; t < 3300; t += 60) {
		const v = lumenVisual({ ...AWAKE, tMs: t });
		if (v.scaleX > v.scaleY + 1e-6) sawWider = true;
		if (v.scaleY > v.scaleX + 1e-6) sawTaller = true;
	}
	expect(sawWider && sawTaller).toBe(true);
});

// --- reduced motion and rest ---------------------------------------------

test("reduced motion keeps a tenth of the breath and none of the drift", () => {
	let full = 0;
	let damped = 0;
	for (let t = 0; t < 6000; t += 40) {
		const a = lumenVisual({ ...AWAKE, tMs: t, elapsedMs: t });
		const b = lumenVisual({ ...AWAKE, tMs: t, elapsedMs: t, reduced: true });
		full = Math.max(full, Math.abs(a.shiftX), Math.abs(a.tiltDeg));
		damped = Math.max(damped, Math.abs(b.shiftX), Math.abs(b.tiltDeg));
	}
	expect(damped).toBeGreaterThan(0);
	expect(damped).toBeLessThan(full * 0.2);
});

test("asleep settles wider, lower, dimmer and shut", () => {
	const awake = lumenVisual(AWAKE);
	const asleep = lumenVisual({ ...AWAKE, rest: 1 });
	expect(asleep.scaleX).toBeGreaterThan(awake.scaleX);
	expect(asleep.scaleY).toBeLessThan(awake.scaleY);
	expect(asleep.shiftY).toBeCloseTo(REST.sink, 6);
	expect(asleep.glow).toBeLessThan(awake.glow);
	expect(asleep.core).toBeLessThan(awake.core);
	expect(asleep.tuftScaleY).toBeLessThan(awake.tuftScaleY);
	expect(asleep.tuftLeanDeg).toBeCloseTo(REST.tuftLeanDeg, 6);
	expect(asleep.eyeOpen).toBe(0);
	expect(asleep.gaze).toEqual({ x: 0, y: 0 });
});

test("the eyes are shut before the body has finished settling", () => {
	// Eyes still open on a body already lying flat looked like the animation
	// had broken, so they close at twice the rate of everything else.
	expect(lumenVisual({ ...AWAKE, rest: 0.5 }).eyeOpen).toBe(0);
	expect(lumenVisual({ ...AWAKE, rest: 0.25 }).eyeOpen).toBeCloseTo(0.5, 6);
});

test("a blink half-closes the eyes without touching the body", () => {
	const open = lumenVisual(AWAKE);
	const mid = lumenVisual({ ...AWAKE, eyeOpen: 0.4 });
	expect(mid.eyeOpen).toBeCloseTo(0.4, 6);
	expect(mid.scaleX).toBeCloseTo(open.scaleX, 6);
});

test("every field a frame writes is a finite number", () => {
	// One NaN reaches the stylesheet as an invalid declaration and the body
	// stops moving with nothing on screen to say why.
	for (const phase of ["idle", "listening", "thinking", "speaking"] as const) {
		for (const rest of [0, 0.5, 1]) {
			const v = lumenVisual({ ...AWAKE, phase, rest, tMs: 12_345, elapsedMs: 678, level: 0.6 });
			for (const value of [
				v.scaleX,
				v.scaleY,
				v.shiftX,
				v.shiftY,
				v.tiltDeg,
				v.glow,
				v.core,
				v.poolOpacity,
				v.poolScaleX,
				v.tuftScaleY,
				v.tuftLeanDeg,
				v.eyeOpen,
				v.gaze.x,
				v.gaze.y,
			]) {
				expect(Number.isFinite(value)).toBe(true);
			}
			expect(v.glow).toBeLessThanOrEqual(1);
			expect(v.core).toBeLessThanOrEqual(1);
		}
	}
});
