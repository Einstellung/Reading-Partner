// Unit tests for the shared stall watchdog (src/ai/watchdog.ts), driven on a
// virtual clock so no real time passes. Run: bun test.

import { expect, test } from "bun:test";
import {
  runWithWatchdog,
  StoppedError,
  resolveWatchdogConfig,
  type WatchdogHooks,
} from "../../src/ai/watchdog";

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
