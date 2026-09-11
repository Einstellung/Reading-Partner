// What Lumen's render layer owes the maths (src/ui/components/lumen/Lumen.tsx):
// one rAF loop writing custom properties onto one element, a loop that stops
// when nobody can see it, a subscription that comes down with the component,
// and — the reason any of it is shaped this way — not one re-render per level
// event, per breath or per blink.
//
// The frame loop is driven by hand. A real rAF in a headless window fires on a
// timer, and a test that waited for it would be asserting the timer.
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";

import { type VoiceCallHandle, type OrbPhase } from "../../../../src/ui/components/orb/orb";
import { ACT, ACT_EASE_MS, SCAN_HOP_MS } from "../../../../src/ui/components/lumen/lumen-motion";
import { useDom } from "../../../support/dom";

const { cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const { Lumen } = await import("../../../../src/ui/components/lumen/Lumen");

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

function body(container: HTMLElement): HTMLElement {
	const el = container.querySelector("[data-lumen]");
	expect(el).toBeTruthy();
	return el as HTMLElement;
}

const num = (el: HTMLElement, name: string) => Number(el.style.getPropertyValue(name));

test("a frame writes the whole pose onto one element", () => {
	const s = session("listening");
	const { container } = render(<Lumen handle={s.handle} />);
	frame(0);
	const el = body(container);
	for (const name of [
		"--lumen-sx",
		"--lumen-sy",
		"--lumen-glow",
		"--lumen-core",
		"--lumen-pool",
		"--lumen-tuft-y",
		"--lumen-eye",
		"--lumen-gx",
	]) {
		expect(Number.isFinite(num(el, name))).toBe(true);
	}
	expect(el.style.getPropertyValue("--lumen-tilt")).toMatch(/deg$/);
	expect(el.style.getPropertyValue("--lumen-x")).toMatch(/%$/);
	expect(num(el, "--lumen-sx")).toBeCloseTo(ACT.listen.base, 1);
	expect(num(el, "--lumen-glow")).toBeCloseTo(ACT.listen.glowBase, 2);
});

test("the acts reach the element: brows, mouth and where the eyes are", () => {
	// Past the crossfade in every case, so what is read back is the act itself
	// and not a frame on the way into it.
	const settle = (from: number) => {
		for (let i = 0; i <= 40; i++) frame(from + i * (ACT_EASE_MS / 20));
		return from + 40 * (ACT_EASE_MS / 20);
	};

	const listening = session("listening");
	const listen = render(<Lumen handle={listening.handle} />);
	let now = settle(0);
	const a = body(listen.container);
	expect(num(a, "--lumen-brow")).toBe(0);
	expect(num(a, "--lumen-mouth-curve")).toBe(1);
	expect(num(a, "--lumen-mouth-mix")).toBe(0);
	expect(num(a, "--lumen-eye-scale")).toBeGreaterThan(1);

	const thinking = session("thinking");
	const think = render(<Lumen handle={thinking.handle} />);
	now = settle(now);
	const b = body(think.container);
	expect(num(b, "--lumen-brow")).toBeCloseTo(1, 3);
	expect(num(b, "--lumen-mouth-curve")).toBeCloseTo(0, 3);
	// Up and to one side.
	expect(num(b, "--lumen-gy")).toBeLessThan(-0.3);

	const checking = session("thinking");
	const check = render(<Lumen handle={checking.handle} attention="work" />);
	// The scan snaps, so a couple of hops is enough to have the eyes down.
	for (let i = 0; i <= 30; i++) frame(now + i * SCAN_HOP_MS / 4);
	const c = body(check.container);
	expect(num(c, "--lumen-brow")).toBeCloseTo(1, 3);
	expect(num(c, "--lumen-gy")).toBeGreaterThan(0.3);

	const talking = session("speaking");
	const speak = render(<Lumen handle={talking.handle} />);
	now = settle(now + 4000);
	talking.level(0.9);
	for (let i = 0; i <= 30; i++) frame(now + i * (1000 / 60));
	const d = body(speak.container);
	expect(num(d, "--lumen-brow")).toBeCloseTo(0, 3);
	expect(num(d, "--lumen-mouth-mix")).toBeCloseTo(1, 3);
	expect(num(d, "--lumen-mouth-open")).toBeGreaterThan(0.3);
});

test("listening holds one size however loud the room is", () => {
	const s = session("listening");
	const { container } = render(<Lumen handle={s.handle} />);
	const el = body(container);
	for (let i = 0; i <= 40; i++) frame(i * 20);
	const still = num(el, "--lumen-sx");
	s.level(1);
	for (let i = 41; i <= 160; i++) frame(i * 20);
	expect(num(el, "--lumen-sx")).toBeCloseTo(still, 4);
	expect(num(el, "--lumen-sy")).toBeCloseTo(num(el, "--lumen-sx"), 4);
	// The tuft is where the room goes instead.
	expect(num(el, "--lumen-tuft-y")).toBeGreaterThan(ACT.listen.tuftBase);
});

test("the level reaches the body through the frame loop", () => {
	const s = session("listening");
	const { container } = render(<Lumen handle={s.handle} />);
	const el = body(container);
	frame(0);
	const quiet = num(el, "--lumen-glow");
	s.level(1);
	for (let i = 1; i <= 20; i++) frame(i * (1000 / 60));
	expect(num(el, "--lumen-glow")).toBeGreaterThan(quiet);
	const loud = num(el, "--lumen-glow");
	s.level(0);
	for (let i = 21; i <= 80; i++) frame(i * (1000 / 60));
	expect(num(el, "--lumen-glow")).toBeLessThan(loud);
});

test("the body keeps moving with no level at all", () => {
	// The breath is the clock's, not the microphone's: an idle Lumen with a
	// closed microphone is still alive.
	const s = session("idle");
	const { container } = render(<Lumen handle={s.handle} />);
	const el = body(container);
	frame(0);
	const first = el.style.getPropertyValue("--lumen-tilt");
	for (let i = 1; i <= 90; i++) frame(i * (1000 / 60));
	expect(el.style.getPropertyValue("--lumen-tilt")).not.toBe(first);
});

test("no level event and no frame re-renders anything", () => {
	// The whole reason the level is a subscription and the pose is a custom
	// property: this runs at 60 Hz for the length of a reading session.
	const s = session("listening");
	render(<Lumen handle={s.handle} />);
	frame(0);
	const settled = s.renders;
	for (let i = 1; i <= 120; i++) {
		s.level(i % 2 === 0 ? 0.9 : 0.1);
		frame(i * (1000 / 60));
	}
	expect(s.renders).toBe(settled);
});

test("reduced motion keeps the body nearly still", () => {
	reducedMotion(true);
	const s = session("idle");
	const { container } = render(<Lumen handle={s.handle} />);
	const el = body(container);
	let worst = 0;
	for (let i = 0; i <= 240; i++) {
		frame(i * (1000 / 60));
		worst = Math.max(worst, Math.abs(parseFloat(el.style.getPropertyValue("--lumen-tilt"))));
	}
	expect(worst).toBeGreaterThan(0);
	expect(worst).toBeLessThan(0.3);
});

test("asleep shuts the eyes and settles the body", () => {
	const s = session("idle");
	const { container, rerender } = render(<Lumen handle={s.handle} />);
	const el = body(container);
	frame(0);
	const awakeY = num(el, "--lumen-sy");
	expect(num(el, "--lumen-eye")).toBeGreaterThan(0.9);

	rerender(<Lumen handle={s.handle} rest />);
	// Past the settle ramp.
	for (let i = 1; i <= 120; i++) frame(i * (1000 / 60));
	expect(num(el, "--lumen-eye")).toBe(0);
	expect(num(el, "--lumen-sy")).toBeLessThan(awakeY);
	expect(num(el, "--lumen-sx")).toBeGreaterThan(1);
});

test("unmounting takes the subscription and the loop with it", () => {
	const s = session("listening");
	const view = render(<Lumen handle={s.handle} />);
	frame(0);
	view.unmount();
	expect(s.unsubscribed).toBe(1);
	expect(cancelled.length).toBeGreaterThanOrEqual(1);
});

test("a tap opens the call, and the next one ends it", () => {
	const idle = session("idle");
	const first = render(<Lumen handle={idle.handle} />);
	fireEvent.click(first.container.querySelector("button")!);
	expect(idle.calls).toEqual(["start"]);

	const live = session("speaking");
	const second = render(<Lumen handle={live.handle} />);
	fireEvent.click(second.container.querySelector("button")!);
	expect(live.calls).toEqual(["stop"]);
});
