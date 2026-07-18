// A stall watchdog with auto-retry for long streaming AI calls, shared by the
// unattended pipelines (lesson prep, notes). A plan/digest/chapter call streams
// for minutes and can silently cut mid-response; this races the call against an
// AbortController whose timer resets on every delta, aborts after watchdogMs of
// silence, and retries a fresh attempt up to maxAttempts (waiting retryDelayMs
// between). Only the last error, after every attempt, propagates. An external
// stopSignal breaks the retry loop with StoppedError so a user Stop isn't
// mistaken for a transient failure. Timers are injected so tests drive it on a
// virtual clock.

export const DEFAULT_WATCHDOG_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY_MS = 2_000;

// The invoke contract a long AI call receives: an abort signal it must honor,
// and a progress callback fired with the cumulative received character count as
// deltas arrive.
export interface AiCallOptions {
  signal: AbortSignal;
  onProgress(chars: number): void;
}

export interface WatchdogConfig {
  watchdogMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

// Injected clock/timers so tests never touch real time.
export interface WatchdogTimers {
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(ms: number, cb: () => void): () => void;
}

// Lifecycle hooks the caller wires to its own liveness/activity state: onAttempt
// fires as each attempt starts (attempt is 1-based), onProgress on every delta.
export interface WatchdogHooks {
  onAttempt(info: { attempt: number; attempts: number; startedAt: number }): void;
  onProgress(chars: number): void;
}

// Thrown when stopSignal aborts, to distinguish a deliberate stop from a failure.
export class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}

export function resolveWatchdogConfig(partial: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    watchdogMs: partial.watchdogMs ?? DEFAULT_WATCHDOG_MS,
    maxAttempts: partial.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: partial.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  };
}

// Run one long AI call under a stall watchdog with auto-retry. The watchdog is an
// AbortController whose timer resets on every delta; watchdogMs of silence aborts
// the stream. A stall abort or any stream error is transient: retry a fresh
// attempt up to maxAttempts. stopSignal (a user Stop) aborts the in-flight
// attempt and breaks the loop with StoppedError.
export async function runWithWatchdog<T>(
  invoke: (opts: AiCallOptions) => Promise<T>,
  config: WatchdogConfig,
  timers: WatchdogTimers,
  hooks: WatchdogHooks,
  stopSignal?: AbortSignal,
): Promise<T> {
  const { watchdogMs, maxAttempts, retryDelayMs } = config;
  const startedAt = timers.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (stopSignal?.aborted) throw new StoppedError();
    const controller = new AbortController();
    // A user Stop aborts the in-flight attempt immediately.
    const onStop = () => controller.abort();
    if (stopSignal) stopSignal.addEventListener("abort", onStop, { once: true });

    hooks.onAttempt({ attempt, attempts: maxAttempts, startedAt });

    let cancelTimer = timers.setTimer(watchdogMs, () => controller.abort());
    const rearm = () => {
      cancelTimer();
      cancelTimer = timers.setTimer(watchdogMs, () => controller.abort());
    };
    const onProgress = (chars: number) => {
      rearm();
      hooks.onProgress(chars);
    };
    // The loop-based call swallows aborts silently (no onError), so race the call
    // against an explicit abort rejection to guarantee progress.
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new Error("stalled: no response for 60s"));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener("abort", fail, { once: true });
    });

    try {
      return await Promise.race([invoke({ signal: controller.signal, onProgress }), aborted]);
    } catch (e) {
      lastErr = e;
      if (stopSignal?.aborted) throw new StoppedError();
      if (attempt < maxAttempts) await timers.sleep(retryDelayMs);
    } finally {
      cancelTimer();
      if (stopSignal) stopSignal.removeEventListener("abort", onStop);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
