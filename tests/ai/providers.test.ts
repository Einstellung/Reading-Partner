// Unit tests for the streaming core (src/ai/providers.ts streamChatCore),
// driven by a scripted fake SimpleStreamFn so no provider, auth, or network is
// involved. Covers reasoning pass-through, "off" omission, and that thinking
// deltas are a liveness/side signal that never leaks into the visible reply.
// Run: bun test.

import { expect, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Api,
	type AssistantMessageEvent,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamChatCore, type SimpleStreamFn } from "../../src/ai/providers";

const MODEL = {} as Model<Api>;

// A fake stream that records the options it was handed and replays `events`.
function recordingStream(events: AssistantMessageEvent[]): {
	fn: SimpleStreamFn;
	options: () => SimpleStreamOptions | undefined;
	context: () => Context | undefined;
} {
	let seenOptions: SimpleStreamOptions | undefined;
	let seenContext: Context | undefined;
	const fn: SimpleStreamFn = (_model, context, options) => {
		seenOptions = options;
		seenContext = context;
		const stream = createAssistantMessageEventStream();
		(async () => {
			for (const ev of events) {
				await Promise.resolve();
				stream.push(ev);
			}
			stream.end();
		})();
		return stream;
	};
	return { fn, options: () => seenOptions, context: () => seenContext };
}

function textDelta(delta: string): AssistantMessageEvent {
	return { type: "text_delta", contentIndex: 0, delta, partial: fauxAssistantMessage(delta) };
}

function thinkingDelta(delta: string): AssistantMessageEvent {
	return { type: "thinking_delta", contentIndex: 0, delta, partial: fauxAssistantMessage("") };
}

function collect() {
	const deltas: string[] = [];
	const thinking: string[] = [];
	let done: string | undefined;
	let error: string | undefined;
	return {
		onDelta: (t: string) => deltas.push(t),
		onThinking: (t: string) => thinking.push(t),
		onDone: (t: string) => {
			done = t;
		},
		onError: (m: string) => {
			error = m;
		},
		get deltas() {
			return deltas;
		},
		get thinking() {
			return thinking;
		},
		get done() {
			return done;
		},
		get error() {
			return error;
		},
	};
}

test("passes the reasoning level through to the stream options", async () => {
	const rec = recordingStream([textDelta("hi"), textDelta(" there")]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		reasoning: "high",
		onDelta: c.onDelta,
		onThinking: c.onThinking,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(rec.options()?.reasoning).toBe("high");
	expect(c.done).toBe("hi there");
	expect(c.error).toBeUndefined();
});

test('"off" (reasoning undefined) omits reasoning from the options', async () => {
	const rec = recordingStream([textDelta("ok")]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		// reasoning omitted
		onDelta: c.onDelta,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(rec.options()?.reasoning).toBeUndefined();
	expect(c.done).toBe("ok");
});

test("thinking deltas go to onThinking and never into the visible reply", async () => {
	const rec = recordingStream([
		thinkingDelta("let me reason"),
		thinkingDelta(" some more"),
		textDelta("the answer"),
	]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		reasoning: "medium",
		onDelta: c.onDelta,
		onThinking: c.onThinking,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(c.thinking).toEqual(["let me reason", " some more"]);
	// The visible reply and the final text carry only the text delta.
	expect(c.deltas).toEqual(["the answer"]);
	expect(c.done).toBe("the answer");
});

test("thinking without an onThinking handler is simply dropped, reply stays clean", async () => {
	const rec = recordingStream([thinkingDelta("hidden"), textDelta("visible")]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		reasoning: "low",
		onDelta: c.onDelta,
		// no onThinking
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(c.deltas).toEqual(["visible"]);
	expect(c.done).toBe("visible");
});
