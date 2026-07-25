// Local credential store: AppData/credentials.json. Anthropic and OpenAI hold
// the OAuth triple (access/refresh/expires); DeepSeek holds an API key. Write
// failures are surfaced, never swallowed — a silently dropped credential looks
// like the login worked until the next request fails.
//
// One file, several independent writers: any of the five AI singletons (prep,
// notes, slides, briefing, chat) can persist a refreshed token at any moment,
// while Settings can be saving an image or STT key. Every write therefore goes
// through updateCredentials, which serializes and re-reads, so no writer
// resurrects the state it read before another one committed.

import { readGuardedJson, writeTextAtomic } from "../app/atomic-fs";

const FILE = "credentials.json";

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

// The three model providers. At most one may hold a live credential at a time:
// signing into (or saving a key for) one signs the others out. imageGen and
// voiceStt are device keys, outside this set, and are never touched by it.
export type ProviderCredentialId = "anthropic" | "openai" | "deepseek";

// Priority used only to disambiguate a legacy credentials.json that carries more
// than one provider (written before single-active). The highest-priority present
// credential is treated as the active one; the rest are ignored on read and get
// physically dropped the next time any provider is activated. Deterministic and
// self-contained (no settings needed).
const ACTIVE_PRIORITY: ProviderCredentialId[] = ["anthropic", "openai", "deepseek"];

// Which provider a store counts as active. OpenAI must be a real OAuth triple; a
// legacy OpenAI API-key credential is ignored (isOAuthCredential). Null when none
// of the three is set.
export function activeProviderId(store: CredentialStore): ProviderCredentialId | null {
	for (const id of ACTIVE_PRIORITY) {
		if (id === "openai") {
			if (isOAuthCredential(store.openai)) return id;
		} else if (store[id] !== undefined) {
			return id;
		}
	}
	return null;
}

// Pure single-active reducer: a copy of `store` with `id` set to `cred` and the
// other two providers removed. Device keys pass through unchanged.
export function withActiveCredential(
	store: CredentialStore,
	id: ProviderCredentialId,
	cred: OAuthCredential | ApiKeyCredential,
): CredentialStore {
	const next: CredentialStore = { ...store };
	delete next.anthropic;
	delete next.openai;
	delete next.deepseek;
	if (id === "anthropic") next.anthropic = cred as AnthropicCredential;
	else if (id === "openai") next.openai = cred as OpenAICredential;
	else next.deepseek = cred as ApiKeyCredential;
	return next;
}

// Reads the store. Unparseable content is moved aside (the tokens in it are
// unusable anyway) and reads as an empty store — the user signs in again. A file
// that exists but cannot be read throws instead: the credentials are still in
// there, and every writer loads before it writes, so throwing is what stops a
// good file from being replaced by an empty one.
export async function loadCredentials(): Promise<CredentialStore> {
	const read = await readGuardedJson<CredentialStore>(FILE, (raw) =>
		raw && typeof raw === "object" ? (raw as CredentialStore) : null,
	);
	if (read.status === "ok") return read.value;
	if (read.status === "missing") return {};
	if (read.savedAs === null) throw new Error(`${FILE} could not be read`);
	return {};
}

export async function saveCredentials(store: CredentialStore): Promise<void> {
	// The write throws on failure; let it propagate to the caller/UI.
	await writeTextAtomic(FILE, JSON.stringify(store, null, 2));
}

// Serializes every read-modify-write of the file. Chained rather than locked:
// each mutation waits for the previous one to have landed, then reads the file
// itself, so `mutate` always sees what is actually on disk.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Apply one mutation to credentials.json, serialized against every other
 * mutation. `mutate` runs on a store freshly read inside the queue and either
 * edits it in place or returns a replacement; it must touch only its own
 * fields, since it is merging into whatever the other writers left behind.
 */
export function updateCredentials(
	mutate: (store: CredentialStore) => CredentialStore | void,
): Promise<CredentialStore> {
	const run = queue.then(async () => {
		const store = await loadCredentials();
		const next = mutate(store) ?? store;
		await saveCredentials(next);
		return next;
	});
	// Keep the chain alive after a failure; the failure itself is the caller's.
	queue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

// Single-active write: store one provider's credential and drop the other two,
// so credentials.json holds at most one of the three. Every sign-in path
// (Anthropic OAuth, OpenAI OAuth, DeepSeek key) routes here, so the mutual
// exclusion lives in one place.
export async function setActiveCredential(
	id: ProviderCredentialId,
	cred: OAuthCredential | ApiKeyCredential,
): Promise<void> {
	await updateCredentials((s) => withActiveCredential(s, id, cred));
}

// The image-relay key, or null when unset (decks then generate without AI
// illustrations).
export async function getImageGenKey(): Promise<string | null> {
	const creds = await loadCredentials();
	return creds.imageGen?.key ?? null;
}

// Set or clear the image-relay key (empty string clears it).
export async function setImageGenKey(key: string): Promise<void> {
	const trimmed = key.trim();
	await updateCredentials((creds) => {
		if (trimmed) creds.imageGen = { type: "apiKey", key: trimmed };
		else delete creds.imageGen;
	});
}

// Whether an image-relay key is configured (drives the Settings UI state).
export async function hasImageGenKey(): Promise<boolean> {
	return (await getImageGenKey()) !== null;
}
