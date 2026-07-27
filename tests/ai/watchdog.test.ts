// Unit tests for the shared stall watchdog (src/ai/watchdog.ts), driven on a
// virtual clock so no real time passes. Run: bun test.

import { expect, test } from "bun:test";
import { fauxAssistantMessage, isRetryableAssistantError } from "@earendil-works/pi-ai";
import { ModelCallError } from "../../src/ai/providers";
import {
  isRetryableAiFailure,
  runWithWatchdog,
  StoppedError,
  resolveWatchdogConfig,
  type WatchdogHooks,
} from "../../src/ai/watchdog";

// A failure as it reaches the watchdog: pi's AssistantMessage for the failed
// turn, wrapped the way callModel wraps it.
function providerFailure(errorMessage: string): ModelCallError {
  return new ModelCallError(errorMessage, {
    assistant: fauxAssistantMessage("", { stopReason: "error", errorMessage }),
  });
}

// The same virtual clock the prep pipeline tests use: events fire in due-time
// order, one macrotask tick per step so imminent settles win over the watchdog.
function makeClock(start = 1000) {
  interface Ev {
    at: number;
    seq: number;
    fire: () => void;
    cancelled: boolean;
  }
  let now = start;
  let seq = 0;
  let pumping = false;
  const q: Ev[] = [];
  function schedule(ms: number, fire: () => void): Ev {
    const ev: Ev = { at: now + Math.max(0, ms), seq: seq++, fire, cancelled: false };
    q.push(ev);
    ensurePump();
    return ev;
  }
  function ensurePump(): void {
    if (pumping) return;
    pumping = true;
    void pump();
  }
  async function pump(): Promise<void> {
    for (let guard = 0; guard < 100000; guard++) {
      await new Promise<void>((r) => setTimeout(r, 0));
      const live = q.filter((e) => !e.cancelled);
      if (live.length === 0) {
        pumping = false;
        return;
      }
      live.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const ev = live[0];
      q.splice(q.indexOf(ev), 1);
      if (ev.at > now) now = ev.at;
      ev.fire();
    }
    pumping = false;
  }
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => schedule(ms, resolve)),
    setTimer: (ms: number, cb: () => void) => {
      const ev = schedule(ms, cb);
      return () => {
        ev.cancelled = true;
      };
    },
  };
}

function noopHooks(): WatchdogHooks {
  return { onAttempt: () => {}, onProgress: () => {} };
}

test("a live stream completes on the first attempt", async () => {
  const clock = makeClock();
  const attempts: number[] = [];
  const out = await runWithWatchdog(
    async ({ onProgress }) => {
      onProgress(10);
      return "done";
    },
    resolveWatchdogConfig(),
    clock,
    { onAttempt: (i) => attempts.push(i.attempt), onProgress: () => {} },
  );
  expect(out).toBe("done");
  expect(attempts).toEqual([1]);
});

test("a stalled stream is aborted, retried, and fails after every attempt", async () => {
  const clock = makeClock();
  let attempts = 0;
  const t0 = clock.now();
  await expect(
    runWithWatchdog(
      ({ signal }) =>
        new Promise<string>((_, reject) => {
          attempts++;
          signal.addEventListener("abort", () => reject(new Error("cut")), { once: true });
        }),
      resolveWatchdogConfig({ retryDelayMs: 100 }),
      clock,
      noopHooks(),
    ),
  ).rejects.toThrow(/stalled|cut/);
  expect(attempts).toBe(3);
  // Three 60s watchdog windows elapsed on the virtual clock.
  expect(clock.now() - t0).toBeGreaterThanOrEqual(180_000);
});

test("progress resets the watchdog so a slow-but-alive call completes", async () => {
  const clock = makeClock();
  const out = await runWithWatchdog(
    async ({ onProgress }) => {
      for (let i = 0; i < 5; i++) {
        await clock.sleep(40_000); // under the 60s window each time
        onProgress((i + 1) * 10);
      }
      return "ok";
    },
    resolveWatchdogConfig(),
    clock,
    noopHooks(),
  );
  expect(out).toBe("ok");
});

test("an external stop aborts the attempt and throws StoppedError, no retry", async () => {
  // Real timers with a watchdog window far larger than the test, so the only
  // thing that aborts the attempt is the external stop.
  const realTimers = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    setTimer: (ms: number, cb: () => void) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
  };
  const stop = new AbortController();
  let attempts = 0;
  const promise = runWithWatchdog(
    ({ signal }) =>
      new Promise<string>((_, reject) => {
        attempts++;
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    resolveWatchdogConfig({ watchdogMs: 1_000_000 }),
    realTimers,
    noopHooks(),
    stop.signal,
  );
  // Let the first attempt begin, then stop.
  await new Promise((r) => setTimeout(r, 5));
  stop.abort();
  await expect(promise).rejects.toBeInstanceOf(StoppedError);
  expect(attempts).toBe(1); // no retry after a stop
});

test("a failure with no provider verdict stays retryable", () => {
  // A stall, an unparseable reply, anything raised on our own side: nothing to
  // classify, so the answer is the behaviour the pipelines already relied on.
  expect(isRetryableAiFailure(new Error("stalled: no response for 60s"))).toBe(true);
  expect(isRetryableAiFailure(new Error("plan JSON did not parse"))).toBe(true);
  expect(isRetryableAiFailure(new ModelCallError("something local went wrong"))).toBe(true);
});

test("a failure marked terminal is never retried", () => {
  const err = new ModelCallError("no default AI provider configured (Settings)", { terminal: true });
  expect(isRetryableAiFailure(err)).toBe(false);
});

test("the provider's own verdict decides for provider failures", () => {
  expect(isRetryableAiFailure(providerFailure("Overloaded"))).toBe(true);
  expect(isRetryableAiFailure(providerFailure("503 Service Unavailable"))).toBe(true);
  expect(isRetryableAiFailure(providerFailure("fetch failed"))).toBe(true);

  expect(isRetryableAiFailure(providerFailure("invalid x-api-key"))).toBe(false);
  expect(isRetryableAiFailure(providerFailure("insufficient_quota: check your billing"))).toBe(false);
  expect(isRetryableAiFailure(providerFailure("Monthly usage limit reached"))).toBe(false);
});

test("a context overflow is taken out before pi's classifier can misread it", () => {
  const overflow = "prompt is too long: 205000 tokens > 200000 maximum";
  // Left to pi alone this reads as retryable, because its pattern table matches
  // "500" as a substring of the token count. Hence the order in the classifier.
  expect(isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage: overflow }))).toBe(
    true,
  );
  expect(isRetryableAiFailure(providerFailure(overflow))).toBe(false);
});

test("a deterministic provider failure fails on the first attempt", async () => {
  const clock = makeClock();
  let attempts = 0;
  await expect(
    runWithWatchdog(
      async () => {
        attempts++;
        throw providerFailure("invalid x-api-key");
      },
      resolveWatchdogConfig({ retryDelayMs: 100 }),
      clock,
      noopHooks(),
    ),
  ).rejects.toThrow(/invalid x-api-key/);
  expect(attempts).toBe(1);
});

test("a transient provider failure still spends the whole retry budget", async () => {
  const clock = makeClock();
  let attempts = 0;
  await expect(
    runWithWatchdog(
      async () => {
        attempts++;
        throw providerFailure("Overloaded");
      },
      resolveWatchdogConfig({ retryDelayMs: 100 }),
      clock,
      noopHooks(),
    ),
  ).rejects.toThrow(/Overloaded/);
  expect(attempts).toBe(3);
});

test("a stalled stream is retried even though its wording classifies as non-retryable", async () => {
  // The stall's own message would be refused by pi's classifier, so the abort
  // check must come first. This is the same guarantee as the stall test above,
  // pinned against the classifier rather than against the abort plumbing.
  const stallWording = fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: "stalled: no response for 60s",
  });
  expect(isRetryableAssistantError(stallWording)).toBe(false);
  // So is the wording a provider gives an aborted request, which is what the
  // silent call below rejects with.
  expect(isRetryableAiFailure(providerFailure("Request was aborted"))).toBe(false);

  const clock = makeClock();
  let attempts = 0;
  await expect(
    runWithWatchdog(
      ({ signal }) =>
        new Promise<string>((_, reject) => {
          attempts++;
          // A silent stream: the call only ever settles because we abort it, and
          // it reports the abort as a provider error the classifier would refuse.
          signal.addEventListener("abort", () => reject(providerFailure("Request was aborted")), {
            once: true,
          });
        }),
      resolveWatchdogConfig({ retryDelayMs: 100 }),
      clock,
      noopHooks(),
    ),
  ).rejects.toThrow(/stalled|aborted/);
  expect(attempts).toBe(3);
});
