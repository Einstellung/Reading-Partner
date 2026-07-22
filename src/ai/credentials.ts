// Local credential store: AppData/credentials.json. Anthropic and OpenAI hold
// the OAuth triple (access/refresh/expires); DeepSeek holds an API key. Write
// failures are surfaced, never swallowed — a silently dropped credential looks
// like the login worked until the next request fails.

import { BaseDirectory, exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const FILE = "credentials.json";
const opts = { baseDir: BaseDirectory.AppData } as const;

export interface OAuthCredential {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
}

// Anthropic and OpenAI both authenticate via subscription OAuth and share the
// token shape.
export type AnthropicCredential = OAuthCredential;
export type OpenAICredential = OAuthCredential;

export interface ApiKeyCredential {
	type: "apiKey";
	key: string;
}

// Narrows a stored credential to the OAuth shape. A legacy OpenAI API-key
// credential (from before subscription-only auth) fails this and is ignored.
export function isOAuthCredential(cred: unknown): cred is OAuthCredential {
	return (
		typeof cred === "object" &&
		cred !== null &&
		(cred as { type?: unknown }).type === "oauth" &&
		typeof (cred as { access?: unknown }).access === "string" &&
		typeof (cred as { refresh?: unknown }).refresh === "string"
	);
}

export interface CredentialStore {
	anthropic?: AnthropicCredential;
	// OAuth now, but on-disk data may still carry a legacy apiKey credential;
	// isOAuthCredential ignores it.
	openai?: OpenAICredential | ApiKeyCredential;
	deepseek?: ApiKeyCredential;
	// Paid image-relay key for deck illustrations (docs/14). A credential, not a
	// setting, so it stays on the device and out of the sync range.
	imageGen?: ApiKeyCredential;
	// Speech-to-text key for voice input (docs/15). Same reasoning: on-device,
	// never synced.
	voiceStt?: ApiKeyCredential;
}

export async function loadCredentials(): Promise<CredentialStore> {
	if (!(await exists(FILE, opts))) return {};
	const text = await readTextFile(FILE, opts);
	try {
		return JSON.parse(text) as CredentialStore;
	} catch (e) {
		throw new Error(`credentials.json is corrupt: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export async function saveCredentials(store: CredentialStore): Promise<void> {
	// writeTextFile throws on failure; let it propagate to the caller/UI.
	await writeTextFile(FILE, JSON.stringify(store, null, 2), opts);
}

// The image-relay key, or null when unset (decks then generate without AI
// illustrations).
export async function getImageGenKey(): Promise<string | null> {
	const creds = await loadCredentials();
	return creds.imageGen?.key ?? null;
}

// Set or clear the image-relay key (empty string clears it).
export async function setImageGenKey(key: string): Promise<void> {
	const creds = await loadCredentials();
	const trimmed = key.trim();
	if (trimmed) creds.imageGen = { type: "apiKey", key: trimmed };
	else delete creds.imageGen;
	await saveCredentials(creds);
}

// Whether an image-relay key is configured (drives the Settings UI state).
export async function hasImageGenKey(): Promise<boolean> {
	return (await getImageGenKey()) !== null;
}
