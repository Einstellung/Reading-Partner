// Local credential store: AppData/credentials.json. Anthropic holds the OAuth
// triple (access/refresh/expires); OpenAI/DeepSeek hold an API key. Write
// failures are surfaced, never swallowed — a silently dropped credential looks
// like the login worked until the next request fails.

import { BaseDirectory, exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const FILE = "credentials.json";
const opts = { baseDir: BaseDirectory.AppData } as const;

export interface AnthropicCredential {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
}

export interface ApiKeyCredential {
	type: "apiKey";
	key: string;
}

export interface CredentialStore {
	anthropic?: AnthropicCredential;
	openai?: ApiKeyCredential;
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
