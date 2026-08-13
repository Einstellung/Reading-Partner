// fetchText's retry policy (src/info/extract/http.ts): what it waits when a
// source names a Retry-After, what it waits when it does not, that the cap
// holds, and that a stopped run does not sit out the cooldown. Fake fetch, fake
// clock, fake sleep — no network and no real timers. Run: bun test.
//
// The assertions are on an ordered log rather than a list of durations, because
// the point of the wait is that it happens *before* the next request: a dropped
// `await` would still record the sleep.

import { expect, test } from "bun:test";
import { isAbortError } from "../../src/platform/app/abort";
import type { FetchFn } from "../../src/platform/app/host";
import {
  MAX_RETRY_WAIT_MS,
  fetchText,
  retryAfterMs,
  retryBackoffMs,
} from "../../src/info/extract/http";

// A fixed wall clock, so an HTTP-date Retry-After has something to be relative to.
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

interface Harness {
  fetchFn: FetchFn;
  log: string[];
  opts: { sleep: (ms: number) => Promise<void>; now: () => number };
}

// `responses` is served one per call; the last one repeats if the loop asks for
// more. Sleeps resolve on a later turn, like a real timer, and bracket
// themselves in the log so an unawaited wait shows up as a fetch in between.
function harness(responses: (() => Response)[], onSleep?: () => void): Harness {
  const log: string[] = [];
  let call = 0;
  const fetchFn: FetchFn = async () => {
    const make = responses[Math.min(call, responses.length - 1)];
    log.push(`fetch ${++call}`);
    return make();
  };
  const sleep = (ms: number) => {
    log.push(`wait ${ms}`);
    onSleep?.();
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        log.push(`waited ${ms}`);
        resolve();
      }, 0),
    );
  };
  return { fetchFn, log, opts: { sleep, now: () => NOW } };
}

function rateLimited(retryAfter?: string): () => Response {
  return () =>
    new Response("slow down", {
      status: 429,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
}

const ok = (body: string) => () => new Response(body, { status: 200 });

test("a 429 with Retry-After in seconds waits that long before retrying", async () => {
  const h = harness([rateLimited("2"), ok("the article")]);

  const text = await fetchText("https://example.com/a", h.fetchFn, undefined, h.opts);

  expect(text).toBe("the article");
  expect(h.log).toEqual(["fetch 1", "wait 2000", "waited 2000", "fetch 2"]);
});

test("a Retry-After given as an HTTP date waits until that date", async () => {
  const at = new Date(NOW + 12_000).toUTCString();
  const h = harness([rateLimited(at), ok("later")]);

  await fetchText("https://example.com/a", h.fetchFn, undefined, h.opts);

  expect(h.log).toEqual(["fetch 1", "wait 12000", "waited 12000", "fetch 2"]);
});

test("a malformed Retry-After falls back to the normal backoff", async () => {
  const h = harness([rateLimited("in a bit"), rateLimited("in a bit"), ok("finally")]);

  const text = await fetchText("https://example.com/a", h.fetchFn, undefined, h.opts);

  expect(text).toBe("finally");
  expect(h.log.filter((l) => l.startsWith("wait "))).toEqual(["wait 500", "wait 1000"]);
  expect(retryBackoffMs(0)).toBe(500);
});

test("a 429 with no Retry-After at all backs off the same way", async () => {
  const h = harness([rateLimited(), ok("fine")]);

  await fetchText("https://example.com/a", h.fetchFn, undefined, h.opts);

  expect(h.log).toEqual(["fetch 1", "wait 500", "waited 500", "fetch 2"]);
});

test("a Retry-After longer than the cap waits only the cap", async () => {
  const h = harness([rateLimited("3600"), ok("an hour early")]);

  await fetchText("https://example.com/a", h.fetchFn, undefined, h.opts);

  expect(h.log).toEqual([
    "fetch 1",
    `wait ${MAX_RETRY_WAIT_MS}`,
    `waited ${MAX_RETRY_WAIT_MS}`,
    "fetch 2",
  ]);
  expect(MAX_RETRY_WAIT_MS).toBeLessThan(3600 * 1000);
});

test("a 5xx still retries, and now waits between attempts", async () => {
  const h = harness([() => new Response("boom", { status: 503 }), ok("recovered")]);

  const text = await fetchText("https://example.com/a", h.fetchFn, undefined, h.opts);

  expect(text).toBe("recovered");
  expect(h.log).toEqual(["fetch 1", "wait 500", "waited 500", "fetch 2"]);
});

test("the retry budget is spent, not exceeded: no wait after the last attempt", async () => {
  const h = harness([rateLimited("1")]);

  await expect(
    fetchText("https://example.com/a", h.fetchFn, undefined, { ...h.opts, retries: 2 }),
  ).rejects.toThrow("HTTP 429");

  expect(h.log).toEqual([
    "fetch 1",
    "wait 1000",
    "waited 1000",
    "fetch 2",
    "wait 1000",
    "waited 1000",
    "fetch 3",
  ]);
});

test("a run stopped during the wait gives up instead of sitting it out", async () => {
  const controller = new AbortController();
  // The wait never ends on its own; only the abort can release it.
  const log: string[] = [];
  let call = 0;
  const fetchFn: FetchFn = async () => {
    log.push(`fetch ${++call}`);
    return new Response("slow down", { status: 429, headers: { "Retry-After": "3600" } });
  };
  const sleep = (ms: number) => {
    log.push(`wait ${ms}`);
    controller.abort();
    return new Promise<void>(() => {});
  };

  // Raced against a short timer rather than awaited: a wait that ignores the
  // abort never settles at all, and "the test hung" is not a failure anyone
  // reads.
  const pending = fetchText("https://example.com/a", fetchFn, undefined, {
    sleep,
    now: () => NOW,
    signal: controller.signal,
  });
  const outcome = await Promise.race([
    pending.then(
      () => "returned a body",
      (e) => (isAbortError(e) ? "gave up" : `failed with ${String(e)}`),
    ),
    new Promise<string>((r) => setTimeout(() => r("still waiting"), 50)),
  ]);

  expect(outcome).toBe("gave up");
  expect(log).toEqual(["fetch 1", `wait ${MAX_RETRY_WAIT_MS}`]);
});

test("retryAfterMs reads both forms and refuses the rest", () => {
  expect(retryAfterMs(null, NOW)).toBeNull();
  expect(retryAfterMs("", NOW)).toBeNull();
  expect(retryAfterMs("120", NOW)).toBe(120_000);
  expect(retryAfterMs("  120  ", NOW)).toBe(120_000);
  expect(retryAfterMs("0", NOW)).toBe(0);
  expect(retryAfterMs(new Date(NOW + 30_000).toUTCString(), NOW)).toBe(30_000);
  // A date that has already passed is not a negative wait.
  expect(retryAfterMs(new Date(NOW - 30_000).toUTCString(), NOW)).toBe(0);
  expect(retryAfterMs("tomorrow", NOW)).toBeNull();
  expect(retryAfterMs("-5", NOW)).toBeNull();
});
