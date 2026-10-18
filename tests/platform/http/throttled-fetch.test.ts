// Unit tests for the retry loop: Retry-After handling, terminal-429 ->
// RateLimitError, and a cooling-down host ending the loop. Spacing and cooldown
// themselves are host-gate.test.ts. All fake clocks/fetches — no
// real timers, no network. Run: bun test.

import { expect, test } from "bun:test";
import { MAX_RETRY_WAIT_MS } from "../../../src/platform/http/retry-after";
import { createHostGate, memoryStore } from "../../../src/platform/http/host-gate";
import {
  fetchWithRetry,
  isHostCoolingDown,
  isRateLimitError,
  RateLimitError,
} from "../../../src/platform/http/throttled-fetch";

test("fetchWithRetry honours Retry-After once, not on top of the backoff", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const responses = [
    new Response("slow", { status: 429, headers: { "retry-after": "2" } }),
    new Response("ok", { status: 200 }),
  ];
  const res = await fetchWithRetry("https://api.semanticscholar.org/x", undefined, {
    fetchFn: async () => responses[calls++],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  expect(res.status).toBe(200);
  expect(calls).toBe(2);
  expect(sleeps).toEqual([2000]); // exactly the Retry-After, no extra backoff sleep
});

test("a Retry-After given as an HTTP date is honoured, not read as NaN", async () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  let calls = 0;
  const sleeps: number[] = [];
  const responses = [
    new Response("slow", {
      status: 429,
      headers: { "retry-after": new Date(now + 12_000).toUTCString() },
    }),
    new Response("ok", { status: 200 }),
  ];
  const res = await fetchWithRetry("https://api.semanticscholar.org/x", undefined, {
    fetchFn: async () => responses[calls++],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => now,
  });
  expect(res.status).toBe(200);
  // 5000 here would mean the date was dropped and the 429 backoff took over.
  expect(sleeps).toEqual([12_000]);
});

test("a Retry-After longer than the cap waits only the cap", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const responses = [
    new Response("slow", { status: 429, headers: { "retry-after": "999999" } }),
    new Response("ok", { status: 200 }),
  ];
  const res = await fetchWithRetry("https://api.semanticscholar.org/x", undefined, {
    fetchFn: async () => responses[calls++],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  expect(res.status).toBe(200);
  expect(sleeps).toEqual([MAX_RETRY_WAIT_MS]);
  expect(MAX_RETRY_WAIT_MS).toBeLessThan(999_999 * 1000);
});

test("a terminal 429 throws RateLimitError naming the host", async () => {
  const err = await fetchWithRetry("https://api.semanticscholar.org/graph/v1/paper/search", undefined, {
    retries: 1,
    fetchFn: async () => new Response("no", { status: 429 }),
    sleep: async () => {},
  }).then(
    () => null,
    (e) => e,
  );
  expect(isRateLimitError(err)).toBe(true);
  expect((err as RateLimitError).message).toBe("HTTP 429 from api.semanticscholar.org");
});

test("429 backoff uses a higher base than 5xx/network", async () => {
  const sleeps: number[] = [];
  await fetchWithRetry("https://api.semanticscholar.org/x", undefined, {
    retries: 1,
    fetchFn: async () => new Response("", { status: 429 }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  }).catch(() => {});
  expect(sleeps).toHaveLength(1);
  expect(sleeps[0]).toBeGreaterThanOrEqual(5000);
});

test("a 429 from a host now cooling down ends the loop without a retry or a wait", async () => {
  let t = 0;
  const gate = createHostGate({ clock: { now: () => t, sleep: async (ms) => void (t += ms) }, store: memoryStore() });
  let calls = 0;
  const sleeps: number[] = [];
  const fetchFn = async () => {
    calls++;
    const res = new Response("", { status: 429 });
    await gate.observe("export.arxiv.org", res);
    return res;
  };
  const err = await fetchWithRetry("https://export.arxiv.org/api/query?x", undefined, {
    fetchFn,
    gate,
    retries: 3,
    sleep: async (ms) => void sleeps.push(ms),
  }).catch((e) => e);
  expect(isHostCoolingDown(err)).toBe(true);
  expect(isRateLimitError(err)).toBe(true);
  expect(calls).toBe(1);
  expect(sleeps).toEqual([]);
});

test("a cooldown thrown by the transport is not retried", async () => {
  const gate = createHostGate({ store: memoryStore() });
  await gate.observe("arxiv.org", new Response("", { status: 429 }));
  let calls = 0;
  const fetchFn = async (url: string) => {
    calls++;
    const cooling = gate.coolingDown(new URL(url).hostname);
    if (cooling) throw cooling;
    return new Response("ok");
  };
  const err = await fetchWithRetry("https://arxiv.org/html/2401.00001", undefined, {
    fetchFn,
    retries: 3,
    sleep: async () => {},
  }).catch((e) => e);
  expect(isHostCoolingDown(err)).toBe(true);
  expect(calls).toBe(1);
});
