// What the orb's render layer owes the maths (src/ui/components/orb/VoiceOrb.tsx):
// one rAF loop writing two custom properties, a subscription that comes down
// with the component, and — the reason any of it is shaped this way — not one
// re-render per level event.
//
// The frame loop is driven by hand. A real rAF in a headless window fires on a
// timer, and a test that waited for it would be asserting the timer.
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { MOTION, type VoiceCallHandle, type OrbPhase } from "../../../../src/ui/components/orb/orb";
import { useDom } from "../../../support/dom";

const { cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const { VoiceOrb } = await import("../../../../src/ui/components/orb/VoiceOrb");

// The frame queue, standing in for the browser's.
let pending: FrameRequestCallback[] = [];
let cancelled: number[] = [];
let realRaf: typeof globalThis.requestAnimationFrame;
let realCancel: typeof globalThis.cancelAnimationFrame;
let realMatchMedia: typeof window.matchMedia;

beforeEach(() => {
	pending = [];
	cancelled = [];
	realRaf = globalThis.requestAnimationFrame;
	realCancel = globalThis.cancelAnimationFrame;
	realMatchMedia = window.matchMedia;
	let id = 0;
	globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
		pending.push(cb);
		return ++id;
	}) as typeof globalThis.requestAnimationFrame;
	globalThis.cancelAnimationFrame = ((handle: number) => {
		cancelled.push(handle);
	}) as typeof globalThis.cancelAnimationFrame;
	reducedMotion(false);
});

afterEach(() => {
	globalThis.requestAnimationFrame = realRaf;
	globalThis.cancelAnimationFrame = realCancel;
	window.matchMedia = realMatchMedia;
});

function reducedMotion(on: boolean) {
	window.matchMedia = ((query: string) =>
		({
			matches: on && query.includes("prefers-reduced-motion"),
			media: query,
			addEventListener() {},
			removeEventListener() {},
		}) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function frame(now: number) {
	const due = pending;
	pending = [];
	for (const cb of due) cb(now);
}

// A session under the test's control, counting how many times the component
// asked what phase it is in — which is once per render and the only reason to
// read it.
function session(phase: OrbPhase) {
	const emit: ((value: number) => void)[] = [];
	let unsubscribed = 0;
	let reads = 0;
	const calls: string[] = [];
	const handle = {
		start: () => void calls.push("start"),
		stop: () => void calls.push("stop"),
		error: null,
		subscribeLevel: (cb: (value: number) => void) => {
			emit.push(cb);
			return () => {
				unsubscribed++;
			};
		},
	} as unknown as VoiceCallHandle;
	Object.defineProperty(handle, "phase", {
		get() {
			reads++;
			return phase;
		},
	});
	return {
		handle,
		calls,
		level: (value: number) => emit.forEach((cb) => cb(value)),
		get renders() {
			return reads;
		},
		get unsubscribed() {
			return unsubscribed;
		},
	};
}

function orb(container: HTMLElement): HTMLElement {
	const el = container.querySelector("[aria-hidden='true']");
	expect(el).toBeTruthy();
	return el as HTMLElement;
}

const scaleOf = (el: HTMLElement) => Number(el.style.getPropertyValue("--orb-scale"));
const glowOf = (el: HTMLElement) => Number(el.style.getPropertyValue("--orb-glow"));

test("a frame writes the scale and the glow onto the element", () => {
	const s = session("listening");
	const { container } = render(<VoiceOrb handle={s.handle} />);
	frame(0);
	const el = orb(container);
	expect(scaleOf(el)).toBeCloseTo(MOTION.listening.base, 3);
	expect(glowOf(el)).toBeCloseTo(MOTION.listening.glowBase, 3);
});

test("the level reaches the orb through the frame loop", () => {
	const s = session("listening");
	const { container } = render(<VoiceOrb handle={s.handle} />);
	const el = orb(container);
	frame(0);
	const quiet = scaleOf(el);
	s.level(1);
	for (let i = 1; i <= 20; i++) frame(i * (1000 / 60));
	expect(scaleOf(el)).toBeGreaterThan(quiet);
	expect(glowOf(el)).toBeGreaterThan(MOTION.listening.glowBase);
	// And it comes back down when the room goes quiet.
	const loud = scaleOf(el);
	s.level(0);
	for (let i = 21; i <= 80; i++) frame(i * (1000 / 60));
	expect(scaleOf(el)).toBeLessThan(loud);
});

test("no level event re-renders anything", () => {
	// The whole reason the level is a subscription and not a prop: this runs at
	// 10 Hz for the length of a call.
	const s = session("listening");
	render(<VoiceOrb handle={s.handle} />);
	frame(0);
	const settled = s.renders;
	for (let i = 1; i <= 60; i++) {
		s.level(i % 2 === 0 ? 0.9 : 0.1);
		frame(i * (1000 / 60));
	}
	expect(s.renders).toBe(settled);
});

test("reduced motion holds the orb still", () => {
	reducedMotion(true);
	const s = session("listening");
	const { container } = render(<VoiceOrb handle={s.handle} />);
	const el = orb(container);
	frame(0);
	s.level(1);
	for (let i = 1; i <= 40; i++) frame(i * (1000 / 60));
	expect(scaleOf(el)).toBeCloseTo(MOTION.listening.base, 3);
	expect(glowOf(el)).toBeCloseTo(MOTION.listening.glowBase, 3);
});

test("unmounting takes the subscription and the loop with it", () => {
	const s = session("listening");
	const view = render(<VoiceOrb handle={s.handle} />);
	frame(0);
	view.unmount();
	expect(s.unsubscribed).toBe(1);
	expect(cancelled).toHaveLength(1);
});

test("a tap opens the call, and the next one ends it", () => {
	const idle = session("idle");
	const first = render(<VoiceOrb handle={idle.handle} />);
	fireEvent.click(first.container.querySelector("button")!);
	expect(idle.calls).toEqual(["start"]);

	const live = session("speaking");
	const second = render(<VoiceOrb handle={live.handle} />);
	fireEvent.click(second.container.querySelector("button")!);
	expect(live.calls).toEqual(["stop"]);
});
