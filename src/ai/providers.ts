// Provider abstraction over pi-ai. Anthropic and OpenAI authenticate via
// subscription OAuth (Claude Pro/Max, ChatGPT Plus/Pro); the access token is
// injected as StreamOptions.apiKey — for Anthropic pi switches to Bearer +
// Claude Code headers, for OpenAI (Codex backend) pi decodes the account id out
// of the token and sets the chatgpt-account-id header. Every other provider
// takes an API key and reaches its endpoint over pi's openai-completions (or,
// for MiniMax, anthropic-messages) API.
//
// The factories are imported one file at a time. pi ships a
// providers/all barrel, but it statically imports the AWS SDK and other
// node-only packages, which then land in the webview bundle. Each of these
// files is lazy underneath: it carries a model table and defers the api
// implementation.

import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { vercelAIGatewayProvider } from "@earendil-works/pi-ai/providers/vercel-ai-gateway";
import { huggingfaceProvider } from "@earendil-works/pi-ai/providers/huggingface";
import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia";
import { togetherProvider } from "@earendil-works/pi-ai/providers/together";
import { qwenTokenPlanProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { antLingProvider } from "@earendil-works/pi-ai/providers/ant-ling";
import { xiaomiProvider } from "@earendil-works/pi-ai/providers/xiaomi";
import { xiaomiTokenPlanAmsProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-ams";
import { xiaomiTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-cn";
import { xiaomiTokenPlanSgpProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp";
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { minimaxProvider } from "@earendil-works/pi-ai/providers/minimax";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	Provider,
	ProviderResponse,
	SimpleStreamOptions,
	ThinkingLevel,
	Transport,
} from "@earendil-works/pi-ai";
import { getValidAnthropicAuth } from "./anthropic-oauth";
import { getValidOpenAIAuth } from "./openai-oauth";
import { activeProviderId, loadCredentials, setActiveCredential } from "./credentials";
import {
	API_KEY_PROVIDER_IDS,
	AUTH_KIND,
	PROVIDER_IDS,
	isApiKeyProvider,
	type ApiKeyProviderId,
	type AuthKind,
	type ProviderId,
} from "./provider-ids";

export {
	API_KEY_PROVIDER_IDS,
	AUTH_KIND,
	PROVIDER_IDS,
	isApiKeyProvider,
	type ApiKeyProviderId,
	type AuthKind,
	type ProviderId,
};

export interface ProviderInfo {
	id: ProviderId;
	name: string;
	authKind: AuthKind;
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

// pi hands the whole AssistantMessage to both the `done` and the `error` event,
// and it carries everything about the turn that the text does not: `usage`
// (input / output / cacheRead / cacheWrite / totalTokens, plus the cost pi
// computes from the model's price table), `responseId`, `stopReason` and, when
// it failed, `errorMessage`. It reaches callers as the second argument of
// onDone / onError, so a caller that only wants the text is unaffected.
export type StreamOutcome = AssistantMessage;

// The HTTP response head, delivered after the headers are in and before the
// body is read. Its value is the provider's request id and its rate-limit
// headers: the only handle that can be matched against the provider's own
// records when a call goes wrong. Every provider api calls it.
export type ResponseHead = (response: ProviderResponse, model: Model<Api>) => void;

// A model call that failed, carrying pi's AssistantMessage when the failure came
// back from a provider. Callers classify from that message rather than from the
// message text. A failure raised before the request reached a provider (no
// credentials, unknown model, a rejected image) has none.
//
// `terminal` marks the failures that involve no network whatsoever, so no amount
// of repeating can change the answer. It is deliberately narrow: a credential
// lookup can refresh an OAuth token over the network and so is not terminal.
export class ModelCallError extends Error {
	readonly assistant?: StreamOutcome;
	readonly terminal: boolean;
	constructor(message: string, options: { assistant?: StreamOutcome; terminal?: boolean } = {}) {
		super(message);
		this.name = "ModelCallError";
		this.assistant = options.assistant;
		this.terminal = options.terminal ?? false;
	}
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
	onResponse?: ResponseHead;
	onDone(fullText: string, assistant?: StreamOutcome): void;
	onError(message: string, assistant?: StreamOutcome): void;
}

// Exported so the agent loop (src/ai/agent.ts) reuses the exact same provider
// instances, model lookup, and OAuth/api-key resolution as streamChat. The keys
// are this app's ids, not pi's: our "openai" is pi's openai-codex.
export const providers: Record<ProviderId, Provider> = {
	anthropic: anthropicProvider(),
	openai: openaiCodexProvider(),
	deepseek: deepseekProvider(),
	opencode: opencodeProvider(),
	"opencode-go": opencodeGoProvider(),
	openrouter: openrouterProvider(),
	"vercel-ai-gateway": vercelAIGatewayProvider(),
	huggingface: huggingfaceProvider(),
	nvidia: nvidiaProvider(),
	together: togetherProvider(),
	"qwen-token-plan": qwenTokenPlanProvider(),
	"qwen-token-plan-cn": qwenTokenPlanCnProvider(),
	moonshotai: moonshotaiProvider(),
	"moonshotai-cn": moonshotaiCnProvider(),
	zai: zaiProvider(),
	"zai-coding-cn": zaiCodingCnProvider(),
	groq: groqProvider(),
	"ant-ling": antLingProvider(),
	xiaomi: xiaomiProvider(),
	"xiaomi-token-plan-ams": xiaomiTokenPlanAmsProvider(),
	"xiaomi-token-plan-cn": xiaomiTokenPlanCnProvider(),
	"xiaomi-token-plan-sgp": xiaomiTokenPlanSgpProvider(),
	cerebras: cerebrasProvider(),
	fireworks: fireworksProvider(),
	"kimi-coding": kimiCodingProvider(),
	minimax: minimaxProvider(),
	"minimax-cn": minimaxCnProvider(),
	xai: xaiProvider(),
};

// Every hostname the providers talk to: the provider's own baseUrl plus each
// model's, since a few providers (OpenCode) carry no provider-level baseUrl and
// name the endpoint per model. This is what the fetch bridge routes through
// Tauri — the webview CSP allows only 'self' and ipc:, so a host missing from
// this set is a provider that cannot make a single request.
export function bridgedHosts(): Set<string> {
	const hosts = new Set<string>();
	const add = (url: string | undefined) => {
		if (!url) return;
		let host: string;
		try {
			host = new URL(url).hostname;
		} catch {
			// A baseUrl that is not a URL belongs to a provider we cannot reach
			// anyway; one of them must not take the app's startup with it.
			return;
		}
		if (host) hosts.add(host);
	};
	for (const id of PROVIDER_IDS) {
		const provider = providers[id];
		add(provider.baseUrl);
		for (const model of provider.getModels()) add(model.baseUrl);
	}
	return hosts;
}

// The Codex backend defaults to a WebSocket transport, which a webview cannot
// use: the browser WebSocket API can't attach the Authorization /
// chatgpt-account-id headers pi sets, and the CSP forbids wss anyway. Force SSE
// (routed through the Tauri http bridge) for OpenAI. Other providers keep pi's
// default.
export function transportFor(providerId: ProviderId): Transport | undefined {
	return providerId === "openai" ? "sse" : undefined;
}

export async function listProviders(): Promise<ProviderInfo[]> {
	const creds = await loadCredentials();
	// Single-active: exactly one provider (or none) reports configured, even if a
	// legacy file carries several — activeProviderId picks the deterministic one.
	const active = activeProviderId(creds);
	return PROVIDER_IDS.map((id) => ({
		id,
		name: providers[id].name,
		authKind: AUTH_KIND[id],
		configured: id === active,
	}));
}

export async function setApiKey(id: ApiKeyProviderId, key: string): Promise<void> {
	// Single-active: saving a key signs out whichever provider was connected.
	await setActiveCredential(id, { type: "apiKey", key });
}

// One entry in the model picker: the catalog id, the name to show, and the
// context window behind that name. The window travels with the entry because it
// is shown (src/ai/model-label.ts) — the app offers every model the provider
// lists, so what a small window costs is stated instead of enforced.
export interface ModelChoice {
	id: string;
	label: string;
	contextWindow: number;
}

// Every model of `id`, in catalog order. Nothing is withheld: a window too small
// for a whole book is the user's call, and the reading path already gives up
// optional material and says so when the call does not fit (src/budget).
export function getModels(id: ProviderId): ModelChoice[] {
	return providers[id]
		.getModels()
		.map((m) => ({ id: m.id, label: m.name || m.id, contextWindow: m.contextWindow }));
}

// Whether `modelId` may be chosen for `id` — i.e. the catalog still carries it.
// A stored id that no longer resolves degrades into a notice rather than an app
// with no working AI (see enforceKnownModel).
export function isSelectableModel(id: ProviderId, modelId: string | null): boolean {
	return !!modelId && providers[id].getModels().some((m) => m.id === modelId);
}

// The model a freshly-activated provider defaults to: the widest context window
// it offers, catalog order breaking ties. pi exposes no "recommended" flag, and
// the window is the one property this app's own work turns on — a book plus its
// notes plus a conversation. So nothing is hidden from the picker, but nobody
// lands on a 128k model without having asked for it. Null only when the provider
// lists no models at all, which callers must handle rather than assume away.
export function defaultModelFor(id: ProviderId): string | null {
	const models = providers[id].getModels();
	let best: Model<Api> | null = null;
	for (const m of models) {
		if (!best || m.contextWindow > best.contextWindow) best = m;
	}
	return best?.id ?? null;
}

// Default provider/model to write after `id` becomes the active provider. Keeps
// the existing model when it already belongs to `id` (a re-login of the same
// provider), otherwise resets to that provider's default. Used by Settings so
// the default conversation chain follows the last provider signed in.
export function nextDefaultsForActive(
	defaultProviderId: string | null,
	defaultModelId: string | null,
	id: ProviderId,
): { defaultProviderId: ProviderId; defaultModelId: string | null } {
	const keep = defaultProviderId === id && isSelectableModel(id, defaultModelId);
	return { defaultProviderId: id, defaultModelId: keep ? defaultModelId : defaultModelFor(id) };
}

export async function resolveApiKey(id: ProviderId): Promise<string> {
	if (id === "anthropic") {
		const token = await getValidAnthropicAuth();
		if (!token) throw new Error("Anthropic is not connected. Open Settings to sign in.");
		return token;
	}
	if (id === "openai") {
		const token = await getValidOpenAIAuth();
		if (!token) throw new Error("OpenAI is not connected. Open Settings to sign in with ChatGPT.");
		return token;
	}
	const creds = await loadCredentials();
	const cred = creds[id];
	if (!cred || cred.type !== "apiKey")
		throw new Error(`${providers[id].name} is not connected. Open Settings to add an API key.`);
	return cred.key;
}

// A model whose input modalities include "image" can be sent picture content.
// pi's Model metadata carries `input: ("text" | "image")[]`; DeepSeek is
// text-only, Anthropic claude is vision, OpenAI depends on the model.
export function modelSupportsImages(providerId: ProviderId, modelId: string): boolean {
	const model = providers[providerId]?.getModels().find((m) => m.id === modelId);
	return !!model?.input.includes("image");
}

// Everything a call needs before it can stream: the provider, the looked-up
// model, credentials, transport, and the reasoning level gated against the
// model's support. Shared by streamChat and the agent loop so the model lookup
// and the image gate have one wording. Throws on an unknown model, on images
// sent to a text-only model (pi would silently drop them to a placeholder, so
// the user's picture would vanish without a word), and on missing credentials —
// both callers funnel a throw into onError.
export async function resolveCall(
	providerId: ProviderId,
	modelId: string,
	messages: ChatMessage[],
	reasoning?: ThinkingLevel,
): Promise<{
	provider: Provider;
	model: Model<Api>;
	apiKey: string;
	transport: Transport | undefined;
	reasoning: ThinkingLevel | undefined;
}> {
	const provider = providers[providerId];
	const model = provider.getModels().find((m) => m.id === modelId);
	if (!model) throw new Error(`unknown model '${modelId}' for ${provider.name}`);

	if (messages.some((m) => m.images?.length) && !model.input.includes("image")) {
		throw new Error(
			`${model.name || modelId} can't read images. Switch to a vision-capable model to send pictures.`,
		);
	}

	return {
		provider,
		model: model as Model<Api>,
		apiKey: await resolveApiKey(providerId),
		transport: transportFor(providerId),
		// Silently omit reasoning on models that don't support it.
		reasoning: reasoning && model.reasoning ? reasoning : undefined,
	};
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
		//
		// Do not add `timestamp` here without adding `usage` in the same edit, and
		// read docs/pitfall/64 before touching this line at all. pi's token
		// estimator runs on every single call (clampMaxTokensToContext, via
		// buildBaseOptions) and reaches for `usage` on any assistant turn whose
		// timestamp is not older than the messages before it. No timestamp is what
		// keeps that comparison false; a timestamp without a usage makes it throw,
		// on every AI call in the app.
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

// Client-side retries for the request that opens the stream. pi has the loop
// inlined in every api we reach (retryProviderRequest) but defaults it to 0,
// so until it is passed there are none: a 503 with `retry-after: 1` fails the
// call a millisecond later and the server is asked once. Two retries turn the
// same 503 into a reply about two seconds later.
//
// This only wraps establishing the request. A stream that opens and then goes
// quiet is the stall watchdog's business (src/ai/watchdog.ts); the two do not
// overlap. maxRetryDelayMs stays at pi's default, so a server asking for a wait
// longer than a minute still fails fast and lands in the watchdog's hands with
// the requested delay in the message.
export const DEFAULT_MAX_RETRIES = 2;

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
	// Provider transport preference (SSE for OpenAI; see transportFor).
	transport?: Transport;
	// Client-side retries on the opening request; DEFAULT_MAX_RETRIES when unset.
	maxRetries?: number;
	onDelta(text: string): void;
	onThinking?(delta: string): void;
	onResponse?: ResponseHead;
	onDone(fullText: string, assistant?: StreamOutcome): void;
	onError(message: string, assistant?: StreamOutcome): void;
}

// Provider-injected streaming core. text_delta builds the visible reply;
// thinking_delta is routed only to onThinking so raw thinking never leaks into
// `full`. reasoning rides the streamSimple options (undefined omits thinking).
// The `done` event carries the assembled AssistantMessage; it is kept and handed
// to onDone after the iterator drains, so the accounting for a turn (usage,
// responseId) is available on this path too and not only in the agent loop.
export async function streamChatCore(params: StreamChatCoreParams): Promise<void> {
	const { stream, model, apiKey, systemPrompt, messages, signal, reasoning, transport } = params;
	const { onDelta, onThinking, onResponse, onDone, onError } = params;
	const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
	try {
		const s = stream(
			model,
			{ systemPrompt, messages },
			{ apiKey, signal, reasoning, transport, maxRetries, onResponse },
		);
		let full = "";
		let final: StreamOutcome | undefined;
		for await (const ev of s) {
			if (ev.type === "text_delta") {
				full += ev.delta;
				onDelta(ev.delta);
			} else if (ev.type === "thinking_delta") {
				onThinking?.(ev.delta);
			} else if (ev.type === "done") {
				final = ev.message;
			} else if (ev.type === "error") {
				onError(ev.error.errorMessage || "stream error", ev.error);
				return;
			}
		}
		onDone(full, final);
	} catch (e) {
		onError(e instanceof Error ? e.message : String(e));
	}
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
	const { providerId, modelId, systemPrompt, messages, signal, reasoning } = options;
	const { onDelta, onThinking, onResponse, onDone, onError } = options;
	try {
		const call = await resolveCall(providerId, modelId, messages, reasoning);
		await streamChatCore({
			stream: (m, ctx, opts) => call.provider.streamSimple(m, ctx, opts),
			model: call.model,
			apiKey: call.apiKey,
			systemPrompt,
			messages: toPiMessages(messages),
			signal,
			reasoning: call.reasoning,
			transport: call.transport,
			onDelta,
			onThinking,
			onResponse,
			onDone,
			onError,
		});
	} catch (e) {
		onError(e instanceof Error ? e.message : String(e));
	}
}
