// Single-active credential semantics: at most one model provider holds a live
// credential, whichever of the list it is. Tests the pure reducer/resolver (no
// fs/Tauri) plus the default-conversation chain follow. Run: bun test.

import { expect, test } from "bun:test";
import {
	activeProviderId,
	createCredentialsStore,
	withActiveCredential,
	type CredentialStore,
	type CredentialsIo,
} from "../../src/ai/credentials";
import { defaultModelFor, getModels, nextDefaultsForActive } from "../../src/ai/providers";
import { PROVIDER_IDS } from "../../src/ai/provider-ids";

const oauth = { type: "oauth", access: "a", refresh: "r", expires: 1 } as const;
const key = (k: string) => ({ type: "apiKey", key: k }) as const;

// --- mutual-exclusion matrix (pairwise) ------------------------------------

test("activating anthropic drops openai and deepseek", () => {
	const before: CredentialStore = { openai: oauth, deepseek: key("dk") };
	const after = withActiveCredential(before, "anthropic", oauth);
	expect(after.anthropic).toEqual(oauth);
	expect(after.openai).toBeUndefined();
	expect(after.deepseek).toBeUndefined();
});

test("activating openai drops anthropic and deepseek", () => {
	const before: CredentialStore = { anthropic: oauth, deepseek: key("dk") };
	const after = withActiveCredential(before, "openai", oauth);
	expect(after.openai).toEqual(oauth);
	expect(after.anthropic).toBeUndefined();
	expect(after.deepseek).toBeUndefined();
});

test("activating deepseek drops anthropic and openai", () => {
	const before: CredentialStore = { anthropic: oauth, openai: oauth };
	const after = withActiveCredential(before, "deepseek", key("dk"));
	expect(after.deepseek).toEqual(key("dk"));
	expect(after.anthropic).toBeUndefined();
	expect(after.openai).toBeUndefined();
});

test("device keys (imageGen, voiceStt) survive a provider switch", () => {
	const before: CredentialStore = {
		anthropic: oauth,
		imageGen: key("img"),
		voiceStt: key("stt"),
	};
	const after = withActiveCredential(before, "deepseek", key("dk"));
	expect(after.imageGen).toEqual(key("img"));
	expect(after.voiceStt).toEqual(key("stt"));
	expect(after.anthropic).toBeUndefined();
});

test("withActiveCredential does not mutate the input store", () => {
	const before: CredentialStore = { anthropic: oauth };
	withActiveCredential(before, "deepseek", key("dk"));
	expect(before.anthropic).toEqual(oauth);
	expect(before.deepseek).toBeUndefined();
});

// --- mutual exclusion holds for the whole list, not just the first three ---

test("activating any provider drops every other one", () => {
	// Every provider in turn, over a store already holding all the others.
	for (const id of PROVIDER_IDS) {
		const before: CredentialStore = {};
		for (const other of PROVIDER_IDS) before[other] = key(`k-${other}`);
		const after = withActiveCredential(before, id, key("new"));
		expect(after[id]).toEqual(key("new"));
		for (const other of PROVIDER_IDS) {
			if (other !== id) expect(after[other]).toBeUndefined();
		}
	}
});

test("a key saved for one of the newer providers signs the previous one out", () => {
	const before: CredentialStore = { groq: key("gsk") };
	const after = withActiveCredential(before, "xai", key("xai-key"));
	expect(after.xai).toEqual(key("xai-key"));
	expect(after.groq).toBeUndefined();
	expect(activeProviderId(after)).toBe("xai");
});

test("device keys survive a switch between two of the newer providers", () => {
	const before: CredentialStore = {
		"kimi-coding": key("kimi"),
		imageGen: key("img"),
		voiceStt: key("stt"),
	};
	const after = withActiveCredential(before, "cerebras", key("cb"));
	expect(after.imageGen).toEqual(key("img"));
	expect(after.voiceStt).toEqual(key("stt"));
	expect(after["kimi-coding"]).toBeUndefined();
	// Nor do the device keys ever count as the active provider.
	expect(activeProviderId({ imageGen: key("img"), voiceStt: key("stt") })).toBeNull();
});

// --- legacy multi-provider read rule ---------------------------------------

test("activeProviderId returns the single provider when only one is set", () => {
	expect(activeProviderId({ deepseek: key("dk") })).toBe("deepseek");
	expect(activeProviderId({ openai: oauth })).toBe("openai");
	expect(activeProviderId({})).toBeNull();
});

test("legacy file with several providers resolves by priority (anthropic > openai > the rest)", () => {
	expect(activeProviderId({ anthropic: oauth, openai: oauth, deepseek: key("dk") })).toBe(
		"anthropic",
	);
	expect(activeProviderId({ openai: oauth, deepseek: key("dk") })).toBe("openai");
	// Among the key providers the tie-break is the list's own order.
	expect(activeProviderId({ xai: key("x"), deepseek: key("dk") })).toBe("deepseek");
	expect(activeProviderId({ anthropic: oauth, groq: key("g") })).toBe("anthropic");
});

test("a legacy OpenAI api-key credential is not treated as active", () => {
	expect(activeProviderId({ openai: key("sk-legacy") })).toBeNull();
	// but it does not block a real credential of another provider
	expect(activeProviderId({ openai: key("sk-legacy"), deepseek: key("dk") })).toBe("deepseek");
});

// --- default-conversation chain follow -------------------------------------

test("nextDefaultsForActive points the chain at the new provider with its default model", () => {
	const next = nextDefaultsForActive("anthropic", "claude-opus-4-8", "deepseek");
	expect(next.defaultProviderId).toBe("deepseek");
	expect(next.defaultModelId).toBe(defaultModelFor("deepseek"));
});

test("nextDefaultsForActive keeps the model on a re-login of the same provider", () => {
	// A non-default anthropic model already selected stays put on re-login.
	const other = getModels("anthropic").find((m) => m.id !== defaultModelFor("anthropic"))!.id;
	const next = nextDefaultsForActive("anthropic", other, "anthropic");
	expect(next.defaultProviderId).toBe("anthropic");
	expect(next.defaultModelId).toBe(other);
});

test("nextDefaultsForActive resets an unknown model to the provider default", () => {
	const next = nextDefaultsForActive("anthropic", "no-such-model", "anthropic");
	expect(next.defaultModelId).toBe(defaultModelFor("anthropic"));
});

// --- the mutation queue belongs to a store, not to the module ---------------

// The chain was a module-level `let`, so everything that ever imported this file
// queued behind one promise. While every mutation finishes that is invisible; a
// mutation left in flight — a token refresh a test file started and never let
// land — is what the next caller waits behind, in a file nobody touched. Two
// stores over the same bytes is the smallest way to show it.
test("a second store's mutation does not queue behind the first store's unfinished one", async () => {
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	// Only the first write is held open; the second store's own write runs.
	let heldOne = false;
	const file = { text: "{}" };
	const io: CredentialsIo = {
		read: async () => ({ status: "ok", value: JSON.parse(file.text) as CredentialStore }),
		write: async (contents: string) => {
			if (!heldOne) {
				heldOne = true;
				await held;
			}
			file.text = contents;
		},
	};

	const first = createCredentialsStore(io);
	const second = createCredentialsStore(io);

	const stuck = first.update((s) => {
		s.anthropic = oauth;
	});
	// Let the first store reach its write and stop there.
	while (!heldOne) await null;

	const landed = await Promise.race([
		second
			.update((s) => {
				s.imageGen = key("img");
			})
			.then(() => "landed"),
		Bun.sleep(100).then(() => "still queued behind the other store"),
	]);
	expect(landed).toBe("landed");
	expect((JSON.parse(file.text) as CredentialStore).imageGen).toEqual(key("img"));

	release();
	await stuck;
});
