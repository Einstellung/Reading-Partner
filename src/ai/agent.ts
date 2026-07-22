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
import { providers, resolveApiKey, toPiMessages, transportFor, type ChatMessage, type ProviderId } from "./providers";

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
	onDone(finalText: string): void;
	onError(message: string): void;
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
	// Default 8. Exceeding it surfaces a clear error through onError.
	maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 8;
const PREVIEW_LIMIT = 200;

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
	maxRounds: number;
}

// Core loop, provider-injected so tests can drive it with a fake stream. Aborts
// (mid-stream or between tool calls) stop the loop silently — the caller raised
// the signal, so it already knows; no onDone/onError fires.
export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
	const { stream, model, apiKey, systemPrompt, tools, signal, reasoning, transport, maxRounds } = params;
	const { onDelta, onThinking, onToolStart, onToolEnd, onDone, onError } = params;

	const piTools: Tool[] = tools.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters,
	}));
	const byName = new Map(tools.map((t) => [t.name, t]));
	// Copied so appended assistant/tool-result turns don't mutate the caller's array.
	const messages: Message[] = [...params.messages];

	try {
		for (let round = 0; round < maxRounds; round++) {
			if (signal?.aborted) return;

			const context: Context = { systemPrompt, messages, tools: piTools };
			const s = stream(model, context, { apiKey, signal, reasoning, transport });

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
					onError(ev.error.errorMessage || "stream error");
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
				onDone(assistantText(final));
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
					// error the model can react to, not a crashed turn.
					const args = validateToolCall(piTools, call) as Record<string, any>;
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
		onError(`agent stopped after ${maxRounds} tool rounds without a final answer`);
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
		onDelta,
		onThinking,
		onToolStart,
		onToolEnd,
		onDone,
		onError,
	} = options;

	try {
		const provider = providers[providerId];
		const model = provider.getModels().find((m) => m.id === modelId);
		if (!model) throw new Error(`unknown model '${modelId}' for ${provider.name}`);

		if (messages.some((m) => m.images?.length) && !model.input.includes("image")) {
			onError(
				`${model.name || modelId} can't read images. Switch to a vision-capable model to send pictures.`,
			);
			return;
		}

		const apiKey = await resolveApiKey(providerId);

		await runAgentLoop({
			stream: (m, ctx, opts) => provider.streamSimple(m, ctx, opts),
			model: model as Model<Api>,
			apiKey,
			systemPrompt,
			messages: toPiMessages(messages),
			tools,
			signal,
			// Silently omit reasoning on models that don't support it.
			reasoning: reasoning && model.reasoning ? reasoning : undefined,
			transport: transportFor(providerId),
			maxRounds,
			onDelta,
			onThinking,
			onToolStart,
			onToolEnd,
			onDone,
			onError,
		});
	} catch (e) {
		onError(e instanceof Error ? e.message : String(e));
	}
}
