// Unit tests for the prep HTTP layer: per-host throttle spacing, Retry-After
// handling, and terminal-429 -> RateLimitError. All fake clocks/fetches — no
// real timers, no network. Run: bun test.

import { expect, test } from "bun:test";
import {
  createThrottle,
  fetchWithRetry,
  isRateLimitError,
  RateLimitError,
} from "../../src/prep/http";

test("createThrottle spaces same-host requests and passes untracked hosts through", async () => {
  let t = 0;
  const sleeps: number[] = [];
  const clock = {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  const throttle = createThrottle({ "api.semanticscholar.org": 1500 }, clock);
  await throttle("api.semanticscholar.org"); // first: no wait
  await throttle("api.semanticscholar.org"); // one interval
  await throttle("api.semanticscholar.org"); // one interval
  expect(sleeps).toEqual([1500, 1500]);
  await throttle("example.com"); // untracked host: no spacing
  expect(sleeps).toEqual([1500, 1500]);
});

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
