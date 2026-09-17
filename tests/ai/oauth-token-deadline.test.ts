// Every token request the shared OAuth flow makes carries a 30s deadline. A
// refresh with no deadline hangs the AI call that triggered it, and the user
// cannot tell that apart from a slow model; OpenAI's refresh used to send no
// signal at all. Run: bun test.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { getValidAnthropicAuth } from "../../src/ai/anthropic-oauth";
import { getValidOpenAIAuth } from "../../src/ai/openai-oauth";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

const FILE = "credentials.json";
const TOKEN_TIMEOUT_MS = 30_000;

let disk: FakeDisk;
let sentSignals: (AbortSignal | null | undefined)[];
let timeouts: number[];
const realFetch = globalThis.fetch;

beforeEach(() => {
  disk = installAppData();
  sentSignals = [];
  timeouts = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentSignals.push(init?.signal);
    return Response.json({
      access_token: "fresh-access",
      refresh_token: "next-refresh",
      expires_in: 3600,
    });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function writeExpired(provider: "anthropic" | "openai"): void {
  disk.files.set(
    FILE,
    JSON.stringify({
      [provider]: { type: "oauth", access: "stale", refresh: "r1", expires: Date.now() - 1000 },
    }),
  );
}

test("the OpenAI refresh sends a 30s deadline", async () => {
  writeExpired("openai");

  expect(await getValidOpenAIAuth()).toBe("fresh-access");
  expect(timeouts).toEqual([TOKEN_TIMEOUT_MS]);
  const signal = sentSignals[0];
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
});

test("the Anthropic refresh sends the same 30s deadline", async () => {
  writeExpired("anthropic");

  expect(await getValidAnthropicAuth()).toBe("fresh-access");
  expect(timeouts).toEqual([TOKEN_TIMEOUT_MS]);
  expect(sentSignals[0]).toBeInstanceOf(AbortSignal);
});
