// Local credential store: AppData/credentials.json. Anthropic and OpenAI hold
// the OAuth triple (access/refresh/expires); every other provider holds an API
// key. Write failures are surfaced, never swallowed — a silently dropped
// credential looks like the login worked until the next request fails.
//
// One file, several independent writers: any of the five AI singletons (prep,
// notes, slides, briefing, chat) can persist a refreshed token at any moment,
// while Settings can be saving an image or STT key. Every write therefore goes
// through updateCredentials, which serializes and re-reads, so no writer
// resurrects the state it read before another one committed.

import { readGuardedJson, writeTextAtomic, type GuardedRead } from "../platform/app/atomic-fs";
import { PROVIDER_IDS, type ProviderId } from "./provider-ids";

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

// One provider's stored credential: an OAuth triple for the two subscription
// providers, an API key for the rest. Anthropic and OpenAI are declared with the
// union too rather than narrowly, because on-disk data may carry a legacy
// OpenAI apiKey credential; the OAuth paths narrow with isOAuthCredential.
export type ProviderCredential = OAuthCredential | ApiKeyCredential;

export type CredentialStore = Partial<Record<ProviderCredentialId, ProviderCredential>> & {
	// Paid image-relay key for deck illustrations (docs/14). A credential, not a
	// setting, so it stays on the device and out of the sync range.
	imageGen?: ApiKeyCredential;
	// Speech-to-text key for voice input (docs/15). Same reasoning: on-device,
	// never synced.
	voiceStt?: ApiKeyCredential;
};

// The model providers. At most one may hold a live credential at a time:
// signing into (or saving a key for) one signs the others out. imageGen and
// voiceStt are device keys, outside this set, and are never touched by it.
export type ProviderCredentialId = ProviderId;

// Priority used only to disambiguate a legacy credentials.json that carries more
// than one provider (written before single-active). The highest-priority present
// credential is treated as the active one; the rest are ignored on read and get
// physically dropped the next time any provider is activated. Deterministic and
// self-contained (no settings needed). The two subscription providers lead
// because they are the only ones a pre-single-active file could pair with a key.
const ACTIVE_PRIORITY: ProviderCredentialId[] = [
	"anthropic",
	"openai",
	...PROVIDER_IDS.filter((id) => id !== "anthropic" && id !== "openai"),
];

// Which provider a store counts as active. OpenAI must be a real OAuth triple; a
// legacy OpenAI API-key credential is ignored (isOAuthCredential). Null when no
// provider is set.
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

// Pure single-active reducer: a copy of `store` with `id` set to `cred` and
// every other provider removed. Device keys pass through unchanged.
export function withActiveCredential(
	store: CredentialStore,
	id: ProviderCredentialId,
	cred: ProviderCredential,
): CredentialStore {
	const next: CredentialStore = { ...store };
	for (const other of PROVIDER_IDS) delete next[other];
	next[id] = cred;
	return next;
}

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can run the real store — the serialisation included — against its
// own file.
export interface CredentialsIo {
	// The guarded read, so the quarantine policy stays in atomic-fs.
	read: () => Promise<GuardedRead<CredentialStore>>;
	write: (contents: string) => Promise<void>;
}

/** The store over credentials.json. CredentialStore above is what is in it. */
export interface CredentialsStore {
	load: () => Promise<CredentialStore>;
	save: (store: CredentialStore) => Promise<void>;
	update: (mutate: (store: CredentialStore) => CredentialStore | void) => Promise<CredentialStore>;
}

export function createCredentialsStore(io: CredentialsIo): CredentialsStore {
	// Serializes every read-modify-write of the file. Chained rather than locked:
	// each mutation waits for the previous one to have landed, then reads the
	// file itself, so `mutate` always sees what is actually on disk.
	//
	// In the closure rather than at module scope: a chain is a queue of work, and
	// a queue shared by everything that ever imported this file makes one
	// caller's unfinished write the thing the next caller waits behind.
	let queue: Promise<unknown> = Promise.resolve();

	// Reads the store. Unparseable content is moved aside (the tokens in it are
	// unusable anyway) and reads as an empty store — the user signs in again. A
	// file that exists but cannot be read throws instead: the credentials are
	// still in there, and every writer loads before it writes, so throwing is
	// what stops a good file from being replaced by an empty one.
	async function load(): Promise<CredentialStore> {
		const read = await io.read();
		if (read.status === "ok") return read.value;
		if (read.status === "missing") return {};
		if (read.savedAs === null) throw new Error(`${FILE} could not be read`);
		return {};
	}

	async function save(store: CredentialStore): Promise<void> {
		// The write throws on failure; let it propagate to the caller/UI.
		await io.write(JSON.stringify(store, null, 2));
	}

	return {
		load,
		save,
		update: (mutate) => {
			const run = queue.then(async () => {
				const store = await load();
				const next = mutate(store) ?? store;
				await save(next);
				return next;
			});
			// Keep the chain alive after a failure; the failure itself is the
			// caller's.
			queue = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
	};
}

const store = createCredentialsStore({
	read: () =>
		readGuardedJson<CredentialStore>(FILE, (raw) =>
			raw && typeof raw === "object" ? (raw as CredentialStore) : null,
		),
	write: (contents) => writeTextAtomic(FILE, contents),
});

export function loadCredentials(): Promise<CredentialStore> {
	return store.load();
}

export function saveCredentials(next: CredentialStore): Promise<void> {
	return store.save(next);
}

/**
 * Apply one mutation to credentials.json, serialized against every other
 * mutation. `mutate` runs on a store freshly read inside the queue and either
 * edits it in place or returns a replacement; it must touch only its own
 * fields, since it is merging into whatever the other writers left behind.
 */
export function updateCredentials(
	mutate: (store: CredentialStore) => CredentialStore | void,
): Promise<CredentialStore> {
	return store.update(mutate);
}

// Single-active write: store one provider's credential and drop every other
// one, so credentials.json holds at most one provider. Every sign-in path
// (Anthropic OAuth, OpenAI OAuth, an API key saved in Settings) routes here, so
// the mutual exclusion lives in one place.
export async function setActiveCredential(
	id: ProviderCredentialId,
	cred: ProviderCredential,
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
