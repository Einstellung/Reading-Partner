// Where Lumen looks while a turn runs (src/ui/components/lumen/attention.ts).
// The two numbers under test are the ones an eye cannot check: a 50 ms tool
// call has to produce a glance long enough to read, and three tools in a row
// have to read as one glance rather than three.
//
// Run: bun test tests/ui/components/lumen/attention.test.ts

import { expect, test } from "bun:test";

import {
	WORK_DWELL_MS,
	WORK_LINGER_MS,
	applyActivity,
	attentionEndsAt,
	attentionFrom,
	noActivity,
	type LumenActivity,
} from "../../../../src/ui/components/lumen/attention";
import type { TurnActivity } from "../../../../src/ai/activity";

const start = (name: string): TurnActivity => ({ kind: "tool", name, phase: "start" });
const end = (name: string): TurnActivity => ({ kind: "tool", name, phase: "end" });

/** Fold a script of [event, when] pairs, as the hook does. */
function run(script: [TurnActivity, number][]): LumenActivity {
	let state = noActivity();
	for (const [event, at] of script) state = applyActivity(state, event, at);
	return state;
}

test("nothing has happened, so the eyes are on the reader", () => {
	const state = noActivity();
	expect(attentionFrom(state, 0)).toBe("reader");
	expect(attentionFrom(state, 10_000)).toBe("reader");
	expect(attentionEndsAt(state, 0)).toBeNull();
});

test("a tool in flight holds the eyes on the desk however long it takes", () => {
	const state = run([[start("fetch"), 1_000]]);
	expect(attentionFrom(state, 1_000)).toBe("work");
	expect(attentionFrom(state, 60_000)).toBe("work");
	// Nothing to book a timer for: the end of it is an event, not a moment.
	expect(attentionEndsAt(state, 1_000)).toBeNull();
});

test("a tool shorter than the dwell still produces a whole glance", () => {
	const state = run([
		[start("fetch"), 1_000],
		[end("fetch"), 1_050],
	]);
	expect(attentionFrom(state, 1_050)).toBe("work");
	expect(attentionFrom(state, 1_000 + WORK_DWELL_MS - 1)).toBe("work");
	expect(attentionFrom(state, 1_000 + WORK_DWELL_MS)).toBe("reader");
	expect(attentionEndsAt(state, 1_050)).toBe(1_000 + WORK_DWELL_MS);
});

test("a long tool's glance ends a linger after it comes back, not at the dwell", () => {
	const state = run([
		[start("fetch"), 1_000],
		[end("fetch"), 5_000],
	]);
	expect(attentionFrom(state, 5_000 + WORK_LINGER_MS - 1)).toBe("work");
	expect(attentionFrom(state, 5_000 + WORK_LINGER_MS)).toBe("reader");
	expect(attentionEndsAt(state, 5_000)).toBe(5_000 + WORK_LINGER_MS);
});

test("overlapping tools are one glance, ended by the last of them", () => {
	const state = run([
		[start("a"), 1_000],
		[start("b"), 1_100],
		[end("a"), 3_000],
	]);
	expect(attentionFrom(state, 3_000)).toBe("work");
	expect(attentionFrom(state, 99_000)).toBe("work");
	const done = applyActivity(state, end("b"), 4_000);
	expect(attentionFrom(done, 4_000 + WORK_LINGER_MS)).toBe("reader");
});

test("back-to-back tools do not bob the head between them", () => {
	// Two tools with a 20 ms gap: the second starts inside the linger, so the
	// answer never passes through "reader".
	const gap = 20;
	const first: [TurnActivity, number][] = [
		[start("a"), 1_000],
		[end("a"), 2_000],
	];
	let state = run(first);
	const between = 2_000 + gap;
	expect(attentionFrom(state, between)).toBe("work");
	state = applyActivity(state, start("b"), between);
	// The dwell is on the glance, not on each tool: the stretch still counts
	// from the first start.
	expect(state.workSince).toBe(1_000);
	state = applyActivity(state, end("b"), between + 30);
	expect(attentionFrom(state, between + 30)).toBe("work");
	expect(attentionFrom(state, between + 30 + WORK_LINGER_MS)).toBe("reader");
});

test("a tool after the eyes came back is a new glance with a whole dwell", () => {
	let state = run([
		[start("a"), 1_000],
		[end("a"), 1_010],
	]);
	const later = 1_000 + WORK_DWELL_MS + 5_000;
	expect(attentionFrom(state, later)).toBe("reader");
	state = applyActivity(state, start("b"), later);
	expect(state.workSince).toBe(later);
	state = applyActivity(state, end("b"), later + 10);
	expect(attentionFrom(state, later + WORK_DWELL_MS - 1)).toBe("work");
	expect(attentionFrom(state, later + WORK_DWELL_MS)).toBe("reader");
});

test("an end with no start changes nothing", () => {
	const state = applyActivity(noActivity(), end("ghost"), 1_000);
	expect(state).toEqual(noActivity());
	expect(attentionFrom(state, 1_000)).toBe("reader");
});

test("a turn closed twice cannot push the count below zero", () => {
	let state = run([
		[start("a"), 1_000],
		[end("a"), 1_100],
	]);
	state = applyActivity(state, end("a"), 1_200);
	expect(state.running).toBe(0);
	expect(attentionFrom(state, 1_000 + WORK_DWELL_MS)).toBe("reader");
});

test("the dwell covers the scan and the crossfade into it", () => {
	// The check act scans for about 400 ms and acts cross-fade in 280 ms
	// (lumen-motion.ts); a floor under either of those is a twitch.
	expect(WORK_DWELL_MS).toBeGreaterThanOrEqual(400 + 280 - 100);
	expect(WORK_LINGER_MS).toBeLessThan(WORK_DWELL_MS);
});
