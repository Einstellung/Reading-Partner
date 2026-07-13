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
