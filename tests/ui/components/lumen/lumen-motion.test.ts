// Lumen's arithmetic (src/ui/components/lumen/lumen-motion.ts): the breath that must
// never repeat, the blink schedule, the gaze and its clamp, and what each phase
// and the rest state do to the body. None of it can be checked by looking at a
// device — "it looks alive" is not an assertion, and "it repeated after ninety
// seconds" is not something an eye catches.
//
// Run: bun test.

import { expect, test } from "bun:test";

import { SILENCE_HOLD_MS } from "../../../../src/ui/components/orb/orb";
import {
	BLINK_BASE_MS,
	BLINK_CLOSE_MS,
	BLINK_HOLD_MS,
	BLINK_JITTER_MS,
	BLINK_TOTAL_MS,
	ACT,
	ACT_EASE_MS,
	BREATH_PERIODS_MS,
	GAZE_REACH,
	GAZE_K_ACT,
	MOUTH_MIN_OPEN,
	MOUTH_SHUT,
	MOUTH_VOICE_LEVEL,
	REST,
	SCAN_BEAT_MS,
	SCAN_CYCLE_MS,
	SCAN_DOWN,
	SCAN_HOPS,
	SCAN_HOP_MS,
	SCAN_REACH,
	actEase,
	actFor,
	actGaze,
	blendVisual,
	blinkOpenness,
	breathAt,
	clampGaze,
	easeGaze,
	gazeToward,
	initBlink,
	lumenVisual,
	mouthOpenness,
	noiseAt,
	scanGaze,
	stepBlink,
	stepMouth,
	wanderGaze,
	type LumenInput,
} from "../../../../src/ui/components/lumen/lumen-motion";

const AWAKE: LumenInput = {
	act: "rest",
	level: 0,
	elapsedMs: 0,
	tMs: 0,
	rest: 0,
	eyeOpen: 1,
	gaze: { x: 0, y: 0 },
	mouthOpen: 0,
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

// --- the four acts --------------------------------------------------------

test("the act is the phase crossed with where the attention is", () => {
	expect(actFor("idle", "reader")).toBe("rest");
	expect(actFor("listening", "reader")).toBe("listen");
	expect(actFor("thinking", "reader")).toBe("think");
	expect(actFor("thinking", "work")).toBe("check");
	expect(actFor("thinking", "away")).toBe("think");
	expect(actFor("speaking", "work")).toBe("speak");
	// Attention is a second axis, not a fifth phase: with none given the body
	// is turned to the reader.
	expect(actFor("thinking")).toBe("think");
});

test("a turn that never puts the attention on the work never checks", () => {
	// The whole point of the act being skippable: a glance down at a desk
	// nothing is happening on is a lie about what the soul was doing.
	const phases = ["idle", "listening", "thinking", "speaking", "thinking", "idle"] as const;
	expect(phases.map((p) => actFor(p, "reader"))).not.toContain("check");
});

test("thinking is the brightest core and the tallest tuft", () => {
	const cores = (["rest", "listen", "think", "check", "speak"] as const).map((a) => ACT[a].coreBase);
	expect(ACT.think.coreBase).toBe(Math.max(...cores));
	expect(ACT.think.tuftBase).toBeGreaterThan(ACT.rest.tuftBase);
	expect(ACT.check.tuftBase).toBeGreaterThan(ACT.rest.tuftBase);
});

test("listening goes still and does not pulse with the room", () => {
	// Stillness is the tell. The level is allowed to reach the tuft and the
	// light, and nothing else: a body that swelled at the microphone would be
	// reporting the room rather than attending to it.
	expect(ACT.listen.drive).toBe(0);
	expect(ACT.listen.breath).toBe(0);
	expect(ACT.listen.idleMix).toBe(0);
	const quiet = lumenVisual({ ...AWAKE, act: "listen" });
	for (let t = 0; t < 4000; t += 40) {
		const loud = lumenVisual({ ...AWAKE, act: "listen", tMs: t, elapsedMs: t, level: 1 });
		const still = lumenVisual({ ...AWAKE, act: "listen", tMs: t, elapsedMs: t });
		expect(loud.scaleX).toBeCloseTo(quiet.scaleX, 6);
		expect(loud.scaleY).toBeCloseTo(quiet.scaleY, 6);
		expect(still.scaleX).toBeCloseTo(quiet.scaleX, 6);
		expect(still.shiftX).toBeCloseTo(quiet.shiftX, 6);
	}
	expect(lumenVisual({ ...AWAKE, act: "listen", level: 1 }).tuftScaleY).toBeGreaterThan(
		quiet.tuftScaleY,
	);
});

test("listening leans toward the reader and widens the eyes", () => {
	const rest = lumenVisual(AWAKE);
	const listen = lumenVisual({ ...AWAKE, act: "listen" });
	expect(listen.tiltDeg).toBeGreaterThan(rest.tiltDeg);
	expect(listen.shiftY).toBeGreaterThan(rest.shiftY);
	expect(listen.scaleX).toBeGreaterThan(rest.scaleX);
	expect(listen.eyeScale).toBeGreaterThan(1);
});

test("only the acts with something to listen to let the level in", () => {
	const loud = (act: LumenInput["act"]) =>
		lumenVisual({ ...AWAKE, act, level: 1 }).glow - lumenVisual({ ...AWAKE, act }).glow;
	expect(loud("speak")).toBeGreaterThan(0.2);
	expect(loud("listen")).toBeGreaterThan(0.1);
	expect(loud("rest")).toBeCloseTo(0, 6);
	expect(loud("think")).toBeCloseTo(0, 6);
	expect(loud("check")).toBeCloseTo(0, 6);
});

test("a level that is not a number leaves the body where it was", () => {
	const v = lumenVisual({ ...AWAKE, act: "listen", level: NaN });
	expect(v.scaleX).toBeCloseTo(lumenVisual({ ...AWAKE, act: "listen" }).scaleX, 6);
	expect(Number.isFinite(v.glow)).toBe(true);
});

test("the eyes look up to think, down to check and back for the answer", () => {
	expect(actGaze("think", 0).y).toBeLessThan(-0.5);
	expect(Math.abs(actGaze("think", 0).x)).toBeGreaterThan(0.4);
	expect(actGaze("check", 0).y).toBeGreaterThan(0.5);
	expect(Math.abs(actGaze("speak", 0).y)).toBeLessThan(0.2);
	expect(actGaze("speak", 0).x).toBe(0);
	// Only the check moves inside its own act.
	expect(actGaze("think", 0)).toEqual(actGaze("think", 5000));
});

test("the scan hops left and right twice and then holds a beat", () => {
	const xs: number[] = [];
	for (let hop = 0; hop < SCAN_HOPS; hop++) xs.push(scanGaze(hop * SCAN_HOP_MS + 10).x);
	expect(xs).toEqual([-SCAN_REACH, SCAN_REACH, -SCAN_REACH, SCAN_REACH]);
	// Every hop is on the desk, not on the viewer.
	for (let t = 0; t < SCAN_CYCLE_MS; t += 20) expect(scanGaze(t).y).toBeCloseTo(SCAN_DOWN, 6);
	// And then the beat, in the middle, for the rest of the cycle.
	expect(scanGaze(SCAN_HOPS * SCAN_HOP_MS + 10).x).toBe(0);
	expect(scanGaze(SCAN_CYCLE_MS - 1).x).toBe(0);
	expect(SCAN_BEAT_MS).toBeGreaterThan(SCAN_HOP_MS * 2);
	// Deterministic and periodic: a test states a moment and reads the hop.
	expect(scanGaze(37)).toEqual(scanGaze(37 + SCAN_CYCLE_MS));
	expect(scanGaze(-5)).toEqual(scanGaze(0));
	expect(scanGaze(NaN)).toEqual(scanGaze(0));
});

test("the scan is the one place the eyes are allowed to snap", () => {
	// A hop that eased at the resting rate would still be halfway across when
	// the next one started.
	expect(GAZE_K_ACT.check).toBeGreaterThan(GAZE_K_ACT.think * 2);
	expect(GAZE_K_ACT.check).toBeGreaterThan(GAZE_K_ACT.speak * 2);
});

test("the brows are there for the work and nowhere else", () => {
	expect(lumenVisual({ ...AWAKE, act: "think" }).browOpacity).toBe(1);
	expect(lumenVisual({ ...AWAKE, act: "check" }).browOpacity).toBe(1);
	for (const act of ["rest", "listen", "speak"] as const) {
		expect(lumenVisual({ ...AWAKE, act }).browOpacity).toBe(0);
	}
	// Asleep has no brows either, however it got there.
	expect(lumenVisual({ ...AWAKE, act: "think", rest: 1 }).browOpacity).toBe(0);
});

test("the mouth has three shapes and thinking is the flat one", () => {
	expect(lumenVisual({ ...AWAKE, act: "rest" }).mouthCurve).toBe(1);
	expect(lumenVisual({ ...AWAKE, act: "listen" }).mouthCurve).toBe(1);
	expect(lumenVisual({ ...AWAKE, act: "think" }).mouthCurve).toBe(0);
	expect(lumenVisual({ ...AWAKE, act: "check" }).mouthCurve).toBe(0);
	// Speaking is the round one: the stroke gives way to it entirely.
	expect(lumenVisual({ ...AWAKE, act: "speak" }).mouthMix).toBe(1);
	for (const act of ["rest", "listen", "think", "check"] as const) {
		expect(lumenVisual({ ...AWAKE, act }).mouthMix).toBe(0);
	}
});

test("the mouth opens with the level and only while speaking", () => {
	const now = 1000;
	let mouth = MOUTH_SHUT;
	mouth = stepMouth(mouth, "speak", 0.8, now);
	expect(mouthOpenness(mouth, "speak", 0.8, now)).toBeGreaterThan(MOUTH_MIN_OPEN);
	expect(mouthOpenness(mouth, "speak", 1, now)).toBeCloseTo(1, 6);
	// Barely open is the floor, never shut mid-word.
	expect(mouthOpenness(mouth, "speak", MOUTH_VOICE_LEVEL + 0.001, now)).toBeGreaterThanOrEqual(
		MOUTH_MIN_OPEN,
	);
	// No other act opens it, whatever the microphone says.
	for (const act of ["rest", "listen", "think", "check"] as const) {
		expect(mouthOpenness(mouth, act, 1, now)).toBe(0);
		expect(stepMouth(mouth, act, 1, now)).toEqual(MOUTH_SHUT);
	}
});

test("the mouth holds through the gap between two words and then closes", () => {
	const spoke = 5000;
	const mouth = stepMouth(MOUTH_SHUT, "speak", 0.9, spoke);
	// Silent, but inside the hold: still open, at the floor.
	expect(mouthOpenness(mouth, "speak", 0, spoke + 100)).toBeCloseTo(MOUTH_MIN_OPEN, 6);
	expect(mouthOpenness(mouth, "speak", 0, spoke + SILENCE_HOLD_MS - 1)).toBeCloseTo(
		MOUTH_MIN_OPEN,
		6,
	);
	// Past it, shut.
	expect(mouthOpenness(mouth, "speak", 0, spoke + SILENCE_HOLD_MS)).toBe(0);
	// And a mouth that never spoke never opened.
	expect(mouthOpenness(MOUTH_SHUT, "speak", 0, spoke)).toBe(0);
});

test("one act dissolves into the next over its own ramp", () => {
	const from = lumenVisual({ ...AWAKE, act: "think" });
	const to = lumenVisual({ ...AWAKE, act: "speak" });
	expect(blendVisual(from, to, 0)).toEqual(from);
	expect(blendVisual(from, to, 1)).toEqual(to);
	const half = blendVisual(from, to, 0.5);
	expect(half.browOpacity).toBeCloseTo(0.5, 6);
	expect(half.mouthMix).toBeCloseTo(0.5, 6);
	expect(half.core).toBeCloseTo((from.core + to.core) / 2, 6);
	// Out of range is clamped rather than extrapolated.
	expect(blendVisual(from, to, -1)).toEqual(from);
	expect(blendVisual(from, to, 9)).toEqual(to);
	for (const value of Object.values(half)) {
		if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
	}
});

test("the act ramp starts and ends flat, inside the readable window", () => {
	expect(actEase(0)).toBe(0);
	expect(actEase(1)).toBe(1);
	expect(actEase(0.5)).toBeCloseTo(0.5, 6);
	expect(actEase(-2)).toBe(0);
	expect(actEase(4)).toBe(1);
	// Slower at the ends than in the middle: a pose that cut in linearly reads
	// as a slide.
	expect(actEase(0.1)).toBeLessThan(0.1);
	expect(actEase(0.9)).toBeGreaterThan(0.9);
	expect(ACT_EASE_MS).toBeGreaterThanOrEqual(200);
	expect(ACT_EASE_MS).toBeLessThanOrEqual(350);
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
	for (const act of ["rest", "listen", "think", "check", "speak"] as const) {
		for (const rest of [0, 0.5, 1]) {
			const v = lumenVisual({ ...AWAKE, act, rest, tMs: 12_345, elapsedMs: 678, level: 0.6, mouthOpen: 0.7 });
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
				v.eyeScale,
				v.browOpacity,
				v.mouthCurve,
				v.mouthMix,
				v.mouthOpen,
			]) {
				expect(Number.isFinite(value)).toBe(true);
			}
			expect(v.glow).toBeLessThanOrEqual(1);
			expect(v.core).toBeLessThanOrEqual(1);
		}
	}
});
