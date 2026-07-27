// Unit tests for the streaming core (src/ai/providers.ts streamChatCore),
// driven by a scripted fake SimpleStreamFn so no provider, auth, or network is
// involved. Covers reasoning pass-through, "off" omission, that thinking deltas
// are a liveness/side signal that never leaks into the visible reply, and that
// the accounting pi attaches to a turn (the AssistantMessage on done/error, the
// response head) reaches the caller instead of being flattened to a string.
// Run: bun test.

import { expect, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	type Model,
	type ProviderResponse,
	type SimpleStreamOptions,
	type Usage,
} from "@earendil-works/pi-ai";
import { DEFAULT_MAX_RETRIES, streamChatCore, type SimpleStreamFn } from "../../src/ai/providers";

const MODEL = {} as Model<Api>;

const USAGE: Usage = {
	input: 1200,
	output: 340,
	cacheRead: 900,
	cacheWrite: 0,
	totalTokens: 2440,
	cost: { input: 0.0036, output: 0.0051, cacheRead: 0.00027, cacheWrite: 0, total: 0.00897 },
};

function finished(text: string, over: Partial<AssistantMessage> = {}): AssistantMessage {
	return { ...fauxAssistantMessage(text), usage: USAGE, responseId: "resp_123", ...over };
}

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
	let outcome: AssistantMessage | undefined;
	return {
		onDelta: (t: string) => deltas.push(t),
		onThinking: (t: string) => thinking.push(t),
		onDone: (t: string, a?: AssistantMessage) => {
			done = t;
			outcome = a;
		},
		onError: (m: string, a?: AssistantMessage) => {
			error = m;
			outcome = a;
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
		// The AssistantMessage handed to whichever of onDone/onError fired.
		get outcome() {
			return outcome;
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

test("the opening request carries a retry budget, since pi's own default is none", async () => {
	const rec = recordingStream([textDelta("ok")]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		onDelta: c.onDelta,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(DEFAULT_MAX_RETRIES).toBeGreaterThan(0);
	expect(rec.options()?.maxRetries).toBe(DEFAULT_MAX_RETRIES);
	// Left at pi's default so a server asking for a very long wait still fails
	// fast, into the watchdog's hands rather than into a silent hour-long sleep.
	expect(rec.options()?.maxRetryDelayMs).toBeUndefined();
});

test("an explicit retry budget wins over the default, including zero", async () => {
	const rec = recordingStream([textDelta("ok")]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		maxRetries: 0,
		onDelta: c.onDelta,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(rec.options()?.maxRetries).toBe(0);
});

test("the done event's AssistantMessage reaches onDone with its usage and response id", async () => {
	const message = finished("hi there");
	const rec = recordingStream([
		textDelta("hi"),
		textDelta(" there"),
		{ type: "done", reason: "stop", message },
	]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		onDelta: c.onDelta,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(c.done).toBe("hi there");
	expect(c.outcome).toBe(message);
	expect(c.outcome?.usage.totalTokens).toBe(2440);
	expect(c.outcome?.usage.cost.total).toBeCloseTo(0.00897);
	expect(c.outcome?.responseId).toBe("resp_123");
});

test("a stream that ends without a done event still finishes on the accumulated text", async () => {
	const rec = recordingStream([textDelta("no done event")]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		onDelta: c.onDelta,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(c.done).toBe("no done event");
	expect(c.outcome).toBeUndefined();
	expect(c.error).toBeUndefined();
});

test("the error event's AssistantMessage reaches onError, not just its text", async () => {
	const error = finished("", {
		stopReason: "error",
		errorMessage: "503 Service Unavailable",
	});
	const rec = recordingStream([textDelta("partial"), { type: "error", reason: "error", error }]);
	const c = collect();
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		onDelta: c.onDelta,
		onDone: c.onDone,
		onError: c.onError,
	});
	expect(c.error).toBe("503 Service Unavailable");
	expect(c.outcome).toBe(error);
	expect(c.outcome?.stopReason).toBe("error");
	// The partial turn still accounts for the tokens it burned.
	expect(c.outcome?.usage.input).toBe(1200);
	expect(c.done).toBeUndefined();
});

test("the response head is handed to the provider so request ids are reachable", async () => {
	const rec = recordingStream([textDelta("ok")]);
	const c = collect();
	const heads: ProviderResponse[] = [];
	await streamChatCore({
		stream: rec.fn,
		model: MODEL,
		messages: [],
		onDelta: c.onDelta,
		onResponse: (response) => heads.push(response),
		onDone: c.onDone,
		onError: c.onError,
	});
	const forwarded = rec.options()?.onResponse;
	expect(forwarded).toBeDefined();
	await forwarded?.(
		{ status: 200, headers: { "request-id": "req_abc", "anthropic-ratelimit-requests-remaining": "42" } },
		MODEL,
	);
	expect(heads).toEqual([
		{ status: 200, headers: { "request-id": "req_abc", "anthropic-ratelimit-requests-remaining": "42" } },
	]);
});
