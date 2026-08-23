// The shared `Retry-After` parser (src/platform/http/retry-after.ts): both RFC
// forms, and every value it refuses so the caller falls back to its own backoff.
// Pure — no clock, no network. Run: bun test.

import { expect, test } from "bun:test";
import { MAX_RETRY_WAIT_MS, retryAfterMs } from "../../src/platform/http/retry-after";

// A fixed wall clock, so an HTTP-date Retry-After has something to be relative to.
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

test("retryAfterMs reads both forms and refuses the rest", () => {
  expect(retryAfterMs(null, NOW)).toBeNull();
  expect(retryAfterMs("", NOW)).toBeNull();
  expect(retryAfterMs("120", NOW)).toBe(120_000);
  expect(retryAfterMs("  120  ", NOW)).toBe(120_000);
  expect(retryAfterMs("0", NOW)).toBe(0);
  expect(retryAfterMs(new Date(NOW + 30_000).toUTCString(), NOW)).toBe(30_000);
  // A date naming a moment already gone is no wait at all.
  expect(retryAfterMs(new Date(NOW - 30_000).toUTCString(), NOW)).toBe(0);
  expect(retryAfterMs("tomorrow", NOW)).toBeNull();
  expect(retryAfterMs("-5", NOW)).toBeNull();
});

test("the parser reports what the server asked; the cap is the caller's to apply", () => {
  expect(retryAfterMs("999999", NOW)).toBe(999_999_000);
  expect(MAX_RETRY_WAIT_MS).toBeLessThan(3600 * 1000);
});
