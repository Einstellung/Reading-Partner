// Tool-calling agent loop over pi-ai. Streams the model's turn; when it requests
// tool calls, runs them and feeds the results back, repeating until the model
// produces a final text answer or the round cap is hit. Additive: streamChat and
// the fetch bridge are untouched, and provider/auth/message-conversion are reused
// from providers.ts so the agent authenticates identically to plain chat.
//
// pi-ai APIs used (all from "@earendil-works/pi-ai"):
//   - Provider.stream(model, context, options): AssistantMessageEventStream
//   - Context { systemPrompt?, messages: Message[], tools?: Tool[] }
//   - Tool { name, description, parameters: TSchema }  (TypeBox schema)
//   - stream events: text_delta / done / error  (AssistantMessageEvent)
//   - a `done` event carries the final AssistantMessage; its content holds
//     ToolCall blocks (type "toolCall") when the model wants tools
//   - ToolResultMessage { role: "toolResult", toolCallId, toolName, content, isError }
//   - validateToolCall(tools, toolCall): coerces/validates args against the schema

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	ThinkingLevel,
	Tool,
	ToolCall,
	ToolResultMessage,
	Transport,
	TSchema,
} from "@earendil-works/pi-ai";
import { validateToolCall } from "@earendil-works/pi-ai";
import {
	contextBudget,
	fitsBudget,
	stubEarlyToolResults,
	TOOL_RESULTS_KEPT,
	type BudgetPurpose,
} from "../budget";
import { recordToolArgs } from "../platform/app/structured-output";
import {
	DEFAULT_MAX_RETRIES,
	resolveCall,
	toPiMessages,
	type ChatMessage,
	type ProviderId,
	type ResponseHead,
	type StreamOutcome,
} from "./providers";

// An image block a tool can return alongside its text (e.g. view_figure hands
// the model a cropped figure). `data` is bare base64, `mimeType` the MIME type;
// pi-ai carries these to the provider as tool-result image content (verified for
// the Anthropic path — see docs/12 landing note).
export interface ToolResultImage {
	data: string;
	mimeType: string;
}

// A richer tool result: text (also used as the UI trace preview) plus optional
// images. A tool may still return a plain string, which becomes { text }.
export interface ToolResult {
	text: string;
	images?: ToolResultImage[];
}

// A tool the model can call. `parameters` is a TypeBox schema (e.g.
// Type.Object({...}) / StringEnum(...)) — the same shape pi's Tool expects.
// `execute` receives arguments already validated/coerced against that schema and
// returns the tool result: a string, or { text, images } to attach pictures.
export interface AgentTool {
	name: string;
	description: string;
	parameters: TSchema;
	execute(args: Record<string, any>): Promise<string | ToolResult>;
}

export interface AgentToolStart {
	name: string;
	args: Record<string, any>;
}

export interface AgentToolEnd {
	name: string;
	// The tool's returned/errored text, truncated for a compact UI trace.
	resultPreview: string;
	isError: boolean;
}

export interface AgentCallbacks {
	onDelta(text: string): void;
	// Reasoning/thinking deltas, kept separate from onDelta so thinking is never
	// rendered as the reply; the unattended digest wires it as watchdog liveness.
	onThinking?(delta: string): void;
	onToolStart(info: AgentToolStart): void;
	onToolEnd(info: AgentToolEnd): void;
	// A model turn is about to be streamed: `round` is 1-based, `rounds` the cap.
	// Fires after the round has passed its budget check, so it counts turns that
	// were really sent — which is what a caller reporting "3 of 6 turns used" has
	// to mean. Optional; the conversational paths have no use for it, the
	// sub-agent runner (ai/subagent) reports its turn count from it.
	onRound?(info: { round: number; rounds: number }): void;
	// The HTTP response head of each round, before its body is read: request id
	// and rate-limit headers. Fires once per streamed model turn.
	onResponse?: ResponseHead;
	// The turn's text, plus pi's AssistantMessage for the round that produced it —
	// usage, responseId, stopReason. A caller that only wants the text ignores it.
	onDone(finalText: string, assistant?: StreamOutcome): void;
	onError(message: string, assistant?: StreamOutcome): void;
	// The loop gave up for a reason it can state, with nothing having failed: the
	// call outgrew the model's window mid-turn, or the round cap ran out. Every
	// request that went out was answered, so presenting this as a failed call
	// tells the user to check a connection that is fine. Separate from onError
	// because the two ask for different things — an error is worth another press,
	// a refusal gives the same answer every time. Unset falls back to onError, for
	// callers with no use for the distinction (the unattended pipelines turn
	// either one into a rejected promise).
	onRefusal?(message: string): void;
}

export interface RunAgentTurnOptions extends AgentCallbacks {
	providerId: ProviderId;
	modelId: string;
	systemPrompt?: string;
	messages: ChatMessage[];
	tools: AgentTool[];
	signal?: AbortSignal;
	// Extended-thinking effort. undefined = off. Omitted silently on models whose
	// metadata says reasoning:false.
	reasoning?: ThinkingLevel;
	// Max streamed model turns that request tools before the loop gives up.
	// Default 8. Exceeding it is a refusal, not an error.
	maxRounds?: number;
	// What the answer is for, which sets how much output room each round must
	// leave (src/budget). "chat" when unset.
	purpose?: BudgetPurpose;
}

const DEFAULT_MAX_ROUNDS = 8;
const PREVIEW_LIMIT = 200;

// The two things the loop says when it gives up. Both are refusals rather than
// errors, and both are written for someone who does not know what a token is:
// they say what happened to the reading, not what happened to the arithmetic.
//
// Kept here rather than beside the ladder's refusals (src/budget) because only
// the loop can reach either state — the planner sizes a turn before it is sent
// and never sees one in flight.

// A turn that started with room and ran out of it partway through, after the one
// reduction available mid-flight (stubbing the tool results it already
// collected). Worded to hold whether or not anything was actually stubbed.
export const REFUSE_MIDTURN =
	"I've taken in more of this material than I can hold at once, and setting aside what I can spare still doesn't leave room to answer. Ask about a narrower part of it and I can.";

// The model spent the whole round cap calling tools and never wrote an answer.
export const REFUSE_ROUNDS =
	"I kept looking things up without getting to an answer, so I've stopped rather than go around again. Ask something more specific and I can.";

function preview(text: string): string {
	return text.length <= PREVIEW_LIMIT ? text : `${text.slice(0, PREVIEW_LIMIT)}…`;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function toolCalls(message: AssistantMessage): ToolCall[] {
	return message.content.filter((c): c is ToolCall => c.type === "toolCall");
}

// The provider-agnostic stream contract, matched by Provider.stream and by a
// scripted fake in tests. Kept as a parameter so the loop core can be driven
// without any real provider, auth, or network.
export type StreamFn = (
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface AgentLoopParams extends AgentCallbacks {
	stream: StreamFn;
	model: Model<Api>;
	apiKey?: string;
	systemPrompt?: string;
	// Already converted to pi's Message shape.
	messages: Message[];
	tools: AgentTool[];
	signal?: AbortSignal;
	// Already gated against the model's reasoning support; undefined = off.
	reasoning?: ThinkingLevel;
	// Provider transport preference (SSE for OpenAI; see transportFor).
	transport?: Transport;
	// Client-side retries on the request that opens each round's stream;
	// DEFAULT_MAX_RETRIES when unset. See providers.ts for why it must be passed.
	maxRetries?: number;
	maxRounds: number;
	// Output floor to hold each round to; "chat" when unset.
	purpose?: BudgetPurpose;
}

// Core loop, provider-injected so tests can drive it with a fake stream. Aborts
// (mid-stream or between tool calls) stop the loop silently — the caller raised
// the signal, so it already knows; no onDone/onError fires.
export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
	const { stream, model, apiKey, systemPrompt, tools, signal, reasoning, transport, maxRounds } = params;
	const { onDelta, onThinking, onResponse, onRound, onToolStart, onToolEnd, onDone, onError } = params;
	const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
	const refuse = params.onRefusal ?? ((message: string) => onError(message));

	const piTools: Tool[] = tools.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters,
	}));
	const byName = new Map(tools.map((t) => [t.name, t]));
	// Copied so appended assistant/tool-result turns don't mutate the caller's array.
	// Reassigned, not mutated, when a round has to be shrunk to fit: the stubbed
	// array replaces this one, so what was given up does not come back next round.
	let messages: Message[] = [...params.messages];
	const purpose = params.purpose ?? "chat";

	try {
		for (let round = 0; round < maxRounds; round++) {
			if (signal?.aborted) return;

			let context: Context = { systemPrompt, messages, tools: piTools };
			// Every round grows the history by an assistant turn and its tool
			// results, so a loop that started comfortably can reach the window
			// mid-way. Sending it anyway does not fail: pi clamps the allowed output
			// to 1, the model emits one token, and the stream ends with a normal
			// `done` (docs/pitfall/65). Fetching a chapter is exactly how a turn
			// gets there, so the check belongs on every round, not just the first.
			if (!fitsBudget(contextBudget(model, context), purpose)) {
				// The one rung available mid-turn: everything but the last few tool
				// results becomes a stub naming the call and its size, so the model
				// can fetch it again if it turns out to matter.
				messages = stubEarlyToolResults(messages, TOOL_RESULTS_KEPT).messages;
				context = { systemPrompt, messages, tools: piTools };
				// Measured again rather than subtracted from. From round two the array
				// carries real AssistantMessages with usage, pi's estimator prices the
				// whole prefix at the provider's own count, and a rung's saving can only
				// ever be counted script-aware; subtracting one from the other is
				// arithmetic across two currencies (docs/pitfall/66).
				//
				// What that costs: a usage figure describes the request that was already
				// sent, so it does not fall when the history behind it is rewritten.
				// Stubbing rescues a round whose script-aware number was the binding one
				// — the CJK case this module exists for — plus this round's own results,
				// which sit after the usage mark. When pi's number is what is over the
				// line, no edit to the history can help: pi clamps against that number
				// regardless, so refusing is the outcome rather than a missed rescue.
				if (!fitsBudget(contextBudget(model, context), purpose)) {
					refuse(REFUSE_MIDTURN);
					return;
				}
			}
			onRound?.({ round: round + 1, rounds: maxRounds });
			const s = stream(model, context, {
				apiKey,
				signal,
				reasoning,
				transport,
				maxRetries,
				onResponse,
			});

			let final: AssistantMessage | undefined;
			for await (const ev of s) {
				if (ev.type === "text_delta") {
					onDelta(ev.delta);
				} else if (ev.type === "thinking_delta") {
					onThinking?.(ev.delta);
				} else if (ev.type === "done") {
					final = ev.message;
				} else if (ev.type === "error") {
					// pi reports an aborted signal as an error event; treat it as a
					// silent stop rather than a surfaced failure.
					if (ev.reason === "aborted" || signal?.aborted) return;
					onError(ev.error.errorMessage || "stream error", ev.error);
					return;
				}
			}

			if (signal?.aborted) return;
			if (!final) {
				onError("model stream ended without a final message");
				return;
			}

			const calls = toolCalls(final);
			if (calls.length === 0) {
				onDone(assistantText(final), final);
				return;
			}

			// The assistant turn (carrying the tool_use blocks) must precede its
			// tool results in the replayed history, or providers reject the batch.
			messages.push(final);

			for (const call of calls) {
				if (signal?.aborted) return;
				onToolStart({ name: call.name, args: call.arguments });

				let resultText: string;
				let images: ToolResultImage[] | undefined;
				let isError = false;
				try {
					const tool = byName.get(call.name);
					if (!tool) throw new Error(`unknown tool '${call.name}'`);
					// Validate/coerce against the tool's schema before executing; a
					// throw here (bad args or a throwing execute) becomes a tool-result
					// error the model can react to, not a crashed turn. Both outcomes
					// are recorded (platform/app/structured-output.ts): this is the
					// tool-argument half of how well models hit a schema, and a
					// failure rate is meaningless without its denominator.
					const args = recordToolArgs(
						{ providerId: model.provider, modelId: model.id },
						call.name,
						() => validateToolCall(piTools, call) as Record<string, any>,
					);
					const raw = await tool.execute(args);
					if (typeof raw === "string") {
						resultText = raw;
					} else {
						resultText = raw.text;
						images = raw.images;
					}
				} catch (e) {
					isError = true;
					resultText = e instanceof Error ? e.message : String(e);
				}

				onToolEnd({ name: call.name, resultPreview: preview(resultText), isError });

				const content: ToolResultMessage["content"] = [{ type: "text", text: resultText }];
				if (images) {
					for (const im of images) content.push({ type: "image", data: im.data, mimeType: im.mimeType });
				}
				const result: ToolResultMessage = {
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content,
					isError,
					timestamp: Date.now(),
				};
				messages.push(result);
			}
		}

		if (signal?.aborted) return;
		// Same exit as the budget refusal, for the same reason: every round of this
		// turn reached the model and came back. What it did with them — fetching and
		// fetching without concluding — is not a broken call, and a Retry button on
		// it only offers to spend the cap again on the identical ask.
		refuse(REFUSE_ROUNDS);
	} catch (e) {
		if (signal?.aborted) return;
		onError(e instanceof Error ? e.message : String(e));
	}
}

// Public entry: resolves the real provider/model/auth (same path as streamChat),
// gates images the same way, then runs the loop.
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<void> {
	const {
		providerId,
		modelId,
		systemPrompt,
		messages,
		tools,
		signal,
		reasoning,
		maxRounds = DEFAULT_MAX_ROUNDS,
		purpose,
		onDelta,
		onThinking,
		onResponse,
		onRound,
		onToolStart,
		onToolEnd,
		onDone,
		onError,
		onRefusal,
	} = options;

	try {
		const call = await resolveCall(providerId, modelId, messages, reasoning);

		await runAgentLoop({
			stream: (m, ctx, opts) => call.provider.streamSimple(m, ctx, opts),
			model: call.model,
			apiKey: call.apiKey,
			systemPrompt,
			messages: toPiMessages(messages),
			tools,
			signal,
			reasoning: call.reasoning,
			transport: call.transport,
			maxRounds,
			purpose,
			onDelta,
			onThinking,
			onResponse,
			onRound,
			onToolStart,
			onToolEnd,
			onDone,
			onError,
			onRefusal,
		});
	} catch (e) {
		onError(e instanceof Error ? e.message : String(e));
	}
}
