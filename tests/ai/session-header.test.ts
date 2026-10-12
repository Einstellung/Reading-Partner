// The per-provider call setup (src/ai/call-setup.ts) and the session id it
// carries. OpenCode answers 400 MissingSessionID to any request without
// `x-opencode-session`; Fireworks gets the same conversation id as pi's own
// `sessionId`, which pi turns into session-affinity headers. Either way the
// value has to be one stable id per conversation — a fresh id per call clears
// the 400 and gives up the routing and caching it exists for. So both halves
// are tested: that each provider gets only what it asked for, and that the id
// it carries is the conversation's rather than the call's.
//
// The provider catalog is real (a model id comes out of it, so `resolveCall`
// resolves), but nothing reaches the network: the provider's `streamSimple` is
// spied and records the options pi would have been called with, and credentials
// and settings are spied too. Run: bun test.

import { expect, spyOn, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type AssistantMessage,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { callModel } from "../../src/ai/model-call";
import { getModels, providers, streamChat, PROVIDER_IDS, type ProviderId } from "../../src/ai/providers";
import { providerCallSetup } from "../../src/ai/call-setup";
import * as credentials from "../../src/ai/auth/credentials";
import { chatCleanupRunner } from "../../src/ai/voice";
import * as cacheTelemetry from "../../src/platform/app/cache-telemetry";
import { messageEvents } from "../support/scripted-turn";
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
			for (const ev of messageEvents(message)) stream.push(ev);
			stream.end();
		})();
		return stream;
	}) as any);
	return { seen: () => seen };
}

function answer(text: string): AssistantMessage {
	return fauxAssistantMessage(text, { stopReason: "stop" });
}

function chat(id: ProviderId, sessionId: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		void streamChat({
			providerId: id,
			modelId: firstModel(id),
			messages: [{ role: "user", text: "hello" }],
			sessionId,
			spend: { caller: "prep" },
			onDelta: () => {},
			onDone: (text) => resolve(text),
			onError: (m) => reject(new Error(m)),
		});
	});
}

// --- the table ---------------------------------------------------------------

test("the OpenCode providers ask for x-opencode-session and nothing else", () => {
	expect(providerCallSetup("opencode-go", "s1")).toEqual({ headers: { [SESSION]: "s1" } });
	expect(providerCallSetup("opencode", "s1")).toEqual({ headers: { [SESSION]: "s1" } });
});

// Fireworks needs no header of its own: every model pi lists for it sets compat
// sendSessionAffinityHeaders, so handing pi the session id is the whole change.
test("Fireworks carries pi's sessionId and no header", () => {
	expect(providerCallSetup("fireworks", "s1")).toEqual({ sessionId: "s1" });
});

test("a provider that needs neither gets an empty setup", () => {
	for (const id of ["anthropic", "openai", "deepseek"] as ProviderId[]) {
		expect(providerCallSetup(id, "s1")).toEqual({});
	}
});

// The whole table, so a provider added to it has to be added here too.
test("the table is exactly these providers, and each half only where declared", () => {
	const withHeaders = PROVIDER_IDS.filter((id) => providerCallSetup(id, "s1").headers);
	const withSessionId = PROVIDER_IDS.filter((id) => providerCallSetup(id, "s1").sessionId);
	expect(withHeaders).toEqual(["opencode", "opencode-go"]);
	expect(withSessionId).toEqual(["fireworks"]);
	const named = new Set([...withHeaders, ...withSessionId]);
	for (const id of PROVIDER_IDS.filter((other) => !named.has(other))) {
		expect(providerCallSetup(id, "s1")).toEqual({});
	}
});

// A call must never name one conversation in a header and another in sessionId.
// No provider carries both today; this pins the invariant so one that does has
// to derive them from the same value.
test("whenever both halves are present they are the same id", () => {
	for (const id of PROVIDER_IDS) {
		const setup = providerCallSetup(id, "the-session");
		const header = setup.headers?.[SESSION];
		if (header && setup.sessionId) expect(header).toBe(setup.sessionId);
	}
});

// --- the send path -----------------------------------------------------------

test("streamChat sends the session it was given, and nothing on other providers", async () => {
	const go = harness("opencode-go", [answer("hi")]);
	await chat("opencode-go", "session-1");
	expect(go.seen()[0].headers).toEqual({ [SESSION]: "session-1" });

	expect(go.seen()[0].sessionId).toBeUndefined();

	const fw = harness("fireworks", [answer("hi")]);
	await chat("fireworks", "session-1");
	expect(fw.seen()[0].sessionId).toBe("session-1");
	expect(fw.seen()[0].headers).toBeUndefined();

	const ds = harness("deepseek", [answer("hi")]);
	await chat("deepseek", "session-1");
	expect(ds.seen()[0].headers).toBeUndefined();
	expect(ds.seen()[0].sessionId).toBeUndefined();
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
