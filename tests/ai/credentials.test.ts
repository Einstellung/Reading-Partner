// Single-active credential semantics: at most one of the three model providers
// holds a live credential. Tests the pure reducer/resolver (no fs/Tauri) plus
// the default-conversation chain follow. Run: bun test.

import { expect, test } from "bun:test";
import {
	activeProviderId,
	withActiveCredential,
	type CredentialStore,
} from "../../src/ai/credentials";
import { defaultModelFor, getModels, nextDefaultsForActive } from "../../src/ai/providers";

const oauth = { type: "oauth", access: "a", refresh: "r", expires: 1 } as const;
const key = (k: string) => ({ type: "apiKey", key: k }) as const;

// --- mutual-exclusion matrix (three providers, pairwise) -------------------

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

// --- legacy multi-provider read rule ---------------------------------------

test("activeProviderId returns the single provider when only one is set", () => {
	expect(activeProviderId({ deepseek: key("dk") })).toBe("deepseek");
	expect(activeProviderId({ openai: oauth })).toBe("openai");
	expect(activeProviderId({})).toBeNull();
});

test("legacy file with several providers resolves by priority (anthropic > openai > deepseek)", () => {
	expect(activeProviderId({ anthropic: oauth, openai: oauth, deepseek: key("dk") })).toBe(
		"anthropic",
	);
	expect(activeProviderId({ openai: oauth, deepseek: key("dk") })).toBe("openai");
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
