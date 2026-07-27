// Unit tests for the agent loop core (src/ai/agent.ts). The loop is driven by a
// scripted fake stream so no provider, auth, or network is involved. Run: bun test.
//
// Kept out of src/ so the shell's `tsc --noEmit` (include: ["src"]) doesn't try to
// typecheck the bun:test import, which has no ambient types in this project.

import { expect, test } from "bun:test";
import {
	Type,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	type Message,
	type Model,
	type Api,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { runAgentLoop, type AgentCallbacks, type AgentTool, type StreamFn } from "../../src/ai/agent";
import { DEFAULT_MAX_RETRIES } from "../../src/ai/providers";
import {
	contextBudget,
	estimateContextTokens,
	piBudget,
	REFUSE_EXHAUSTED,
} from "../../src/budget";

// A scripted model turn: either a `done` (optional text + optional tool calls)
// or an `error` event. Text is emitted as a single text_delta before `done`.
// `usage` sets the finished message's reported total, which is what makes pi's
// estimator switch to its usage shortcut on the next round.
type ToolReq = { name: string; args: Record<string, any>; id?: string };
type Turn =
	| { text?: string; calls?: ToolReq[]; usage?: number }
	| { error: string; reason?: "error" | "aborted"; text?: string };

function turnEvents(turn: Turn): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];
	if (turn.text) {
		const partial = fauxAssistantMessage(turn.text);
		events.push({ type: "text_delta", contentIndex: 0, delta: turn.text, partial });
	}
	if ("error" in turn) {
		const errMsg = fauxAssistantMessage(turn.text ?? "", { stopReason: "error", errorMessage: turn.error });
		events.push({ type: "error", reason: turn.reason ?? "error", error: errMsg });
		return events;
	}
	const blocks = [
		...(turn.text ? [fauxText(turn.text)] : []),
		...(turn.calls ?? []).map((c) => fauxToolCall(c.name, c.args, { id: c.id })),
	];
	const hasCalls = (turn.calls ?? []).length > 0;
	const message: AssistantMessage = fauxAssistantMessage(blocks.length ? blocks : "", {
		stopReason: hasCalls ? "toolUse" : "stop",
	});
	if (turn.usage) message.usage = { ...message.usage, input: turn.usage, totalTokens: turn.usage };
	events.push({ type: "done", reason: hasCalls ? "toolUse" : "stop", message });
	return events;
}

// Builds a StreamFn that replays `turns` one per call, recording the Context it
// was handed each round (so tests can assert tool results were fed back). Events
// are pushed asynchronously so an abort can interleave with consumption.
function scriptStream(
	turns: Turn[],
	hook?: (round: number, context: Context) => void,
): { fn: StreamFn; calls: () => number; contexts: Context[] } {
	let round = 0;
	const contexts: Context[] = [];
	const fn: StreamFn = (_model, context, _options) => {
		const i = round++;
		contexts.push(context);
		hook?.(i, context);
		const stream = createAssistantMessageEventStream();
		const events = turnEvents(turns[i] ?? { error: "no scripted turn" });
		(async () => {
			for (const ev of events) {
				await Promise.resolve();
				stream.push(ev);
			}
			stream.end();
		})();
		return stream;
	};
	return { fn, calls: () => round, contexts };
}

const MODEL = {} as Model<Api>;

function collectCallbacks() {
	const deltas: string[] = [];
	const toolStarts: { name: string; args: Record<string, any> }[] = [];
	const toolEnds: { name: string; resultPreview: string; isError: boolean }[] = [];
	let done: string | undefined;
	let error: string | undefined;
	let outcome: AssistantMessage | undefined;
	const cb: AgentCallbacks = {
		onDelta: (t) => deltas.push(t),
		onToolStart: (i) => toolStarts.push(i),
		onToolEnd: (i) => toolEnds.push(i),
		onDone: (t, a) => {
			done = t;
			outcome = a;
		},
		onError: (m, a) => {
			error = m;
			outcome = a;
		},
	};
	return {
		cb,
		get deltas() {
			return deltas;
		},
		get toolStarts() {
			return toolStarts;
		},
		get toolEnds() {
			return toolEnds;
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

const echoTool: AgentTool = {
	name: "echo",
	description: "Echo the value back",
	parameters: Type.Object({ value: Type.String() }),
	execute: async (args) => `echo:${args.value}`,
};

function toolResultTexts(messages: Message[]): string[] {
	return messages
		.filter((m): m is Extract<Message, { role: "toolResult" }> => m.role === "toolResult")
		.flatMap((m) => m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text));
}

test("happy path: one tool round then a final answer", async () => {
	const script = scriptStream([
		{ text: "let me check", calls: [{ name: "echo", args: { value: "hi" }, id: "t1" }] },
		{ text: "the answer is hi" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "say hi", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("the answer is hi");
	expect(c.error).toBeUndefined();
	expect(c.toolStarts).toEqual([{ name: "echo", args: { value: "hi" } }]);
	expect(c.toolEnds).toEqual([{ name: "echo", resultPreview: "echo:hi", isError: false }]);
	// The second turn's context must carry the tool result fed back to the model.
	expect(toolResultTexts(script.contexts[1].messages)).toContain("echo:hi");
	expect(script.calls()).toBe(2);
});

test("multi-round: two tool rounds before answering", async () => {
	const script = scriptStream([
		{ calls: [{ name: "echo", args: { value: "a" }, id: "t1" }] },
		{ calls: [{ name: "echo", args: { value: "b" }, id: "t2" }] },
		{ text: "done" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("done");
	expect(c.toolEnds.map((t) => t.resultPreview)).toEqual(["echo:a", "echo:b"]);
	expect(script.calls()).toBe(3);
	// Round 2's context has round 1's result; round 3's has both.
	expect(toolResultTexts(script.contexts[2].messages)).toEqual(["echo:a", "echo:b"]);
});

test("a throwing execute becomes a tool-result error, not a crash", async () => {
	const boom: AgentTool = {
		name: "boom",
		description: "always throws",
		parameters: Type.Object({}),
		execute: async () => {
			throw new Error("kaboom");
		},
	};
	const script = scriptStream([
		{ calls: [{ name: "boom", args: {}, id: "t1" }] },
		{ text: "recovered" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [boom],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("recovered");
	expect(c.error).toBeUndefined();
	expect(c.toolEnds).toEqual([{ name: "boom", resultPreview: "kaboom", isError: true }]);
	// The error text is fed back to the model as the tool result.
	const results = script.contexts[1].messages.filter((m) => m.role === "toolResult");
	expect(results[0]).toMatchObject({ isError: true });
	expect(toolResultTexts(script.contexts[1].messages)).toContain("kaboom");
});

test("aborted stream event stops the loop with no onDone/onError", async () => {
	// pi reports a mid-stream abort as an error event with reason "aborted",
	// arriving after whatever partial text already streamed.
	const script = scriptStream([
		{ text: "partial", error: "aborted", reason: "aborted" },
		{ text: "should never run" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.deltas).toEqual(["partial"]);
	expect(c.done).toBeUndefined();
	expect(c.error).toBeUndefined();
	// The loop stopped; the second turn was never requested.
	expect(script.calls()).toBe(1);
});

test("abort during a tool stops before the next round", async () => {
	const controller = new AbortController();
	const abortingTool: AgentTool = {
		name: "echo",
		description: "aborts mid-execution",
		parameters: Type.Object({ value: Type.String() }),
		execute: async (args) => {
			controller.abort();
			return `echo:${args.value}`;
		},
	};
	const script = scriptStream([
		{ calls: [{ name: "echo", args: { value: "x" }, id: "t1" }] },
		{ text: "should never run" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [abortingTool],
		signal: controller.signal,
		maxRounds: 8,
		...c.cb,
	});

	expect(c.toolEnds).toEqual([{ name: "echo", resultPreview: "echo:x", isError: false }]);
	expect(c.done).toBeUndefined();
	expect(c.error).toBeUndefined();
	// The tool ran (round 1) but the second model turn was never requested.
	expect(script.calls()).toBe(1);
});

test("round cap surfaces a clear error", async () => {
	const script = scriptStream([
		{ calls: [{ name: "echo", args: { value: "a" }, id: "t1" }] },
		{ calls: [{ name: "echo", args: { value: "b" }, id: "t2" }] },
		{ calls: [{ name: "echo", args: { value: "c" }, id: "t3" }] },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "loop forever", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 2,
		...c.cb,
	});

	expect(c.done).toBeUndefined();
	expect(c.error).toContain("2 tool rounds");
	// Exactly maxRounds model turns were streamed.
	expect(script.calls()).toBe(2);
});

test("a tool result with images is fed back as image content (M9)", async () => {
	const viewFigure: AgentTool = {
		name: "view_figure",
		description: "returns a figure image",
		parameters: Type.Object({ id: Type.String() }),
		execute: async () => ({ text: "Figure 3", images: [{ data: "ABCD", mimeType: "image/jpeg" }] }),
	};
	const script = scriptStream([
		{ calls: [{ name: "view_figure", args: { id: "3" }, id: "t1" }] },
		{ text: "it shows a pipeline" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "what is figure 3", timestamp: 0 }],
		tools: [viewFigure],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("it shows a pipeline");
	// The trace preview uses the text; the image rides the tool-result content.
	expect(c.toolEnds).toEqual([{ name: "view_figure", resultPreview: "Figure 3", isError: false }]);
	const results = script.contexts[1].messages.filter((m) => m.role === "toolResult");
	expect(results[0].content).toEqual([
		{ type: "text", text: "Figure 3" },
		{ type: "image", data: "ABCD", mimeType: "image/jpeg" },
	]);
});

test("reasoning is forwarded to the stream options each round", async () => {
	const seen: (SimpleStreamOptions | undefined)[] = [];
	const stream: StreamFn = (_model, _context, options) => {
		seen.push(options);
		const s = createAssistantMessageEventStream();
		const events = turnEvents(seen.length === 1
			? { calls: [{ name: "echo", args: { value: "x" }, id: "t1" }] }
			: { text: "done" });
		(async () => {
			for (const ev of events) {
				await Promise.resolve();
				s.push(ev);
			}
			s.end();
		})();
		return s;
	};
	const c = collectCallbacks();

	await runAgentLoop({
		stream,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		reasoning: "high",
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("done");
	// Both the initial turn and the post-tool turn carry the reasoning level.
	expect(seen.map((o) => o?.reasoning)).toEqual(["high", "high"]);
});

test("thinking deltas go to onThinking, never onDelta or the final answer", async () => {
	const stream: StreamFn = (_model, _context, _options) => {
		const s = createAssistantMessageEventStream();
		const msg = fauxAssistantMessage("visible", { stopReason: "stop" });
		(async () => {
			await Promise.resolve();
			s.push({ type: "thinking_delta", contentIndex: 0, delta: "pondering", partial: fauxAssistantMessage("") });
			await Promise.resolve();
			s.push({ type: "text_delta", contentIndex: 0, delta: "visible", partial: msg });
			await Promise.resolve();
			s.push({ type: "done", reason: "stop", message: msg });
			s.end();
		})();
		return s;
	};
	const thinking: string[] = [];
	const c = collectCallbacks();

	await runAgentLoop({
		stream,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
		onThinking: (t) => thinking.push(t),
	});

	expect(thinking).toEqual(["pondering"]);
	expect(c.deltas).toEqual(["visible"]);
	expect(c.done).toBe("visible");
});

test("plain answer with no tools calls onDone directly", async () => {
	const script = scriptStream([{ text: "hello world" }]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("hello world");
	expect(c.toolStarts).toEqual([]);
	expect(script.calls()).toBe(1);
});

test("the final round's AssistantMessage reaches onDone with its usage", async () => {
	const message = fauxAssistantMessage("all done", { stopReason: "stop", responseId: "resp_9" });
	message.usage = { ...message.usage, input: 800, output: 120, totalTokens: 920 };
	const stream: StreamFn = () => {
		const s = createAssistantMessageEventStream();
		(async () => {
			await Promise.resolve();
			s.push({ type: "done", reason: "stop", message });
			s.end();
		})();
		return s;
	};
	const c = collectCallbacks();

	await runAgentLoop({
		stream,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("all done");
	expect(c.outcome).toBe(message);
	expect(c.outcome?.usage.totalTokens).toBe(920);
	expect(c.outcome?.responseId).toBe("resp_9");
});

test("a stream error hands its AssistantMessage to onError alongside the text", async () => {
	const script = scriptStream([{ error: "overloaded_error: server is overloaded" }]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.error).toBe("overloaded_error: server is overloaded");
	expect(c.outcome?.stopReason).toBe("error");
	expect(c.outcome?.errorMessage).toBe("overloaded_error: server is overloaded");
});

test("the response head is forwarded to every round's stream options", async () => {
	const seen: (SimpleStreamOptions | undefined)[] = [];
	const script = scriptStream([
		{ text: "checking", calls: [{ name: "echo", args: { value: "x" }, id: "t1" }] },
		{ text: "done" },
	]);
	const stream: StreamFn = (model, context, options) => {
		seen.push(options);
		return script.fn(model, context, options);
	};
	const c = collectCallbacks();
	const heads: number[] = [];

	await runAgentLoop({
		stream,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
		onResponse: (response) => heads.push(response.status),
	});

	expect(seen.length).toBe(2);
	for (const options of seen) {
		expect(options?.onResponse).toBeDefined();
		await options?.onResponse?.({ status: 200, headers: {} }, MODEL);
	}
	expect(heads).toEqual([200, 200]);
});

test("every round opens its request with a retry budget", async () => {
	const seen: (SimpleStreamOptions | undefined)[] = [];
	const script = scriptStream([
		{ text: "checking", calls: [{ name: "echo", args: { value: "x" }, id: "t1" }] },
		{ text: "done" },
	]);
	const stream: StreamFn = (model, context, options) => {
		seen.push(options);
		return script.fn(model, context, options);
	};
	const c = collectCallbacks();

	await runAgentLoop({
		stream,
		model: MODEL,
		messages: [{ role: "user", content: "go", timestamp: 0 }],
		tools: [echoTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(seen.map((o) => o?.maxRetries)).toEqual([DEFAULT_MAX_RETRIES, DEFAULT_MAX_RETRIES]);
});

// --- fitting each round to the model's context window (src/budget) ---
//
// Every test above runs on a model with no declared window, so those rounds are
// unmeasured by construction. These give the loop a real one.

const WINDOW = 200_000;

function sizedModel(contextWindow: number): Model<Api> {
	return { id: "m", name: "m", contextWindow, maxTokens: 64_000 } as unknown as Model<Api>;
}

// A tool that hands back as much Chinese text as it is asked for: the shape that
// makes the two estimates disagree, since pi charges every script chars/4.
const pagesTool: AgentTool = {
	name: "read_pages",
	description: "Return pages of the book",
	parameters: Type.Object({ chars: Type.Number() }),
	execute: async (args) => "章".repeat(args.chars),
};

function isStub(text: string): boolean {
	return text.startsWith("[read_pages:") && text.includes("dropped to fit");
}

// The trap this pins. `contextBudget` plans against max(pi, script-aware), and
// the two are the same currency only while pi is counting characters. From the
// second round the array carries a real AssistantMessage with usage, pi's
// estimator switches to that number for the entire prefix — system prompt
// included, which it then stops counting at all — and the two numbers stop being
// comparable. A saving computed script-aware therefore cannot be subtracted from
// `used`; the loop applies its reduction and measures again instead.
test("from round two pi prices the prefix from usage, not from the characters", () => {
	const m = sizedModel(WINDOW);
	const book = "张".repeat(60_000);
	const answered = fauxAssistantMessage([fauxToolCall("read_pages", { chars: 8 }, { id: "t1" })], {
		stopReason: "toolUse",
		timestamp: 2,
	});
	const messages: Message[] = [
		{ role: "user", content: "explain this", timestamp: 1 },
		{ ...answered, usage: { ...answered.usage, input: 190_000, totalTokens: 190_000 } },
		{
			role: "toolResult",
			toolCallId: "t1",
			toolName: "read_pages",
			content: [{ type: "text", text: "章".repeat(8) }],
			isError: false,
			timestamp: 3,
		},
	];
	const ctx: Context = { systemPrompt: book, messages };

	// Script-aware: a 60k-token book and a round with plenty of room left.
	expect(estimateContextTokens(ctx)).toBeLessThan(61_000);
	// pi: the provider's own count stands in for everything up to that turn.
	expect(piBudget(m, ctx).tokens).toBeGreaterThan(189_000);
	expect(piBudget(m, ctx).saturated).toBe(false);
	// So the number the call is planned against is pi's, while any saving the
	// ladder could quote would still be in the other currency.
	expect(contextBudget(m, ctx).used).toBe(piBudget(m, ctx).tokens);
});

test("a round pi would clamp to one token is refused instead of sent", async () => {
	const script = scriptStream([
		// Round one fits: pi reads the Chinese system prompt as 15k tokens, the
		// script-aware estimate as 60k, and 200k less 60k leaves room to answer.
		// The provider then reports what it really cost.
		{ calls: [{ name: "read_pages", args: { chars: 8 }, id: "t1" }], usage: 197_000 },
		{ text: "never asked" },
	]);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: sizedModel(WINDOW),
		systemPrompt: "张".repeat(60_000),
		messages: [{ role: "user", content: "explain this", timestamp: 1 }],
		tools: [pagesTool],
		maxRounds: 8,
		...c.cb,
	});

	// Round two would have gone out with an allowance of 1: one token back, a
	// normal `done`, no error (docs/pitfall/65). It is never sent.
	expect(script.calls()).toBe(1);
	expect(c.done).toBeUndefined();
	expect(c.error).toBe(REFUSE_EXHAUSTED);
});

test("a round over the line on the script-aware count is rescued by stubbing old tool results", async () => {
	const big = (id: string) => ({ name: "read_pages", args: { chars: 33_000 }, id });
	// Snapshotted as each round goes out: the loop keeps appending to the array it
	// sent, so a recorded Context read afterwards shows the end state.
	const sent: string[][] = [];
	const script = scriptStream(
		[
			// Six chapters at once: 198k script-aware tokens of Chinese, which pi
			// prices at 49.5k and would happily send.
			{ calls: ["t1", "t2", "t3", "t4", "t5", "t6"].map(big) },
			{ calls: [{ name: "read_pages", args: { chars: 200 }, id: "t7" }] },
			{ text: "here is the answer" },
		],
		(_round, context) => sent.push(toolResultTexts(context.messages)),
	);
	const c = collectCallbacks();

	await runAgentLoop({
		stream: script.fn,
		model: sizedModel(WINDOW),
		messages: [{ role: "user", content: "explain this", timestamp: 1 }],
		tools: [pagesTool],
		maxRounds: 8,
		...c.cb,
	});

	expect(c.done).toBe("here is the answer");
	expect(script.calls()).toBe(3);

	// Round one carried nothing to stub yet.
	expect(sent[0].length).toBe(0);

	// Round two: the two oldest results are stubs naming the call and its size,
	// the four most recent are whole.
	const second = sent[1];
	expect(second.length).toBe(6);
	expect(second.slice(0, 2).every(isStub)).toBe(true);
	expect(second.slice(2).every((t) => t.length === 33_000)).toBe(true);
	expect(second[0]).toContain("33,000 chars");

	// Round three fits without any further reduction, and the two stubs are still
	// stubs: the loop replaced its message array, so what was given up does not
	// come back the moment there is room for it again.
	const third = sent[2];
	expect(third.length).toBe(7);
	expect(third.slice(0, 2).every(isStub)).toBe(true);
	expect(third.slice(2, 6).every((t) => t.length === 33_000)).toBe(true);
	expect(third[6].length).toBe(200);
});
