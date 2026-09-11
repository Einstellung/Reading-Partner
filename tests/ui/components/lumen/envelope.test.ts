// Replaying a sentence's envelope against the local clock
// (src/ui/components/lumen/envelope.ts). The whole point of the module is that
// it answers "where is the voice right now" from a stamp and an array, so every
// case here is a clock reading and not a wait.
//
// Run: bun test.

import { expect, test } from "bun:test";

import {
	ENVELOPE_EMPTY,
	ENVELOPE_QUEUE_MAX,
	clearEnvelope,
	levelFor,
	queueEnvelope,
	readEnvelope,
} from "../../../../src/ui/components/lumen/envelope";
import type { SpeechEnvelope } from "../../../../src/info/briefer/conversation";

const WINDOW = 25;

function sentence(
	values: number[],
	{ utterance = 1, sentence = 0, startsInMs = 0, windowMs = WINDOW } = {},
): SpeechEnvelope {
	return { utterance, sentence, startsInMs, windowMs, values };
}

test("a sentence that has not started yet is silence", () => {
	const q = queueEnvelope(ENVELOPE_EMPTY, sentence([1, 1, 1], { startsInMs: 200 }), 1000);
	const read = readEnvelope(q, 1199);
	expect(read.level).toBe(0);
	expect(read.started).toBe(false);
	// Still queued: it has not been heard, so it must not be pruned.
	expect(read.queue.pending.length).toBe(1);
});

test("each window is read for exactly its own span", () => {
	const q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.2, 0.5, 0.9]), 0);
	expect(readEnvelope(q, 0).level).toBe(0.2);
	expect(readEnvelope(q, WINDOW - 0.001).level).toBe(0.2);
	expect(readEnvelope(q, WINDOW).level).toBe(0.5);
	expect(readEnvelope(q, 2 * WINDOW).level).toBe(0.9);
	expect(readEnvelope(q, 3 * WINDOW - 0.001).level).toBe(0.9);
});

test("past the last window the sentence is gone and the level is zero", () => {
	const q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.4, 0.4]), 0);
	const read = readEnvelope(q, 2 * WINDOW);
	expect(read.level).toBe(0);
	expect(read.queue.pending.length).toBe(0);
});

test("a sentence whose start is already behind is read from the matching window", () => {
	// The native side never sends a negative delay, but the event still takes a
	// hop to arrive, and a harness can say "now".
	const q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.1, 0.2, 0.3, 0.4], { startsInMs: -500 }), 1000);
	// Stamped at arrival rather than 500 ms ago: the first window is the one
	// being heard.
	expect(readEnvelope(q, 1000).level).toBe(0.1);
	expect(readEnvelope(q, 1000 + 2 * WINDOW).level).toBe(0.3);
});

test("the start of a sentence is announced once", () => {
	let q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.5, 0.5, 0.5, 0.5]), 0);
	const first = readEnvelope(q, 0);
	expect(first.started).toBe(true);
	q = first.queue;
	const second = readEnvelope(q, WINDOW);
	expect(second.started).toBe(false);
	expect(second.level).toBe(0.5);
});

test("the second sentence announces its own start", () => {
	let q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.5, 0.5]), 0);
	q = queueEnvelope(q, sentence([0.7, 0.7], { sentence: 1, startsInMs: 2 * WINDOW }), 0);
	const a = readEnvelope(q, 0);
	expect(a.started).toBe(true);
	const b = readEnvelope(a.queue, 2 * WINDOW);
	expect(b.started).toBe(true);
	expect(b.level).toBe(0.7);
	expect(readEnvelope(b.queue, 2 * WINDOW + 1).started).toBe(false);
});

test("a sentence that arrived twice is played once", () => {
	let q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.3, 0.3]), 0);
	q = queueEnvelope(q, sentence([0.8, 0.8]), 0);
	expect(q.pending.length).toBe(1);
	expect(readEnvelope(q, 0).level).toBe(0.8);
});

test("the queue is bounded", () => {
	let q = ENVELOPE_EMPTY;
	for (let i = 0; i < ENVELOPE_QUEUE_MAX + 5; i++) {
		q = queueEnvelope(q, sentence([0.5], { sentence: i, startsInMs: 10_000 + i * WINDOW }), 0);
	}
	expect(q.pending.length).toBe(ENVELOPE_QUEUE_MAX);
	// The newest survive: they are the ones still to be heard.
	expect(q.pending[q.pending.length - 1]?.sentence).toBe(ENVELOPE_QUEUE_MAX + 4);
});

test("a barge-in drops everything queued", () => {
	let q = queueEnvelope(ENVELOPE_EMPTY, sentence([0.9, 0.9, 0.9]), 0);
	q = clearEnvelope(q);
	const read = readEnvelope(q, WINDOW);
	expect(read.level).toBe(0);
	expect(read.started).toBe(false);
});

test("a value that is not a number does not poison the mouth", () => {
	const q = queueEnvelope(
		ENVELOPE_EMPTY,
		sentence([Number.NaN, 2, -1] as number[]),
		0,
	);
	expect(readEnvelope(q, 0).level).toBe(0);
	expect(readEnvelope(q, WINDOW).level).toBe(1);
	expect(readEnvelope(q, 2 * WINDOW).level).toBe(0);
});

test("an envelope with no values and one with no window are refused", () => {
	expect(queueEnvelope(ENVELOPE_EMPTY, sentence([]), 0)).toBe(ENVELOPE_EMPTY);
	expect(queueEnvelope(ENVELOPE_EMPTY, sentence([1], { windowMs: 0 }), 0)).toBe(ENVELOPE_EMPTY);
});

test("only speaking reads the voice; every other act reads the room", () => {
	expect(levelFor("speak", 0.9, 0.2)).toBe(0.2);
	expect(levelFor("listen", 0.9, 0.2)).toBe(0.9);
	expect(levelFor("rest", 0.9, 0.2)).toBe(0.9);
	expect(levelFor("think", 0.9, 0.2)).toBe(0.9);
	expect(levelFor("check", 0.9, 0.2)).toBe(0.9);
});
