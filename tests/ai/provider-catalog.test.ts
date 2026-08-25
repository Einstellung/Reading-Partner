// The provider table against the live pi-ai catalog: the id list and the
// factories agree, every provider the app offers actually has models to offer,
// and every host those models talk to is one the fetch bridge routes through
// Tauri. The last one is the difference between a provider that works and a
// provider whose every request dies against the webview CSP ('self' and ipc:
// only), which is not visible until someone pastes a key. Run: bun test.

import { expect, test } from "bun:test";
import {
	API_KEY_PROVIDER_IDS,
	AUTH_KIND,
	PROVIDER_IDS,
	bridgedHosts,
	defaultModelFor,
	getModels,
	isApiKeyProvider,
	providers,
	type ProviderId,
} from "../../src/ai/providers";
import { bridgedFetchHosts } from "../../src/ai/fetch-bridge";

test("the id list and the provider table hold the same providers", () => {
	expect([...PROVIDER_IDS].sort()).toEqual((Object.keys(providers) as ProviderId[]).sort());
	for (const id of PROVIDER_IDS) {
		expect(providers[id]).toBeDefined();
		expect(providers[id].name).toBeTruthy();
	}
});

test("only anthropic and openai authenticate by OAuth; the rest take a key", () => {
	const oauth = PROVIDER_IDS.filter((id) => AUTH_KIND[id] === "oauth");
	expect(oauth).toEqual(["anthropic", "openai"]);
	expect(API_KEY_PROVIDER_IDS).toEqual(PROVIDER_IDS.filter((id) => isApiKeyProvider(id)));
	// The card the key list drives is worth having.
	expect(API_KEY_PROVIDER_IDS.length).toBe(26);
});

test("every provider offers at least one model and a default to land on", () => {
	for (const id of PROVIDER_IDS) {
		expect(getModels(id).length).toBeGreaterThan(0);
		const fallback = defaultModelFor(id);
		expect(fallback).not.toBeNull();
		expect(getModels(id).map((m) => m.id)).toContain(fallback!);
	}
});

test("every provider's own baseUrl host is bridged", () => {
	const hosts = bridgedHosts();
	for (const id of PROVIDER_IDS) {
		const baseUrl = providers[id].baseUrl;
		// A provider may name no baseUrl of its own (OpenCode); its models do.
		if (!baseUrl) continue;
		expect(hosts).toContain(new URL(baseUrl).hostname);
	}
});

test("every model's baseUrl host is bridged, including the providers with no baseUrl of their own", () => {
	const hosts = bridgedHosts();
	let checked = 0;
	for (const id of PROVIDER_IDS) {
		for (const model of providers[id].getModels()) {
			if (!model.baseUrl) continue;
			expect(hosts).toContain(new URL(model.baseUrl).hostname);
			checked++;
		}
	}
	expect(checked).toBeGreaterThan(0);
	// The two providers that carry no provider-level baseUrl are the reason
	// models are read at all.
	expect(providers.opencode.baseUrl).toBeUndefined();
	expect(hosts).toContain("opencode.ai");
});

test("no bridged host is a template rather than a host", () => {
	for (const host of bridgedHosts()) {
		expect(host).not.toContain("{");
		expect(host).not.toContain("}");
		expect(host).not.toContain("/");
		expect(host).not.toContain(":");
	}
});

test("the fetch bridge adds the OAuth hosts the provider table never names", () => {
	const hosts = bridgedFetchHosts();
	for (const host of [
		"api.anthropic.com",
		"platform.claude.com",
		"claude.ai",
		"api.openai.com",
		"auth.openai.com",
		"chatgpt.com",
	]) {
		expect(hosts).toContain(host);
	}
	// And it is a superset of what the providers need.
	for (const host of bridgedHosts()) expect(hosts).toContain(host);
});
