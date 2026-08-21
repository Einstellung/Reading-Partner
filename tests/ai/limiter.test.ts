// Unit tests for the shared pacing limiter (src/ai/limiter.ts), driven on a
// virtual clock so no real time passes. Run: bun test.

import { expect, test } from "bun:test";
import {
  CallLimiter,
  cooldownAfter,
  COOLDOWN_LADDER_MS,
  isRateLimited,
  namedRetryAfterMs,
  retryAfterMs,
} from "../../src/ai/limiter";
import { StoppedError } from "../../src/ai/watchdog";

// The same virtual clock the watchdog and prep tests use: events fire in
// due-time order, one macrotask tick per step.
function makeClock(start = 1000) {
  interface Ev {
    at: number;
    seq: number;
    fire: () => void;
  }
  let now = start;
  let seq = 0;
  let pumping = false;
  const q: Ev[] = [];
  function schedule(ms: number, fire: () => void): void {
    q.push({ at: now + Math.max(0, ms), seq: seq++, fire });
    if (!pumping) {
      pumping = true;
      void pump();
    }
  }
  async function pump(): Promise<void> {
    for (let guard = 0; guard < 100000; guard++) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (q.length === 0) {
        pumping = false;
        return;
      }
      q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const ev = q.shift()!;
      if (ev.at > now) now = ev.at;
      ev.fire();
    }
    pumping = false;
  }
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => schedule(ms, resolve)),
    // Advance the clock by running whatever is queued, plus a few idle ticks so
    // resumed continuations get to run.
    settle: async () => {
      for (let i = 0; i < 200; i++) await new Promise<void>((r) => setTimeout(r, 0));
    },
  };
}

// A call that finishes after `ms` on the virtual clock, recording when it ran.
function makeWork(clock: ReturnType<typeof makeClock>, log: { index: number; at: number }[]) {
  return (index: number, ms = 1000) =>
    async (): Promise<number> => {
      log.push({ index, at: clock.now() });
      await clock.sleep(ms);
      return index;
    };
}

test("the ladder is the prep cooldown ladder, and runs out", () => {
  expect(cooldownAfter(0)).toBe(COOLDOWN_LADDER_MS[0]);
  expect(cooldownAfter(2)).toBe(COOLDOWN_LADDER_MS[2]);
  expect(cooldownAfter(3)).toBeNull();
  expect(cooldownAfter(-1)).toBe(COOLDOWN_LADDER_MS[0]);
});

test("retryAfterMs reads seconds and HTTP dates, and ignores the past", () => {
  expect(retryAfterMs("30", 0)).toBe(30_000);
  expect(retryAfterMs(" 0 ", 0)).toBe(0);
  expect(retryAfterMs("not a number", 0)).toBeNull();
  expect(retryAfterMs(undefined, 0)).toBeNull();
  const now = Date.parse("2026-08-19T10:00:00Z");
  expect(retryAfterMs("Wed, 19 Aug 2026 10:01:00 GMT", now)).toBe(60_000);
  expect(retryAfterMs("Wed, 19 Aug 2026 09:59:00 GMT", now)).toBeNull();
});

test("a rate limit is recognized from the message or the provider's own message", () => {
  expect(isRateLimited(new Error("HTTP 429: rate_limit_error"))).toBe(true);
  expect(isRateLimited({ assistant: { errorMessage: "Overloaded" } })).toBe(true);
  expect(isRateLimited(new Error("prompt is too long: 205000 tokens"))).toBe(false);
  expect(namedRetryAfterMs(new Error('{"error":"rate limit","retry-after":42}'))).toBe(42_000);
  expect(namedRetryAfterMs(new Error("429 too many requests, try again in 7 seconds"))).toBe(7_000);
  expect(namedRetryAfterMs(new Error("429 too many requests"))).toBeNull();
});

test("no more than `limit` calls are in flight at once", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 2, rampMs: 0 }, clock);
  let live = 0;
  let peak = 0;
  const run = (): Promise<void> =>
    limiter.run(async () => {
      live++;
      peak = Math.max(peak, live);
      await clock.sleep(1000);
      live--;
    });
  const all = Promise.all([run(), run(), run(), run(), run(), run()]);
  await clock.settle();
  await all;
  expect(peak).toBe(2);
});

test("starts are staggered by rampMs, so six calls do not open at once", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 6, rampMs: 3_000 }, clock);
  const log: { index: number; at: number }[] = [];
  const work = makeWork(clock, log);
  const t0 = clock.now();
  const all = Promise.all(Array.from({ length: 6 }, (_, i) => limiter.run(work(i, 60_000))));
  await clock.settle();
  await all;
  expect(log.length).toBe(6);
  const starts = log.map((e) => e.at - t0).sort((a, b) => a - b);
  expect(starts[0]).toBe(0);
  // Every start is at least a ramp behind the one before it.
  for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(3_000);
});

test("a rate limit pauses the whole group and halves the ceiling", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 4, rampMs: 0 }, clock);
  const wait = limiter.noteFailure(new Error("HTTP 429 rate limit; retry-after: 30"));
  expect(wait).toBe(30_000);
  expect(limiter.ceiling).toBe(2);
  const pausedUntil = limiter.pausedUntil;

  const log: { index: number; at: number }[] = [];
  const work = makeWork(clock, log);
  const all = Promise.all([limiter.run(work(0, 10)), limiter.run(work(1, 10))]);
  await clock.settle();
  await all;
  // Neither call started before the pause was over: a 429 slows the group, it
  // does not let one path retry into the same minute.
  for (const entry of log) expect(entry.at).toBeGreaterThanOrEqual(pausedUntil);
});

test("with no interval named, the pause walks the ladder", () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 6, rampMs: 0 }, clock);
  expect(limiter.noteFailure(new Error("429 too many requests"))).toBe(COOLDOWN_LADDER_MS[0]);
  expect(limiter.noteFailure(new Error("429 too many requests"))).toBe(COOLDOWN_LADDER_MS[1]);
  expect(limiter.ceiling).toBe(1);
  // A failure that is not a rate limit changes nothing.
  expect(limiter.noteFailure(new Error("model stream ended without a final message"))).toBe(0);
});

test("hold waits out the pause and returns at once when there is none", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 6, rampMs: 0 }, clock);
  const t0 = clock.now();
  await limiter.hold();
  expect(clock.now()).toBe(t0);
  limiter.noteFailure(new Error("429, retry after 12 seconds"));
  const held = limiter.hold();
  await clock.settle();
  await held;
  expect(clock.now() - t0).toBeGreaterThanOrEqual(12_000);
});

test("the ceiling climbs back once the group has run clear of the last limit", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 4, rampMs: 0, recoverMs: 60_000 }, clock);
  limiter.noteFailure(new Error("429, retry-after: 1"));
  expect(limiter.ceiling).toBe(2);
  const done = limiter.run(async () => {
    await clock.sleep(120_000);
  });
  await clock.settle();
  await done;
  expect(limiter.ceiling).toBe(3);
});

test("a waiting call gives up when the run is stopped", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 1, rampMs: 0 }, clock);
  const controller = new AbortController();
  const first = limiter.run(async () => {
    await clock.sleep(60_000);
  });
  let queuedRan = false;
  const queued = limiter
    .run(async () => {
      queuedRan = true;
      return "never";
    }, controller.signal)
    .catch((e) => e);
  controller.abort();
  expect(await queued).toBeInstanceOf(StoppedError);
  expect(queuedRan).toBe(false);
  await clock.settle();
  await first;
});

test("a call waiting out a pause gives up when the run is stopped", async () => {
  const clock = makeClock();
  const limiter = new CallLimiter({ limit: 4, rampMs: 0 }, clock);
  limiter.noteFailure(new Error("429 rate limit")); // a 60s pause, unattended
  const controller = new AbortController();
  const queued = limiter.run(async () => "never", controller.signal).catch((e) => e);
  controller.abort();
  expect(await queued).toBeInstanceOf(StoppedError);
});
