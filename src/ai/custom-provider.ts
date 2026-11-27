// The one custom endpoint: any server that speaks the OpenAI chat-completions
// protocol, at a base URL, key and model the user types in. Unlike every other
// provider its model list is not a catalog shipped with pi but configuration,
// so the provider object here is a stable shell whose models are swapped when
// the configuration changes. The provider table (providers.ts) and the durable
// runtime (durable-models.ts) both hold this one object, so a reconfigured
// endpoint is seen by both without re-registering anything.
//
// The rules the settings card follows before it stores an endpoint live here
// too, as plain functions: which URLs are accepted, how a /models answer is
// read, and what a test request with a tool on it has to come back with.

import type { Model, Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export const CUSTOM_PROVIDER_ID = "custom";
export const CUSTOM_PROVIDER_NAME = "Custom (OpenAI-compatible)";

// What the endpoint's model is assumed to hold and write. Nothing in the
// chat-completions protocol reports either, and the user is not asked: 128k is
// what current open-weight and hosted models commonly offer, and a model with
// less fails the call with the server's own message. The output cap is kept
// well under that, because pi sends it as max_tokens and some servers reject a
// value larger than they allow.
export const CUSTOM_CONTEXT_WINDOW = 128_000;
export const CUSTOM_MAX_TOKENS = 8_192;

export interface CustomEndpoint {
	baseUrl: string;
	modelId: string;
}

export type BaseUrlCheck =
	| { ok: true; url: string }
	| { ok: false; reason: "empty" | "invalid" | "notHttps" };

// Only https: iOS's transport security blocks plaintext http, and a key sent in
// the clear is a key given away. The trailing slash is dropped so the paths
// appended below never double it.
export function checkBaseUrl(input: string): BaseUrlCheck {
	const raw = input.trim();
	if (!raw) return { ok: false, reason: "empty" };
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, reason: "invalid" };
	}
	if (url.protocol !== "https:") return { ok: false, reason: "notHttps" };
	if (!url.hostname) return { ok: false, reason: "invalid" };
	url.search = "";
	url.hash = "";
	return { ok: true, url: url.href.replace(/\/+$/, "") };
}

// The ids in a /models answer. OpenAI's shape is { data: [{ id }] }; a few
// servers answer { models: [...] } or a bare array, and some list names rather
// than objects. Anything else reads as no models, which sends the user to type
// the name instead.
export function parseModelList(body: unknown): string[] {
	const list = Array.isArray(body)
		? body
		: body && typeof body === "object"
			? ((body as { data?: unknown }).data ?? (body as { models?: unknown }).models)
			: undefined;
	if (!Array.isArray(list)) return [];
	const ids: string[] = [];
	for (const entry of list) {
		const id =
			typeof entry === "string"
				? entry
				: entry && typeof entry === "object"
					? ((entry as { id?: unknown }).id ?? (entry as { name?: unknown }).name)
					: undefined;
		if (typeof id === "string" && id.trim() && !ids.includes(id.trim())) ids.push(id.trim());
	}
	return ids;
}

// The smallest request that shows whether the endpoint calls tools: one tool
// with no parameters and a prompt asking for it. Every turn in this app works
// through tools, so an endpoint that cannot answer this one cannot run them.
export const PROBE_TOOL = "ping";

export function toolProbeBody(modelId: string): Record<string, unknown> {
	return {
		model: modelId,
		messages: [{ role: "user", content: `Call the ${PROBE_TOOL} tool now. Do not reply with text.` }],
		tools: [
			{
				type: "function",
				function: {
					name: PROBE_TOOL,
					description: "Connectivity check. Takes no arguments.",
					parameters: { type: "object", properties: {} },
				},
			},
		],
		tool_choice: "auto",
		max_tokens: 256,
		stream: false,
	};
}

export type ToolProbeVerdict =
	| { kind: "ok" }
	// Answered, but not with a tool call, or refused the tools field.
	| { kind: "noTools" }
	| { kind: "auth" }
	// Anything else, with what the server said.
	| { kind: "failed"; detail: string };

function errorText(body: unknown, raw: string): string {
	if (body && typeof body === "object") {
		const error = (body as { error?: unknown }).error;
		if (typeof error === "string") return error;
		if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string")
			return (error as { message: string }).message;
		if (typeof (body as { message?: unknown }).message === "string") return (body as { message: string }).message;
	}
	return raw.slice(0, 200);
}

// What the probe's answer means. Only a response that carries a tool call is
// "ok". A 400/422 that names tools or functions is the server refusing the
// field; a reply that ran out of tokens before calling anything says nothing
// about tools either way, so it is a failure to retry rather than a verdict.
export function judgeToolProbe(status: number, raw: string): ToolProbeVerdict {
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		body = undefined;
	}
	if (status === 401 || status === 403) return { kind: "auth" };
	if (status >= 200 && status < 300) {
		const choice = (body as { choices?: { message?: { tool_calls?: unknown[] }; finish_reason?: string }[] } | undefined)
			?.choices?.[0];
		if (!choice) return { kind: "failed", detail: "the response carried no choices" };
		if (Array.isArray(choice.message?.tool_calls) && choice.message.tool_calls.length > 0) return { kind: "ok" };
		if (choice.finish_reason === "length") return { kind: "failed", detail: "the model ran out of tokens before answering" };
		return { kind: "noTools" };
	}
	const message = errorText(body, raw);
	if ((status === 400 || status === 422) && /tool|function/i.test(message)) return { kind: "noTools" };
	return { kind: "failed", detail: `HTTP ${status}${message ? `: ${message}` : ""}` };
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

// The endpoint's model ids, or [] when it does not list them (no /models route,
// an error, a shape not recognised). Never throws: an empty list is what puts
// the card into typing the name by hand.
export async function fetchCustomModels(baseUrl: string, key: string, fetchFn: FetchFn = fetch): Promise<string[]> {
	return withProbeHost(baseUrl, async () => {
		try {
			const res = await fetchFn(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } });
			if (!res.ok) return [];
			return parseModelList(await res.json());
		} catch {
			return [];
		}
	});
}

export async function probeToolCalls(
	endpoint: CustomEndpoint,
	key: string,
	fetchFn: FetchFn = fetch,
): Promise<ToolProbeVerdict> {
	return withProbeHost(endpoint.baseUrl, async () => {
		let res: Response;
		try {
			res = await fetchFn(`${endpoint.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
				body: JSON.stringify(toolProbeBody(endpoint.modelId)),
			});
		} catch (e) {
			return { kind: "failed", detail: e instanceof Error ? e.message : String(e) };
		}
		return judgeToolProbe(res.status, await res.text().catch(() => ""));
	});
}

// The model the endpoint is called with: pi's openai-completions model shape,
// filled with the defaults above. compat is left unset so pi detects it from the
// URL as it does for every other OpenAI-compatible host.
export function customModel(endpoint: CustomEndpoint): Model<"openai-completions"> {
	return {
		id: endpoint.modelId,
		name: endpoint.modelId,
		api: "openai-completions",
		provider: CUSTOM_PROVIDER_ID,
		baseUrl: endpoint.baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: CUSTOM_CONTEXT_WINDOW,
		maxTokens: CUSTOM_MAX_TOKENS,
	};
}

const api = openAICompletionsApi();

function build(endpoint: CustomEndpoint | null): Provider {
	return createProvider({
		id: CUSTOM_PROVIDER_ID,
		name: CUSTOM_PROVIDER_NAME,
		baseUrl: endpoint?.baseUrl,
		// The key is resolved by the app (providers.ts resolveApiKey), never from
		// the environment.
		auth: { apiKey: { name: `${CUSTOM_PROVIDER_NAME} API key`, resolve: async () => undefined } },
		models: endpoint ? [customModel(endpoint)] : [],
		api,
	});
}

let current: Provider = build(null);
let endpointHost: string | null = null;
// Hosts admitted while a probe is in flight: the endpoint is not stored yet,
// but its requests still have to leave through the fetch bridge.
const probing = new Map<string, number>();

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

async function withProbeHost<T>(baseUrl: string, run: () => Promise<T>): Promise<T> {
	const host = hostOf(baseUrl);
	if (host) probing.set(host, (probing.get(host) ?? 0) + 1);
	try {
		return await run();
	} finally {
		if (host) {
			const left = (probing.get(host) ?? 1) - 1;
			if (left > 0) probing.set(host, left);
			else probing.delete(host);
		}
	}
}

// Point the provider at an endpoint, or at nothing. Called on every credential
// read that may have changed it, so it is cheap when nothing did.
let currentKey = "";
export function configureCustomProvider(endpoint: CustomEndpoint | null): void {
	const key = endpoint ? `${endpoint.baseUrl}\n${endpoint.modelId}` : "";
	if (key === currentKey) return;
	currentKey = key;
	current = build(endpoint);
	endpointHost = endpoint ? hostOf(endpoint.baseUrl) : null;
}

// Whether the fetch bridge should carry a request to `host`: the stored
// endpoint's host, or one being probed right now.
export function isCustomHost(host: string): boolean {
	return host === endpointHost || probing.has(host);
}

// The stored endpoint the provider is pointed at, for the settings form to show.
export function currentCustomEndpoint(): CustomEndpoint | null {
	const model = current.getModels()[0];
	return model ? { baseUrl: model.baseUrl, modelId: model.id } : null;
}

// The stable object every registry holds. Each member reads the current build,
// so nothing has to be re-registered when the endpoint changes.
export const customProvider: Provider = {
	id: CUSTOM_PROVIDER_ID,
	name: CUSTOM_PROVIDER_NAME,
	get baseUrl() {
		return current.baseUrl;
	},
	// A plain value, not a getter: durable-models.ts assigns its own auth onto
	// an object whose prototype is this one, and assigning over a getter-only
	// property throws.
	auth: current.auth,
	getModels: () => current.getModels(),
	getAllModels: () => current.getAllModels?.() ?? current.getModels(),
	stream: (model, context, options) => current.stream(model, context, options),
	streamSimple: (model, context, options) => current.streamSimple(model, context, options),
} as Provider;
