// Replaying the voice's own shape against the local clock (docs/45).
//
// The native side hands over one envelope per sentence as it queues it: 0..1 at
// 25 ms a value, and how long until the first sample is heard. Nothing arrives
// per frame — a twenty-minute call crosses a few dozen of these — so the mouth
// is drawn by looking up where the clock is inside the sentence being spoken,
// the same way docs/33 interpolates a character position out of a sentence's
// length.
//
// Display maths in the ui layer, the way orb.ts is: a call is what produces
// these events, but what a mouth does with one is not the call's business.
//
// Why the mouth cannot use the microphone during `speak`. The microphone stays
// open through the whole call (docs/33 M-voice-3), so while the companion talks
// the level it reports is the room plus whatever of the voice leaks back before
// the echo canceller converges. A mouth on that signal opens at the loudest
// thing nearby, which is often not Lumen.

import { clampLevel } from "../orb/orb";
import type { LumenAct } from "./lumen-motion";
import type { SpeechEnvelope } from "../../../soul/voice/conversation";

/**
 * Which of the two signals the body is drawn from this frame. Speaking reads
 * the voice, everything else reads the room — see the note above for why a
 * microphone that is open through the whole call cannot be asked what Lumen is
 * saying.
 */
export function levelFor(act: LumenAct, micLevel: number, voiceLevel: number): number {
	return clampLevel(act === "speak" ? voiceLevel : micLevel);
}

/** One sentence, placed on the local clock. */
export interface QueuedSentence {
	utterance: number;
	sentence: number;
	/** When its first sample is heard, on `performance.now()`. */
	startAtMs: number;
	/** When its last window ends. */
	endAtMs: number;
	windowMs: number;
	values: readonly number[];
}

// How many sentences may wait at once. The relay keeps only a couple of
// sentences ahead of the playhead (plugins/voice/src/tts/relay.rs), so this is
// slack and not a working depth: a loop that was paused while the tab was
// hidden must not come back to an unbounded queue.
export const ENVELOPE_QUEUE_MAX = 16;

export interface EnvelopeQueue {
	/** Sentences not yet finished, oldest first. */
	readonly pending: readonly QueuedSentence[];
	/** The start of the last sentence whose beginning has been announced. */
	readonly startedAtMs: number | null;
}

export const ENVELOPE_EMPTY: EnvelopeQueue = { pending: [], startedAtMs: null };

/**
 * Puts one sentence on the queue, stamped with the moment its event arrived.
 *
 * `startsInMs` is relative on purpose (conversation.ts), so this is where the
 * two clocks meet and the whole of the skew is one event hop. A sentence that
 * repeats an index already queued replaces it rather than doubling it.
 */
export function queueEnvelope(
	queue: EnvelopeQueue,
	envelope: SpeechEnvelope,
	receivedAtMs: number,
): EnvelopeQueue {
	if (!Number.isFinite(receivedAtMs) || envelope.values.length === 0) return queue;
	const windowMs = envelope.windowMs;
	if (!Number.isFinite(windowMs) || windowMs <= 0) return queue;
	// Never negative: a sentence the native side says is already playing starts
	// now, and the lookup below finds it at window zero rather than in the past.
	const startAtMs = receivedAtMs + Math.max(0, envelope.startsInMs);
	const next: QueuedSentence = {
		utterance: envelope.utterance,
		sentence: envelope.sentence,
		startAtMs,
		endAtMs: startAtMs + envelope.values.length * windowMs,
		windowMs,
		values: envelope.values.map(clampLevel),
	};
	const kept = queue.pending.filter(
		(s) => s.utterance !== next.utterance || s.sentence !== next.sentence,
	);
	kept.push(next);
	kept.sort((a, b) => a.startAtMs - b.startAtMs);
	return {
		pending: kept.length > ENVELOPE_QUEUE_MAX ? kept.slice(kept.length - ENVELOPE_QUEUE_MAX) : kept,
		startedAtMs: queue.startedAtMs,
	};
}

/**
 * Nothing queued will be heard. A barge-in stops the player on the native side
 * before the webview knows (plugins/voice/README.md), and the sentences already
 * handed over would otherwise go on moving a mouth over silence.
 */
export function clearEnvelope(queue: EnvelopeQueue): EnvelopeQueue {
	return queue.pending.length === 0 && queue.startedAtMs === null ? queue : ENVELOPE_EMPTY;
}

export interface EnvelopeRead {
	queue: EnvelopeQueue;
	/** 0..1 where the clock is inside the sentence being heard, 0 between them. */
	level: number;
	/** A sentence began since the last read. One bounce, on its first frame. */
	started: boolean;
}

/**
 * Where the voice is at `nowMs`. Pure: the caller supplies the clock, so a test
 * states the time instead of waiting for it.
 *
 * Finished sentences are dropped as they are passed, so the queue is the future
 * and the present and never the past. Between two sentences the answer is 0 and
 * not the last value held — the hold that keeps the mouth from chattering
 * through the gaps is `mouthOpenness`'s, on the orb's own SILENCE_HOLD_MS, and
 * two holds over one signal would be a mouth that never shuts.
 */
export function readEnvelope(queue: EnvelopeQueue, nowMs: number): EnvelopeRead {
	if (queue.pending.length === 0 || !Number.isFinite(nowMs)) {
		return { queue, level: 0, started: false };
	}
	let level = 0;
	let startedAtMs = queue.startedAtMs;
	let started = false;
	const pending: QueuedSentence[] = [];
	for (const s of queue.pending) {
		if (s.endAtMs <= nowMs) continue;
		pending.push(s);
		if (s.startAtMs > nowMs) continue;
		// Playing right now. The last one wins: two sentences can only overlap if
		// the player fell behind what it said it would do, and the newer stamp is
		// the better guess at what is in the air.
		const i = Math.min(
			s.values.length - 1,
			Math.max(0, Math.floor((nowMs - s.startAtMs) / s.windowMs)),
		);
		level = s.values[i] ?? 0;
		if (startedAtMs === null || s.startAtMs > startedAtMs) {
			startedAtMs = s.startAtMs;
			started = true;
		}
	}
	if (!started && pending.length === queue.pending.length) {
		return { queue, level, started: false };
	}
	return { queue: { pending, startedAtMs }, level, started };
}
