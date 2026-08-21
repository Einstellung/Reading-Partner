// The store behind the transcript's scroll memory. Module state, so every test
// clears it first — a leftover entry from the test above is a passing assertion
// about the wrong thing.

import { beforeEach, expect, test } from "bun:test";
import {
	clearScrollMemory,
	forgetScroll,
	recallScroll,
	rememberScroll,
	scrollMemory,
} from "../../../src/ui/components/common/scroll-memory";

const AT = { top: 200, stuck: false };

beforeEach(clearScrollMemory);

test("a list nothing was recorded for opens at the newest message", () => {
	expect(recallScroll("thread-a")).toBe(null);
});

test("a remembered place comes back, and comes back again", () => {
	rememberScroll("thread-a", AT);
	// The reader may swap out to the page and back any number of times inside one
	// call, so recalling must not consume the entry.
	expect(recallScroll("thread-a")).toEqual(AT);
	expect(recallScroll("thread-a")).toEqual(AT);
});

test("forgetting one list leaves the others", () => {
	rememberScroll("thread-a", AT);
	rememberScroll("thread-b", { top: 40, stuck: true });
	forgetScroll("thread-a");
	expect(recallScroll("thread-a")).toBe(null);
	expect(recallScroll("thread-b")).toEqual({ top: 40, stuck: true });
});

test("a call that ended empties the store", () => {
	rememberScroll("thread-a", AT);
	rememberScroll("thread-b", AT);
	clearScrollMemory();
	expect(recallScroll("thread-a")).toBe(null);
	expect(recallScroll("thread-b")).toBe(null);
});

test("past the cap the least recently written entry goes", () => {
	for (let i = 0; i < 16; i++) rememberScroll(`t${i}`, { top: i, stuck: false });
	rememberScroll("t16", AT);
	expect(recallScroll("t0")).toBe(null);
	expect(recallScroll("t1")).toEqual({ top: 1, stuck: false });
	expect(recallScroll("t16")).toEqual(AT);
});

test("writing a key again makes it the most recent", () => {
	for (let i = 0; i < 16; i++) rememberScroll(`t${i}`, { top: i, stuck: false });
	// The thread the reader is scrolling in, which the eviction would otherwise
	// have taken next.
	rememberScroll("t0", AT);
	rememberScroll("t16", AT);
	expect(recallScroll("t0")).toEqual(AT);
	expect(recallScroll("t1")).toBe(null);
});

test("a list with no key gets no seams, so the pin is untouched", () => {
	expect(scrollMemory(undefined)).toEqual({});
});

test("a keyed list gets both seams, and they run through the store", () => {
	const seams = scrollMemory("thread-a");
	expect(seams.restore?.()).toBe(null);
	seams.remember?.(AT);
	expect(recallScroll("thread-a")).toEqual(AT);
	expect(seams.restore?.()).toEqual(AT);
});
