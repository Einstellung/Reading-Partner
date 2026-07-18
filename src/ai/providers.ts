// Provider abstraction over pi-ai for the three configured providers. Anthropic
// authenticates via subscription OAuth (token injected as StreamOptions.apiKey —
// pi auto-detects the OAuth token and switches to Bearer + Claude Code headers);
// OpenAI/DeepSeek use an API key. DeepSeek rides pi's openai-completions API.

import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	Provider,
	SimpleStreamOptions,
	ThinkingLevel,
} from "@earendil-works/pi-ai";
import { getValidAnthropicAuth } from "./anthropic-oauth";
import { loadCredentials, saveCredentials } from "./credentials";

export type ProviderId = "anthropic" | "openai" | "deepseek";

export interface ProviderInfo {
	id: ProviderId;
	name: string;
	authKind: "oauth" | "apiKey";
	configured: boolean;
}

export interface ChatMessage {
	role: "user" | "ai";
	text: string;
	// Attached images for a user turn. `data` is raw base64 (no data: prefix),
	// `mediaType` is the MIME type (e.g. "image/png"). Only vision models accept
	// these — streamChat rejects images for a model whose input lacks "image".
	images?: { data: string; mediaType: string }[];
}

export interface StreamChatOptions {
	providerId: ProviderId;
	modelId: string;
	systemPrompt?: string;
	messages: ChatMessage[];
	signal?: AbortSignal;
	// Extended-thinking effort. undefined = off. Passed to pi-ai's streamSimple,
	// which maps it per provider and ignores it on models without reasoning. We
	// also omit it up front when the target model's metadata says reasoning:false.
	reasoning?: ThinkingLevel;
	onDelta(text: string): void;
	// Reasoning/thinking deltas, when the model streams them. Kept separate from
	// onDelta so callers never render thinking into the visible reply; prep wires
	// it as a watchdog liveness signal so a long think isn't seen as a stall.
	onThinking?(delta: string): void;
	onDone(fullText: string): void;
	onError(message: string): void;
}

const AUTH_KIND: Record<ProviderId, "oauth" | "apiKey"> = {
	anthropic: "oauth",
	openai: "apiKey",
	deepseek: "apiKey",
};

// Exported so the agent loop (src/ai/agent.ts) reuses the exact same provider
// instances, model lookup, and OAuth/api-key resolution as streamChat.
export const providers: Record<ProviderId, Provider> = {
	anthropic: anthropicProvider(),
	openai: openaiProvider(),
	deepseek: deepseekProvider(),
};

export async function listProviders(): Promise<ProviderInfo[]> {
	const creds = await loadCredentials();
	return (Object.keys(providers) as ProviderId[]).map((id) => ({
		id,
		name: providers[id].name,
		authKind: AUTH_KIND[id],
		configured:
			id === "anthropic" ? creds.anthropic !== undefined : creds[id] !== undefined,
	}));
}

export async function setApiKey(id: "openai" | "deepseek", key: string): Promise<void> {
	const creds = await loadCredentials();
	creds[id] = { type: "apiKey", key };
	await saveCredentials(creds);
}

export function getModels(id: ProviderId): { id: string; label: string }[] {
	return providers[id].getModels().map((m) => ({ id: m.id, label: m.name || m.id }));
}

export async function resolveApiKey(id: ProviderId): Promise<string> {
	if (id === "anthropic") {
		const token = await getValidAnthropicAuth();
		if (!token) throw new Error("Anthropic is not connected. Sign in first.");
		return token;
	}
	const creds = await loadCredentials();
	const cred = creds[id];
	if (!cred) throw new Error(`${providers[id].name} API key is not set.`);
	return cred.key;
}

// A model whose input modalities include "image" can be sent picture content.
// pi's Model metadata carries `input: ("text" | "image")[]`; DeepSeek is
// text-only, Anthropic claude is vision, OpenAI depends on the model.
export function modelSupportsImages(providerId: ProviderId, modelId: string): boolean {
	const model = providers[providerId]?.getModels().find((m) => m.id === modelId);
	return !!model?.input.includes("image");
}

export function toPiMessages(messages: ChatMessage[]): Message[] {
	return messages.map((m): Message => {
		if (m.role === "user") {
			if (!m.images?.length) {
				return { role: "user", content: m.text, timestamp: Date.now() };
			}
			// Mixed text + image goes as a content array. pi maps image items to
			// each provider's shape (Anthropic base64 source / OpenAI data URL).
			const content = [
				...(m.text ? [{ type: "text" as const, text: m.text }] : []),
				...m.images.map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mediaType })),
			];
			return { role: "user", content, timestamp: Date.now() };
		}
		// Replaying history only needs role + content; the rest of AssistantMessage
		// is response metadata pi fills on output, not required as input.
		return { role: "assistant", content: [{ type: "text", text: m.text }] } as unknown as Message;
	});
}

// The simple-stream contract, matched by Provider.streamSimple and by a scripted
// fake in tests. Injected so the streaming core runs without a real provider.
export type SimpleStreamFn = (
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface StreamChatCoreParams {
	stream: SimpleStreamFn;
	model: Model<Api>;
	apiKey?: string;
	systemPrompt?: string;
	// Already converted to pi's Message shape.
	messages: Message[];
	signal?: AbortSignal;
	// Already gated against the model's reasoning support; undefined = off.
	reasoning?: ThinkingLevel;
	onDelta(text: string): void;
	onThinking?(delta: string): void;
	onDone(fullText: string): void;
	onError(message: string): void;
}

// Provider-injected streaming core. text_delta builds the visible reply;
// thinking_delta is routed only to onThinking so raw thinking never leaks into
// `full`. reasoning rides the streamSimple options (undefined omits thinking).
export async function streamChatCore(params: StreamChatCoreParams): Promise<void> {
	const { stream, model, apiKey, systemPrompt, messages, signal, reasoning } = params;
	const { onDelta, onThinking, onDone, onError } = params;
	try {
		const s = stream(model, { systemPrompt, messages }, { apiKey, signal, reasoning });
		let full = "";
		for await (const ev of s) {
			if (ev.type === "text_delta") {
				full += ev.delta;
				onDelta(ev.delta);
			} else if (ev.type === "thinking_delta") {
				onThinking?.(ev.delta);
			} else if (ev.type === "error") {
				onError(ev.error.errorMessage || "stream error");
				return;
			}
		}
		onDone(full);
	} catch (e) {
		onError(e instanceof Error ? e.message : String(e));
	}
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
	const { providerId, modelId, systemPrompt, messages, signal, reasoning } = options;
	const { onDelta, onThinking, onDone, onError } = options;
	try {
		const provider = providers[providerId];
		const model = provider.getModels().find((m) => m.id === modelId);
		if (!model) throw new Error(`unknown model '${modelId}' for ${provider.name}`);

		// Gate images up front: pi would silently downgrade them to a text
		// placeholder for a non-vision model, so the user's picture would vanish
		// without a word. Fail loudly instead.
		if (messages.some((m) => m.images?.length) && !model.input.includes("image")) {
			onError(`${model.name || modelId} can't read images. Switch to a vision-capable model to send pictures.`);
			return;
		}

		const apiKey = await resolveApiKey(providerId);
		await streamChatCore({
			stream: (m, ctx, opts) => provider.streamSimple(m, ctx, opts),
			model: model as Model<Api>,
			apiKey,
			systemPrompt,
			messages: toPiMessages(messages),
			signal,
			// Silently omit reasoning on models that don't support it.
			reasoning: reasoning && model.reasoning ? reasoning : undefined,
			onDelta,
			onThinking,
			onDone,
			onError,
		});
	} catch (e) {
		onError(e instanceof Error ? e.message : String(e));
	}
}
