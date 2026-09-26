// The list of providers the app offers, and how each one authenticates. Nothing
// is imported here: providers.ts imports credentials.ts, so the list cannot live
// in providers.ts without the two forming a cycle. Both read it from here.
//
// AUTH_KIND_TABLE is the list — the ids are its keys and the order is its order.
// providers.ts annotates its provider table as Record<ProviderId, Provider>, so
// an id added here without a factory (or a factory without an id) is a compile
// error rather than a dropdown entry that resolves to undefined at runtime.

const AUTH_KIND_TABLE = {
	// Subscription OAuth (Claude Pro/Max, ChatGPT Plus/Pro).
	anthropic: "oauth",
	openai: "oauth",
	// Everything else: paste a key, save, done.
	deepseek: "apiKey",
	opencode: "apiKey",
	"opencode-go": "apiKey",
	openrouter: "apiKey",
	"vercel-ai-gateway": "apiKey",
	huggingface: "apiKey",
	nvidia: "apiKey",
	together: "apiKey",
	"qwen-token-plan": "apiKey",
	"qwen-token-plan-cn": "apiKey",
	moonshotai: "apiKey",
	"moonshotai-cn": "apiKey",
	zai: "apiKey",
	"zai-coding-cn": "apiKey",
	groq: "apiKey",
	"ant-ling": "apiKey",
	xiaomi: "apiKey",
	"xiaomi-token-plan-ams": "apiKey",
	"xiaomi-token-plan-cn": "apiKey",
	"xiaomi-token-plan-sgp": "apiKey",
	cerebras: "apiKey",
	fireworks: "apiKey",
	"kimi-coding": "apiKey",
	minimax: "apiKey",
	"minimax-cn": "apiKey",
	xai: "apiKey",
} as const;

export type ProviderId = keyof typeof AUTH_KIND_TABLE;

export type AuthKind = (typeof AUTH_KIND_TABLE)[ProviderId];

// The providers a key can be saved for — the ones the API-key card offers.
export type ApiKeyProviderId = {
	[K in ProviderId]: (typeof AUTH_KIND_TABLE)[K] extends "apiKey" ? K : never;
}[ProviderId];

export const AUTH_KIND: Record<ProviderId, AuthKind> = AUTH_KIND_TABLE;

export const PROVIDER_IDS = Object.keys(AUTH_KIND_TABLE) as ProviderId[];

export const API_KEY_PROVIDER_IDS = PROVIDER_IDS.filter(
	(id) => AUTH_KIND[id] === "apiKey",
) as ApiKeyProviderId[];

export function isApiKeyProvider(id: ProviderId): id is ApiKeyProviderId {
	return AUTH_KIND[id] === "apiKey";
}
