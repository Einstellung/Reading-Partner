// What a durable turn tells the provider about which conversation it belongs
// to, read off the HTTP request that leaves (the app's real provider objects
// through createAppModels, fetch faked). pi-durable hands every model request
// the conversation's own session id (its `pi.provider` doc), and pi-ai turns
// that into each provider's routing and cache keys: OpenCode's required
// `x-opencode-session` header, Fireworks' session-affinity headers, and Codex's
// `session-id` header and `prompt_cache_key`. A thread keeps one conversation,
// so one id across its rounds, its turns and a reopen; a background run is a
// conversation of its own, so a fresh id each run.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppModels } from "../../../src/ai/durable-models";
import * as providersModule from "../../../src/ai/providers";
import type { ProviderId } from "../../../src/ai/providers";
import { runBackgroundTurnOn } from "../../../src/legion/durable/background";
import { startTurn } from "../../../src/legion/durable/turn";
import { openTestRuntime, readerTurn, type TestRuntime } from "./support/runtime";

const root = () => mkdtempSync(join(tmpdir(), "durable-session-id-"));

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// --- provider wire formats -----------------------------------------------------

const sse = (events: unknown[]): string => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

function completionsText(text: string): string {
  return (
    sse([
      { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]) + "data: [DONE]\n\n"
  );
}

function completionsTool(name: string, args: Record<string, string>): string {
  const call = { index: 0, id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } };
  return (
    sse([
      { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]) + "data: [DONE]\n\n"
  );
}

function codexText(text: string): string {
  const item = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  return sse([
    { type: "response.created", response: { id: "r1" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: { id: "r1", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } },
    },
  ]);
}

// A fake JWT carrying the ChatGPT account claim the Codex provider reads.
const CODEX_TOKEN = `x.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } }))}.y`;

/** Fake the network: every model request is recorded, and answered by the next body in `replies`. */
function network(provider: ProviderId, replies: string[]): Sent[] {
  spyOn(providersModule, "resolveApiKey").mockResolvedValue(provider === "openai" ? CODEX_TOKEN : "test-key");
  const sent: Sent[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => (headers[key] = value));
    // The Codex SSE path sends its body zstd-compressed.
    const bytes = new Uint8Array(await request.arrayBuffer());
    const raw = headers["content-encoding"] === "zstd" ? Bun.zstdDecompressSync(bytes) : bytes;
    const text = new TextDecoder().decode(raw);
    sent.push({ url: request.url, headers, body: text ? JSON.parse(text) : {} });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`no reply left for ${request.url}`);
    return new Response(reply, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch);
  return sent;
}

const open: TestRuntime[] = [];

async function runtime(dir = root()): Promise<TestRuntime> {
  const t = await openTestRuntime({ root: dir, responses: [], models: createAppModels() });
  open.push(t);
  return t;
}

afterEach(async () => {
  for (const t of open.splice(0)) await t.runtime.close(ctx).catch(() => {});
});

function model(provider: ProviderId, api: string): { provider: string; modelId: string } {
  const found = providersModule.providers[provider].getModels().find((m) => m.api === api);
  if (!found) throw new Error(`${provider} has no ${api} model`);
  return { provider, modelId: found.id };
}

async function turn(t: TestRuntime, text: string, ts: number, extra: Record<string, unknown>): Promise<void> {
  const started = await startTurn(t.runtime, readerTurn(t, text, ts, extra), ctx);
  await started.settled;
}

const thread = (id: string) => ({ key: `book:b1:${id}`, origin: { place: "book", bookId: "b1", threadId: id } });

// --- OpenCode -------------------------------------------------------------------

test("every round of an OpenCode turn carries one x-opencode-session, and the next turn on the thread the same", async () => {
  const sent = network("opencode-go", [completionsTool("lookup", { query: "tides" }), completionsText("The moon."), completionsText("Again.")]);
  const t = await runtime();
  const opencode = { model: model("opencode-go", "openai-completions"), ...thread("t1") };
  await turn(t, "What moves the tides?", 1000, opencode);
  await turn(t, "And again?", 2000, opencode);
  const sessions = sent.map((s) => s.headers["x-opencode-session"]);
  expect(sessions.length).toBe(3);
  expect(sessions[0]).toBeTruthy();
  expect(new Set(sessions).size).toBe(1);
  expect(sent.every((s) => s.url.startsWith("https://opencode.ai/"))).toBe(true);
});

test("two threads carry two OpenCode sessions", async () => {
  const sent = network("opencode-go", [completionsText("one"), completionsText("two")]);
  const t = await runtime();
  const m = model("opencode-go", "openai-completions");
  await turn(t, "first", 1000, { model: m, ...thread("t1") });
  await turn(t, "second", 2000, { model: m, ...thread("t2") });
  const [a, b] = sent.map((s) => s.headers["x-opencode-session"]);
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(a).not.toBe(b);
});

test("an OpenCode Anthropic-format model carries the session header too", async () => {
  const messages = [
    { type: "message_start", message: { id: "msg1", type: "message", role: "assistant", content: [], model: "m", stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const body = messages.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const sent = network("opencode-go", [body]);
  const t = await runtime();
  await turn(t, "hello", 1000, { model: model("opencode-go", "anthropic-messages"), ...thread("t1") });
  expect(sent.length).toBe(1);
  expect(sent[0].headers["x-opencode-session"]).toBeTruthy();
});

test("a reopened runtime keeps the thread's OpenCode session", async () => {
  const sent = network("opencode-go", [completionsText("one"), completionsText("two")]);
  const dir = root();
  const m = { model: model("opencode-go", "openai-completions"), ...thread("t1") };
  const first = await runtime(dir);
  await turn(first, "first", 1000, m);
  await first.runtime.close(ctx);
  open.splice(open.indexOf(first), 1);
  const second = await runtime(dir);
  await turn(second, "second", 2000, m);
  const [a, b] = sent.map((s) => s.headers["x-opencode-session"]);
  expect(a).toBeTruthy();
  expect(b).toBe(a);
});

// --- Fireworks ------------------------------------------------------------------

test("a Fireworks turn carries the session as pi's affinity headers on every round", async () => {
  const sent = network("fireworks", [completionsTool("lookup", { query: "tides" }), completionsText("The moon.")]);
  const t = await runtime();
  await turn(t, "What moves the tides?", 1000, { model: model("fireworks", "openai-completions"), ...thread("t1") });
  expect(sent.length).toBe(2);
  const affinity = sent.map((s) => s.headers["x-session-affinity"]);
  expect(affinity[0]).toBeTruthy();
  expect(affinity[1]).toBe(affinity[0]);
  expect(sent[0].headers["x-opencode-session"]).toBeUndefined();
});

// --- OpenAI (Codex) -------------------------------------------------------------

test("a Codex turn carries the session as session-id and prompt_cache_key, the same on the next turn", async () => {
  const sent = network("openai", [codexText("one"), codexText("two")]);
  const t = await runtime();
  const m = { model: model("openai", "openai-codex-responses"), ...thread("t1") };
  await turn(t, "first", 1000, m);
  await turn(t, "second", 2000, m);
  expect(sent.length).toBe(2);
  const ids = sent.map((s) => s.headers["session-id"]);
  expect(ids[0]).toBeTruthy();
  expect(ids[1]).toBe(ids[0]);
  expect(sent.map((s) => s.body.prompt_cache_key)).toEqual(ids);
});

// --- providers that take none -----------------------------------------------------

test("a DeepSeek turn sends no session header and no cache key", async () => {
  const sent = network("deepseek", [completionsText("hi")]);
  const t = await runtime();
  await turn(t, "hello", 1000, { model: model("deepseek", "openai-completions"), ...thread("t1") });
  expect(sent.length).toBe(1);
  const named = Object.keys(sent[0].headers).filter((h) => /session|affinity|client-request-id/.test(h));
  expect(named).toEqual([]);
  expect(sent[0].body.prompt_cache_key).toBeUndefined();
});

// --- background runs --------------------------------------------------------------

test("each background run is its own OpenCode session", async () => {
  const sent = network("opencode-go", [completionsText("one"), completionsText("two")]);
  const t = await runtime();
  const { provider, modelId } = model("opencode-go", "openai-completions");
  const run = () =>
    runBackgroundTurnOn(
      { runtime: t.runtime },
      { name: "distill", systemPrompt: "You distill.", task: "Distill this.", tools: [], maxRounds: 2, purpose: "chat", model: { providerId: provider, modelId } },
    );
  expect((await run()).kind).toBe("answer");
  expect((await run()).kind).toBe("answer");
  const [a, b] = sent.map((s) => s.headers["x-opencode-session"]);
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(a).not.toBe(b);
});
