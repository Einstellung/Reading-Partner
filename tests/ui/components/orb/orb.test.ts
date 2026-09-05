// The orb's arithmetic (src/ui/components/orb/orb.ts): the asymmetric smoother,
// the level clamp, the silence hold, and what each phase does with the level and
// with time. All of it is what the orb looks like, and none of it can be checked
// by looking at a device. Run: bun test.

import { expect, test } from "bun:test";
import {
	FALL_K,
	FRAME_MS,
	INITIAL_HOLD,
	MOTION,
	RISE_K,
	SILENCE_HOLD_MS,
	clampLevel,
	holdPhase,
	orbErrorLine,
	orbVisual,
	smoothLevel,
	type OrbPhase,
} from "../../../../src/ui/components/orb/orb";

test("a level outside 0..1 is brought back inside it", () => {
	expect(clampLevel(-0.5)).toBe(0);
	expect(clampLevel(1.5)).toBe(1);
	expect(clampLevel(0.42)).toBe(0.42);
});

test("a level that is not a number is silence, not a poisoned orb", () => {
	// One NaN through the smoother and every frame after it is NaN: the orb
	// stops moving for the rest of the call and nothing on screen says why.
	expect(clampLevel(Number.NaN)).toBe(0);
	expect(clampLevel(Number.POSITIVE_INFINITY)).toBe(0);
	expect(smoothLevel(clampLevel(Number.NaN), 0.5, FRAME_MS)).toBeCloseTo(RISE_K * 0.5, 6);
});

test("one frame moves the level by k of the gap", () => {
	expect(smoothLevel(0, 1, FRAME_MS)).toBeCloseTo(RISE_K, 6);
	expect(smoothLevel(1, 0, FRAME_MS)).toBeCloseTo(1 - FALL_K, 6);
});

test("rising is faster than falling by the constants docs/45 fixed", () => {
	expect(RISE_K).toBe(0.35);
	expect(FALL_K).toBe(0.1);
	const up = smoothLevel(0.5, 1, FRAME_MS) - 0.5;
	const down = 0.5 - smoothLevel(0.5, 0, FRAME_MS);
	expect(up).toBeGreaterThan(down * 3);
});

// The time constants the constants were chosen for: about 48 ms up and 167 ms
// down, measured as the time to cover 1 - 1/e of the gap.
function msToSettle(from: number, to: number): number {
	let value = from;
	let t = 0;
	const reached = from + (to - from) * (1 - 1 / Math.E);
	while (t < 2000) {
		value = smoothLevel(value, to, FRAME_MS);
		t += FRAME_MS;
		if (to > from ? value >= reached : value <= reached) return t;
	}
	return t;
}

test("the two time constants land where docs/45 says", () => {
	expect(msToSettle(0, 1)).toBeGreaterThan(30);
	expect(msToSettle(0, 1)).toBeLessThan(70);
	expect(msToSettle(1, 0)).toBeGreaterThan(140);
	expect(msToSettle(1, 0)).toBeLessThan(200);
});

test("a long frame applies the pull it missed", () => {
	// Two half-frames land where one whole frame does, so a dropped frame leaves
	// the orb where it should be rather than behind.
	const half = smoothLevel(smoothLevel(0, 1, FRAME_MS / 2), 1, FRAME_MS / 2);
	expect(half).toBeCloseTo(smoothLevel(0, 1, FRAME_MS), 6);
});

test("a frame with no time in it moves nothing", () => {
	expect(smoothLevel(0.3, 1, 0)).toBe(0.3);
	expect(smoothLevel(0.3, 1, -8)).toBe(0.3);
	expect(smoothLevel(0.3, 1, Number.NaN)).toBe(0.3);
});

test("the smoothed level never leaves the range the orb is drawn from", () => {
	let value = 0;
	for (const target of [1, 0, 1, 0.5, 0, 1]) {
		for (let i = 0; i < 120; i++) {
			value = smoothLevel(value, target, FRAME_MS);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	}
});

test("the orb goes on speaking through the gap between two sentences", () => {
	let state = { shown: "speaking" as OrbPhase, leftAt: null as number | null };
	state = holdPhase(state, "thinking", 1000);
	expect(state.shown).toBe("speaking");
	state = holdPhase(state, "thinking", 1000 + SILENCE_HOLD_MS - 1);
	expect(state.shown).toBe("speaking");
	// The next sentence arrived inside the hold: nothing ever changed.
	state = holdPhase(state, "speaking", 1000 + SILENCE_HOLD_MS - 1);
	expect(state).toEqual({ shown: "speaking", leftAt: null });
});

test("the hold is 400-500 ms and then the phase lands", () => {
	expect(SILENCE_HOLD_MS).toBeGreaterThanOrEqual(400);
	expect(SILENCE_HOLD_MS).toBeLessThanOrEqual(500);
	let state = { shown: "speaking" as OrbPhase, leftAt: null as number | null };
	state = holdPhase(state, "listening", 0);
	state = holdPhase(state, "listening", SILENCE_HOLD_MS);
	expect(state).toEqual({ shown: "listening", leftAt: null });
});

test("hanging up is not held", () => {
	// The hold covers the gaps inside one answer. Idle is the call being over,
	// which is the transition the reader asked for with their tap.
	const state = holdPhase({ shown: "speaking", leftAt: null }, "idle", 0);
	expect(state).toEqual({ shown: "idle", leftAt: null });
});

test("every other phase change is immediate", () => {
	expect(holdPhase(INITIAL_HOLD, "listening", 0).shown).toBe("listening");
	expect(holdPhase({ shown: "listening", leftAt: null }, "thinking", 0).shown).toBe("thinking");
	expect(holdPhase({ shown: "thinking", leftAt: null }, "speaking", 0).shown).toBe("speaking");
});

test("a step that changes nothing returns the state it was given", () => {
	// The hold runs in a React effect, so a new object per frame would be a
	// re-render per frame.
	const state = { shown: "listening" as OrbPhase, leftAt: null };
	expect(holdPhase(state, "listening", 0)).toBe(state);
});

test("the level drives the orb while the microphone is open", () => {
	for (const phase of ["listening", "speaking"] as OrbPhase[]) {
		const quiet = orbVisual(phase, 0, 0);
		const loud = orbVisual(phase, 1, 0);
		expect(loud.scale).toBeGreaterThan(quiet.scale);
		expect(loud.glow).toBeGreaterThan(quiet.glow);
	}
});

test("the level does not drive the orb when there is nothing to listen to", () => {
	for (const phase of ["idle", "thinking"] as OrbPhase[]) {
		expect(orbVisual(phase, 1, 0)).toEqual(orbVisual(phase, 0, 0));
	}
});

test("thinking is a distinct pulse, not the idle breath", () => {
	// Faster and shallower: what makes it read as working rather than resting.
	expect(MOTION.thinking.periodMs).toBeLessThan(MOTION.idle.periodMs / 2);
	expect(MOTION.thinking.breath).toBeLessThan(MOTION.idle.breath);
	expect(MOTION.thinking.drive).toBe(0);
});

test("a breath starts at the resting size and comes back to it", () => {
	const m = MOTION.idle;
	expect(orbVisual("idle", 0, 0).scale).toBeCloseTo(m.base, 6);
	expect(orbVisual("idle", 0, m.periodMs).scale).toBeCloseTo(m.base, 6);
	expect(orbVisual("idle", 0, m.periodMs / 2).scale).toBeCloseTo(m.base + m.breath, 6);
});

test("speaking has no breath of its own to wobble against the envelope", () => {
	expect(MOTION.speaking.breath).toBe(0);
	expect(orbVisual("speaking", 0.4, 0)).toEqual(orbVisual("speaking", 0.4, 1234));
});

test("the glow stays inside the opacity it is written to", () => {
	for (const phase of Object.keys(MOTION) as OrbPhase[]) {
		for (const level of [0, 0.5, 1]) {
			for (const t of [0, 200, 450, 2100]) {
				const { glow } = orbVisual(phase, level, t);
				expect(glow).toBeGreaterThan(0);
				expect(glow).toBeLessThanOrEqual(1);
			}
		}
	}
});

test("reduced motion is a still orb, one per phase", () => {
	for (const phase of Object.keys(MOTION) as OrbPhase[]) {
		const still = orbVisual(phase, 0, 0, true);
		expect(still).toEqual({ scale: MOTION[phase].base, glow: MOTION[phase].glowBase });
		// Neither time nor the microphone moves it.
		expect(orbVisual(phase, 1, 999, true)).toEqual(still);
	}
	// And the phases are still told apart, by a difference between two still
	// pictures rather than by a movement.
	expect(orbVisual("thinking", 0, 0, true).glow).toBeGreaterThan(
		orbVisual("idle", 0, 0, true).glow,
	);
});

test("a broken call says what happened and how to get back", () => {
	expect(orbErrorLine(null)).toBe(null);
	expect(orbErrorLine("interrupted")).toContain("Tap to start again");
	expect(orbErrorLine("lost")).toContain("Tap to start again");
	// Anything else is already a sentence written for the reader.
	expect(orbErrorLine("The microphone is in use.")).toBe("The microphone is in use.");
});
