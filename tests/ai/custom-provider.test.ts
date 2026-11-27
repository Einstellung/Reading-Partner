// The custom OpenAI-compatible endpoint (src/ai/custom-provider.ts): which URLs
// are accepted, how a /models answer is read, what the tool-call probe's answer
// means, and that a configured endpoint is reachable through the same provider
// object from the app's table and from the durable runtime's registry. The last
// part runs pi's real openai-completions api against a fake server on
// 127.0.0.1 (plain http, which only the URL check refuses). Run: bun test.

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { normalizeContext, type Model } from "@earendil-works/pi-ai";
import {
	CUSTOM_CONTEXT_WINDOW,
	checkBaseUrl,
	configureCustomProvider,
	currentCustomEndpoint,
	customModel,
	customProvider,
	fetchCustomModels,
	isCustomHost,
	judgeToolProbe,
	parseModelList,
	probeToolCalls,
	toolProbeBody,
} from "../../src/ai/custom-provider";
import { bridgedHosts, defaultModelFor, getModels, providers } from "../../src/ai/providers";
import { createAppModels } from "../../src/ai/durable-models";

afterEach(() => configureCustomProvider(null));

test("only https URLs are accepted, with the trailing slash dropped", () => {
	expect(checkBaseUrl(" https://api.example.com/v1/ ")).toEqual({ ok: true, url: "https://api.example.com/v1" });
	expect(checkBaseUrl("https://h.example.com")).toEqual({ ok: true, url: "https://h.example.com" });
	expect(checkBaseUrl("http://api.example.com/v1")).toEqual({ ok: false, reason: "notHttps" });
	expect(checkBaseUrl("ftp://x.example.com")).toEqual({ ok: false, reason: "notHttps" });
	expect(checkBaseUrl("api.example.com/v1")).toEqual({ ok: false, reason: "invalid" });
	expect(checkBaseUrl("   ")).toEqual({ ok: false, reason: "empty" });
	// Query and fragment would end up between the base and the appended path.
	expect(checkBaseUrl("https://h.example.com/v1?x=1#y")).toEqual({ ok: true, url: "https://h.example.com/v1" });
});

test("a /models answer is read in the shapes servers use", () => {
	expect(parseModelList({ object: "list", data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
	expect(parseModelList({ models: [{ name: "m1" }, { id: "m2" }] })).toEqual(["m1", "m2"]);
	expect(parseModelList(["x", "y", "x"])).toEqual(["x", "y"]);
	expect(parseModelList({ data: [{ id: " spaced " }, { id: "" }, {}, 3] })).toEqual(["spaced"]);
	expect(parseModelList({ error: "nope" })).toEqual([]);
	expect(parseModelList(null)).toEqual([]);
	expect(parseModelList("text")).toEqual([]);
});

test("the probe carries one tool and asks for it", () => {
	const body = toolProbeBody("m") as { model: string; tools: { function: { name: string } }[]; stream: boolean };
	expect(body.model).toBe("m");
	expect(body.tools.map((t) => t.function.name)).toEqual(["ping"]);
	expect(body.stream).toBe(false);
});

const reply = (message: unknown, finish = "stop") => JSON.stringify({ choices: [{ message, finish_reason: finish }] });

test("only an answer that carries a tool call passes the probe", () => {
	const call = { role: "assistant", tool_calls: [{ id: "1", type: "function", function: { name: "ping", arguments: "{}" } }] };
	expect(judgeToolProbe(200, reply(call, "tool_calls"))).toEqual({ kind: "ok" });
	expect(judgeToolProbe(200, reply({ role: "assistant", content: "pong" }))).toEqual({ kind: "noTools" });
	expect(judgeToolProbe(200, reply({ role: "assistant", content: "" }, "length")).kind).toBe("failed");
	expect(judgeToolProbe(200, "{}").kind).toBe("failed");
	expect(judgeToolProbe(200, "not json").kind).toBe("failed");
});

test("a refused tools field reads as no tool support; auth and other errors read as themselves", () => {
	expect(judgeToolProbe(400, JSON.stringify({ error: { message: "tools is not supported for this model" } }))).toEqual({
		kind: "noTools",
	});
	expect(judgeToolProbe(422, JSON.stringify({ detail: "x", message: "function calling unavailable" }))).toEqual({
		kind: "noTools",
	});
	expect(judgeToolProbe(401, "")).toEqual({ kind: "auth" });
	expect(judgeToolProbe(403, "{}")).toEqual({ kind: "auth" });
	expect(judgeToolProbe(404, JSON.stringify({ error: "model not found" }))).toEqual({
		kind: "failed",
		detail: "HTTP 404: model not found",
	});
	expect(judgeToolProbe(500, "boom")).toEqual({ kind: "failed", detail: "HTTP 500: boom" });
});

test("a configured endpoint is one model with the default window, and its host is bridged", () => {
	expect(getModels("custom")).toEqual([]);
	expect(currentCustomEndpoint()).toBeNull();
	configureCustomProvider({ baseUrl: "https://llm.example.org/v1", modelId: "qwen-x" });
	const model = customModel({ baseUrl: "https://llm.example.org/v1", modelId: "qwen-x" });
	expect(model.contextWindow).toBe(CUSTOM_CONTEXT_WINDOW);
	expect(model.api).toBe("openai-completions");
	expect(getModels("custom").map((m) => m.id)).toEqual(["qwen-x"]);
	expect(defaultModelFor("custom")).toBe("qwen-x");
	expect(currentCustomEndpoint()).toEqual({ baseUrl: "https://llm.example.org/v1", modelId: "qwen-x" });
	expect(bridgedHosts()).toContain("llm.example.org");
	expect(isCustomHost("llm.example.org")).toBe(true);
	expect(isCustomHost("other.example.org")).toBe(false);
	configureCustomProvider(null);
	expect(isCustomHost("llm.example.org")).toBe(false);
});

test("the durable registry finds the endpoint's model under 'custom', configured before or after it was built", () => {
	const models = createAppModels();
	expect(models.getModel("custom", "late")).toBeUndefined();
	configureCustomProvider({ baseUrl: "https://llm.example.org/v1", modelId: "late" });
	expect(models.getModel("custom", "late")?.baseUrl).toBe("https://llm.example.org/v1");
	expect(providers.custom).toBe(customProvider);
});

// A fake OpenAI-compatible server: /models lists two models, /chat/completions
// answers the probe (non-streamed) with a tool call, unless the model is
// "plain", and a streamed request with one text chunk.
let server: ReturnType<typeof Bun.serve>;
let base = "";
const seen: { path: string; auth: string | null; body: unknown }[] = [];

beforeAll(() => {
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const path = new URL(req.url).pathname;
			// Gemini's generateContent, streamed: one text part. What the Gemini
			// test below points pi's google api at.
			if (path.includes(":streamGenerateContent")) {
				seen.push({ path, auth: req.headers.get("x-goog-api-key"), body: await req.json() });
				const part = { candidates: [{ content: { role: "model", parts: [{ text: "hi from gemini" }] }, finishReason: "STOP" }] };
				return new Response(`data: ${JSON.stringify(part)}\n\n`, { headers: { "content-type": "text/event-stream" } });
			}
			const body = req.method === "POST" ? await req.json() : undefined;
			seen.push({ path, auth: req.headers.get("authorization"), body });
			if (req.headers.get("authorization") !== "Bearer sk-test") return new Response("{}", { status: 401 });
			if (path === "/v1/models") return Response.json({ object: "list", data: [{ id: "tooly" }, { id: "plain" }] });
			if (path !== "/v1/chat/completions") return new Response("not found", { status: 404 });
			const b = body as { model: string; stream?: boolean };
			if (b.stream) {
				const chunk = (delta: unknown, finish: string | null) =>
					`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: b.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
				const text = chunk({ role: "assistant", content: "hello" }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
				return new Response(text, { headers: { "content-type": "text/event-stream" } });
			}
			if (b.model === "plain") return Response.json({ choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }] });
			return Response.json({
				choices: [
					{
						message: { role: "assistant", tool_calls: [{ id: "t1", type: "function", function: { name: "ping", arguments: "{}" } }] },
						finish_reason: "tool_calls",
					},
				],
			});
		},
	});
	base = `http://127.0.0.1:${server.port}/v1`;
});

afterAll(() => server.stop(true));

test("the model list and the probe, against a fake endpoint", async () => {
	expect(await fetchCustomModels(base, "sk-test")).toEqual(["tooly", "plain"]);
	expect(await fetchCustomModels(base, "wrong")).toEqual([]);
	expect(await fetchCustomModels("http://127.0.0.1:1/v1", "sk-test")).toEqual([]);
	expect(await probeToolCalls({ baseUrl: base, modelId: "tooly" }, "sk-test")).toEqual({ kind: "ok" });
	expect(await probeToolCalls({ baseUrl: base, modelId: "plain" }, "sk-test")).toEqual({ kind: "noTools" });
	expect(await probeToolCalls({ baseUrl: base, modelId: "tooly" }, "wrong")).toEqual({ kind: "auth" });
	expect((await probeToolCalls({ baseUrl: "http://127.0.0.1:1/v1", modelId: "x" }, "sk-test")).kind).toBe("failed");
	// The probe's host is admitted to the bridge only while it runs.
	expect(isCustomHost("127.0.0.1")).toBe(false);
});

test("a configured endpoint streams a reply through pi's openai-completions api", async () => {
	configureCustomProvider({ baseUrl: base, modelId: "tooly" });
	const model = createAppModels().getModel("custom", "tooly") as Model<"openai-completions">;
	expect(model).toBeDefined();
	let text = "";
	for await (const ev of customProvider.streamSimple(
		model,
		normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] }),
		{ apiKey: "sk-test" },
	)) {
		if (ev.type === "text_delta") text += ev.delta;
		if (ev.type === "error") throw new Error(ev.error.errorMessage);
	}
	expect(text).toBe("hello");
	const last = seen[seen.length - 1];
	expect(last.path).toBe("/v1/chat/completions");
	expect(last.auth).toBe("Bearer sk-test");
	expect((last.body as { model: string }).model).toBe("tooly");
});

// Gemini (providers.google) goes through pi's google-generative-ai api and the
// @google/genai SDK under it. Pointed at the fake server, a reply comes back,
// which shows the SDK makes its request with the global fetch the bridge wraps.
test("Gemini streams a reply through pi's google api", async () => {
	const real = providers.google.getModels().find((m) => m.id === defaultModelFor("google"))!;
	expect(real.api).toBe("google-generative-ai");
	const model = { ...real, baseUrl: `http://127.0.0.1:${server.port}` };
	let text = "";
	let error = "";
	for await (const ev of providers.google.streamSimple(
		model,
		normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] }),
		{ apiKey: "gem-key" },
	)) {
		if (ev.type === "text_delta") text += ev.delta;
		if (ev.type === "error") error = ev.error.errorMessage ?? "error";
	}
	expect(error).toBe("");
	expect(text).toBe("hi from gemini");
	const last = seen[seen.length - 1];
	expect(last.path).toContain(real.id);
	expect(last.auth).toBe("gem-key");
});
