// The provider-required request headers (src/ai/request-headers.ts) and the
// session id they carry. OpenCode answers 400 MissingSessionID to any request
// without `x-opencode-session`, and the value has to be one stable id per
// conversation — a fresh id per call clears the 400 and gives up the routing
// and caching the header exists for. So both halves are tested: that the header
// goes only to the providers that need it, and that the id it carries is the
// conversation's rather than the call's.
//
// The provider catalog is real (a model id comes out of it, so `resolveCall`
// resolves), but nothing reaches the network: the provider's `streamSimple` is
// spied and records the options pi would have been called with, and credentials
// and settings are spied too. Run: bun test.

import { expect, spyOn, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { runAgentTurn } from "../../src/ai/agent";
import { callModel } from "../../src/ai/model-call";
import { getModels, providers, streamChat, PROVIDER_IDS, type ProviderId } from "../../src/ai/providers";
import { providerRequestHeaders } from "../../src/ai/request-headers";
import * as credentials from "../../src/ai/credentials";
import { chatCleanupRunner } from "../../src/ai/voice";
import * as cacheTelemetry from "../../src/platform/app/cache-telemetry";
import * as settings from "../../src/platform/app/settings";
import { runDigest } from "../../src/reading/prep/papers/digest";
import type { Fulltext } from "../../src/fulltext/types";
import type { PrepPaper } from "../../src/reading/prep/papers/types";

const SESSION = "x-opencode-session";

// A model the provider really lists, so the model lookup in resolveCall passes.
function firstModel(id: ProviderId): string {
	const models = getModels(id);
	if (!models.length) throw new Error(`no catalog model for ${id}`);
	return models[0].id;
}

// Spies the whole send path short of pi: credentials for the api key, the
// provider's streamSimple for the request itself, and the cache log so a turn
// does not write an event file. Returns the options each round was handed.
function harness(id: ProviderId, rounds: AssistantMessage[]): { seen: () => SimpleStreamOptions[] } {
	spyOn(credentials, "loadCredentials").mockResolvedValue({ [id]: { type: "apiKey", key: "k" } } as any);
	spyOn(cacheTelemetry, "recordCacheTurn").mockImplementation(() => {});
	const seen: SimpleStreamOptions[] = [];
	let round = 0;
	spyOn(providers[id], "streamSimple").mockImplementation(((_m: unknown, _c: unknown, opts: SimpleStreamOptions) => {
		seen.push(opts);
		const message = rounds[Math.min(round++, rounds.length - 1)];
		const stream = createAssistantMessageEventStream();
		(async () => {
			await Promise.resolve();
			// The visible reply is assembled from deltas, not from the final
			// message, so a round that answers has to stream its text first.
			const text = messageText(message);
			if (text) stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
			stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
			stream.end();
		})();
		return stream;
	}) as any);
	return { seen: () => seen };
}

function messageText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function answer(text: string): AssistantMessage {
	return fauxAssistantMessage(text, { stopReason: "stop" });
}

function wantsTool(name: string): AssistantMessage {
	return fauxAssistantMessage([fauxToolCall(name, {}, { id: "call-1" })] as any, { stopReason: "toolUse" });
}

const NOOP_TOOL = {
	name: "look",
	description: "look something up",
	parameters: { type: "object", properties: {} } as any,
	execute: async () => "found",
};

function turn(id: ProviderId, thread: string | undefined, tools: typeof NOOP_TOOL[]): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		void runAgentTurn({
			providerId: id,
			modelId: firstModel(id),
			messages: [{ role: "user", text: "hello" }],
			tools,
			telemetry: { surface: "reading", ...(thread ? { thread } : {}) },
			onDelta: () => {},
			onToolStart: () => {},
			onToolEnd: () => {},
			onDone: () => resolve(),
			onError: (m) => reject(new Error(m)),
			onRefusal: (m) => reject(new Error(m)),
		});
	});
}

// --- the table ---------------------------------------------------------------

test("the OpenCode providers ask for x-opencode-session; no other provider gets a header", () => {
	expect(providerRequestHeaders("opencode-go", "s1")).toEqual({ [SESSION]: "s1" });
	expect(providerRequestHeaders("opencode", "s1")).toEqual({ [SESSION]: "s1" });
	const others = PROVIDER_IDS.filter((id) => id !== "opencode" && id !== "opencode-go");
	for (const id of others) {
		expect(providerRequestHeaders(id, "s1")).toBeUndefined();
	}
	// The whole table, so a provider added to it has to be added here too.
	expect(PROVIDER_IDS.filter((id) => providerRequestHeaders(id, "s1"))).toEqual(["opencode", "opencode-go"]);
});

// --- the agent loop ----------------------------------------------------------

test("every round of one agent turn carries the same session, and it is the thread", async () => {
	const h = harness("opencode-go", [wantsTool("look"), wantsTool("look"), answer("done")]);
	await turn("opencode-go", "thread-a", [NOOP_TOOL]);
	const sessions = h.seen().map((o) => o.headers?.[SESSION]);
	expect(sessions.length).toBe(3);
	expect(sessions).toEqual(["thread-a", "thread-a", "thread-a"]);
});

test("two turns on the same thread carry the same session", async () => {
	const h = harness("opencode-go", [answer("one"), answer("two")]);
	await turn("opencode-go", "thread-b", []);
	await turn("opencode-go", "thread-b", []);
	expect(h.seen().map((o) => o.headers?.[SESSION])).toEqual(["thread-b", "thread-b"]);
});

test("a turn with no conversation of its own gets a fresh session each run", async () => {
	const h = harness("opencode-go", [answer("one"), answer("two")]);
	await turn("opencode-go", undefined, []);
	await turn("opencode-go", undefined, []);
	const [first, second] = h.seen().map((o) => o.headers?.[SESSION]);
	expect(first).toBeTruthy();
	expect(second).toBeTruthy();
	expect(first).not.toBe(second);
});

test("a turn on a provider that needs nothing carries no headers at all", async () => {
	const h = harness("deepseek", [answer("hi")]);
	await turn("deepseek", "thread-c", []);
	expect(h.seen().length).toBe(1);
	expect(h.seen()[0].headers).toBeUndefined();
});

// --- plain streaming ---------------------------------------------------------

function chat(id: ProviderId, sessionId: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		void streamChat({
			providerId: id,
			modelId: firstModel(id),
			messages: [{ role: "user", text: "hello" }],
			sessionId,
			onDelta: () => {},
			onDone: (text) => resolve(text),
			onError: (m) => reject(new Error(m)),
		});
	});
}

test("streamChat sends the session it was given, and nothing on other providers", async () => {
	const go = harness("opencode-go", [answer("hi")]);
	await chat("opencode-go", "session-1");
	expect(go.seen()[0].headers).toEqual({ [SESSION]: "session-1" });

	const ds = harness("deepseek", [answer("hi")]);
	await chat("deepseek", "session-1");
	expect(ds.seen()[0].headers).toBeUndefined();
});

// --- the one-off callers -----------------------------------------------------
//
// None of the three has a conversation to name, and each says so by minting an
// id per call. Pinned so the next reader sees a choice rather than an accident:
// if one of them ever grows a real conversation, these are the tests that have
// to change.

test("an unattended pipeline call is its own session, a new one each call", async () => {
	const h = harness("opencode-go", [answer("note"), answer("note")]);
	spyOn(settings, "loadSettings").mockResolvedValue({
		...settings.DEFAULT_SETTINGS,
		defaultProviderId: "opencode-go",
		defaultModelId: firstModel("opencode-go"),
	});
	const opts = { signal: new AbortController().signal, onProgress: () => {} };
	await callModel("prep", "plan", "you are a planner", "material", opts);
	await callModel("prep", "plan", "you are a planner", "material", opts);
	const [first, second] = h.seen().map((o) => o.headers?.[SESSION]);
	expect(first).toBeTruthy();
	expect(first).not.toBe(second);
});

test("a short-paper digest is its own session, a new one each run", async () => {
	const h = harness("opencode-go", [answer("the note"), answer("the note")]);
	const paper = {
		slug: "p",
		title: "A Paper",
		authors: ["A"],
		year: 2024,
		arxivId: null,
		citedInChapters: [1],
		reason: "it is cited",
		status: "digesting",
	} as PrepPaper;
	const fulltext: Fulltext = { version: 1, status: "ok", pages: ["page one"], outline: [] };
	const model = { providerId: "opencode-go" as ProviderId, modelId: firstModel("opencode-go") };
	await runDigest({ paper, surveyName: "The Survey", fulltext, model });
	await runDigest({ paper, surveyName: "The Survey", fulltext, model });
	const [first, second] = h.seen().map((o) => o.headers?.[SESSION]);
	expect(first).toBeTruthy();
	expect(first).not.toBe(second);
});

test("a voice cleanup pass is its own session, a new one each utterance", async () => {
	const h = harness("opencode-go", [answer("cleaned"), answer("cleaned")]);
	const model = { providerId: "opencode-go" as ProviderId, modelId: firstModel("opencode-go") };
	await chatCleanupRunner(model, "clean this up", "raw text", undefined);
	await chatCleanupRunner(model, "clean this up", "raw text", undefined);
	const [first, second] = h.seen().map((o) => o.headers?.[SESSION]);
	expect(first).toBeTruthy();
	expect(first).not.toBe(second);
});
