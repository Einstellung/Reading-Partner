// Claude on an Anthropic Console API key ("anthropic-api", src/ai/providers.ts):
// the subscription provider's catalog under an id of its own, a pasted key
// rather than a sign-in, and x-api-key rather than the OAuth Bearer path on the
// wire. Nothing reaches the network: credentials are spied and fetch is
// replaced for the one request the wire test makes. Run: bun test.

import { afterEach, expect, spyOn, test } from "bun:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { createAppModels } from "../../src/ai/durable-models";
import {
	AUTH_KIND,
	getModels,
	isApiKeyProvider,
	modelSupportsImages,
	providers,
	resolveApiKey,
} from "../../src/ai/providers";
import * as credentials from "../../src/ai/auth/credentials";
import * as anthropicOAuth from "../../src/ai/auth/anthropic-oauth";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

test("it is a key provider, and the subscription one is still OAuth", () => {
	expect(AUTH_KIND["anthropic-api"]).toBe("apiKey");
	expect(isApiKeyProvider("anthropic-api")).toBe(true);
	expect(AUTH_KIND.anthropic).toBe("oauth");
	expect(providers["anthropic-api"].name).not.toBe(providers.anthropic.name);
});

test("it offers the subscription provider's models, each under its own id", () => {
	const sub = providers.anthropic.getModels();
	const key = providers["anthropic-api"].getModels();
	expect(key.map((m) => m.id)).toEqual(sub.map((m) => m.id));
	for (const m of key) {
		expect(m.provider).toBe("anthropic-api");
		expect(m.api).toBe("anthropic-messages");
	}
	// The subscription models were copied, not rewritten in place.
	for (const m of sub) expect(m.provider).toBe("anthropic");
	expect(getModels("anthropic-api").length).toBeGreaterThan(0);
});

test("vision carries over model for model", () => {
	for (const m of providers.anthropic.getModels()) {
		expect(modelSupportsImages("anthropic-api", m.id)).toBe(modelSupportsImages("anthropic", m.id));
	}
	expect(getModels("anthropic-api").some((m) => modelSupportsImages("anthropic-api", m.id))).toBe(true);
});

test("the stored key is what a call carries, and the OAuth token is never asked for", async () => {
	spyOn(credentials, "loadCredentials").mockResolvedValue({
		"anthropic-api": { type: "apiKey", key: "sk-ant-api03-k" },
	} as any);
	const oauth = spyOn(anthropicOAuth, "getValidAnthropicAuth").mockResolvedValue("sk-ant-oat-should-not");
	expect(await resolveApiKey("anthropic-api")).toBe("sk-ant-api03-k");
	expect(oauth).not.toHaveBeenCalled();
	oauth.mockRestore();
});

test("with no key saved the error says to add one", async () => {
	spyOn(credentials, "loadCredentials").mockResolvedValue({} as any);
	await expect(resolveApiKey("anthropic-api")).rejects.toThrow("Open Settings to add an API key.");
});

test("a Console key goes on the wire as x-api-key, without the Claude Code identity", async () => {
	let seen: { url: string; headers: Headers; body: any } | undefined;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = new Request(input, init);
		seen = { url: req.url, headers: req.headers, body: JSON.parse(await req.text()) };
		return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stop" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	const model = providers["anthropic-api"].getModels()[0];
	const stream = providers["anthropic-api"].streamSimple(
		model,
		normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] }),
		{ apiKey: "sk-ant-api03-k", maxRetries: 0 },
	);
	for await (const _ of stream) {
		// Drain; the 400 ends the stream.
	}
	expect(seen).toBeDefined();
	expect(new URL(seen!.url).hostname).toBe("api.anthropic.com");
	expect(seen!.headers.get("x-api-key")).toBe("sk-ant-api03-k");
	expect(seen!.headers.get("authorization")).toBeNull();
	expect(seen!.headers.get("anthropic-beta") ?? "").not.toContain("oauth");
	expect(JSON.stringify(seen!.body.system ?? "")).not.toContain("Claude Code");
});

test("durable turns dispatch each id to its own provider", () => {
	const models = createAppModels();
	const id = providers.anthropic.getModels()[0]!.id;
	expect(models.getModel("anthropic", id)?.provider).toBe("anthropic");
	expect(models.getModel("anthropic-api", id)?.provider).toBe("anthropic-api");
	expect(models.getProvider("anthropic")?.name).toBe(providers.anthropic.name);
	expect(models.getProvider("anthropic-api")?.name).toBe(providers["anthropic-api"].name);
});
