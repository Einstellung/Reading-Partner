// Concurrency around credentials.json: five AI singletons can ask for a token
// at the same moment, and Settings can be writing a device key while they do.
// Covers that a token refresh happens once per provider (both providers rotate
// the refresh token, so a second exchange would sign the user out), and that a
// refresh landing later merges into the file instead of restoring the snapshot
// it read at the start. Run: bun test.

import { afterAll, beforeEach, expect, test } from "bun:test";
import { anthropicLogout, getValidAnthropicAuth } from "../../src/ai/anthropic-oauth";
import { setImageGenKey } from "../../src/ai/credentials";
import { getValidOpenAIAuth } from "../../src/ai/openai-oauth";
import { setSttKey } from "../../src/ai/voice/config";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

const FILE = "credentials.json";

// credentials.json in memory. The store writes through the real writeTextAtomic
// and reads through the real readGuardedJson; only the two host packages under
// them are spied, so the serialisation this file is about is the app's own.
let disk: FakeDisk;

// Both providers refresh with a POST to their own token endpoint (Anthropic
// sends JSON, Codex sends a form). The stub records the refresh token it was
// handed and waits for the test to let it finish; nothing here reaches a network.
const refreshCalls: string[] = [];
let release: () => void = () => {};
let gate = Promise.resolve();

function armGate(): void {
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
}

function sentRefreshToken(body: string): string | null {
  try {
    return JSON.parse(body).refresh_token ?? null;
  } catch {
    return new URLSearchParams(body).get("refresh_token");
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const token = sentRefreshToken(String(init?.body ?? ""));
  if (!token) throw new Error(`unexpected request body: ${String(init?.body)}`);
  refreshCalls.push(token);
  await gate;
  return Response.json({
    access_token: `access-after-${token}`,
    refresh_token: `next-of-${token}`,
    // The app subtracts a 5-minute skew, so this must outlast it to read as fresh.
    expires_in: 3600,
  });
}) as typeof globalThis.fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

const expired = (refresh: string) => ({
  type: "oauth",
  access: "stale",
  refresh,
  expires: Date.now() - 1000,
});

function write(store: Record<string, unknown>): void {
  disk.files.set(FILE, JSON.stringify(store));
}

function read(): Record<string, any> {
  return JSON.parse(disk.files.get(FILE) ?? "{}");
}

// Let every pending microtask-only step run.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await null;
}

beforeEach(() => {
  disk = installAppData();
  refreshCalls.length = 0;
  armGate();
});

test("two concurrent getValidAnthropicAuth calls trigger one refresh", async () => {
  write({ anthropic: expired("r1") });

  const a = getValidAnthropicAuth();
  const b = getValidAnthropicAuth();
  await settle();
  release();

  expect(await a).toBe("access-after-r1");
  expect(await b).toBe("access-after-r1");
  // The second caller joined the first exchange rather than spending r1 twice,
  // which is what would come back invalid_grant against a rotating token.
  expect(refreshCalls).toEqual(["r1"]);
  expect(read().anthropic.refresh).toBe("next-of-r1");
});

test("two concurrent getValidOpenAIAuth calls trigger one refresh", async () => {
  write({ openai: expired("o1") });

  const a = getValidOpenAIAuth();
  const b = getValidOpenAIAuth();
  await settle();
  release();

  expect(await a).toBe("access-after-o1");
  expect(await b).toBe("access-after-o1");
  expect(refreshCalls).toEqual(["o1"]);
});

test("a later caller reuses the refreshed token instead of refreshing again", async () => {
  write({ anthropic: expired("r1") });

  const first = getValidAnthropicAuth();
  await settle();
  release();
  expect(await first).toBe("access-after-r1");

  expect(await getValidAnthropicAuth()).toBe("access-after-r1");
  expect(refreshCalls).toEqual(["r1"]);
});

test("two device keys written at once both land", async () => {
  write({});

  // Both writers read the file first; unserialized, the slower one would write
  // back a snapshot taken before the other's field existed.
  await Promise.all([setImageGenKey("img-key"), setSttKey("stt-key")]);

  const store = read();
  expect(store.imageGen.key).toBe("img-key");
  expect(store.voiceStt.key).toBe("stt-key");
});

test("an image-gen key saved during a refresh survives the refresh write", async () => {
  write({ anthropic: expired("r1") });

  const auth = getValidAnthropicAuth();
  await settle(); // the exchange is now in flight, holding a pre-key snapshot
  await setImageGenKey("img-key");
  release();
  await auth;

  const store = read();
  expect(store.imageGen.key).toBe("img-key");
  expect(store.anthropic.access).toBe("access-after-r1");
});

test("a refresh in flight does not resurrect a credential that was signed out", async () => {
  write({ anthropic: expired("r1") });

  const auth = getValidAnthropicAuth();
  await settle();
  await anthropicLogout();
  release();
  await auth;

  expect(read().anthropic).toBeUndefined();
});
