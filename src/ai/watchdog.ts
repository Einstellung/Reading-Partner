// A stall watchdog with auto-retry for long streaming AI calls, shared by the
// unattended pipelines (lesson prep, notes). A plan/digest/chapter call streams
// for minutes and can silently cut mid-response; this races the call against an
// AbortController whose timer resets on every delta, aborts after watchdogMs of
// silence, and retries a fresh attempt up to maxAttempts (waiting retryDelayMs
// between). Only the last error, after every attempt, propagates. An external
// stopSignal breaks the retry loop with StoppedError so a user Stop isn't
// mistaken for a transient failure. A failure the provider itself called
// deterministic — a bad key, an exhausted balance, a prompt over the context
// window — is not retried at all. Timers are injected so tests drive it on a
// virtual clock.

import { isContextOverflow, isRetryableAssistantError } from "@earendil-works/pi-ai";
import { ModelCallError } from "./providers";

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
// beforeRetry fires after a failed attempt that will be repeated, before the flat
// retry delay, and is awaited: it is where a caller running several calls at once
// makes the group sit out a rate limit rather than letting this one call retry
// straight into the same minute (src/ai/limiter).
export interface WatchdogHooks {
  onAttempt(info: { attempt: number; attempts: number; startedAt: number }): void;
  onProgress(chars: number): void;
  beforeRetry?(err: unknown, attempt: number): Promise<void> | void;
}

// Thrown when stopSignal aborts, to distinguish a deliberate stop from a failure.
export class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}

// Whether a failed attempt is worth repeating.
//
// Only a failure the provider answered with can be judged, and pi's classifier
// judges it. Two things have to be settled before asking it:
//
//   - A context overflow is deterministic, but pi's retryable table matches
//     "500" as a plain substring, so "prompt is too long: 205000 tokens" reads
//     as a retryable 500. pi's own guidance is to take overflow out first.
//   - `terminal` is our own mark for a failure that never touched the network.
//
// Anything else with no AssistantMessage is retried, exactly as before. That is
// where a stall lands (it can only reach us as an abort, with no provider
// verdict to consult) and where an unparseable reply lands (re-asking the model
// does fix those). The stall is also caught one step earlier by the caller, and
// on purpose: pi's classifier answers false for the wording "stalled: no
// response for 60s", so a stall must never be routed through here.
export function isRetryableAiFailure(err: unknown): boolean {
  if (!(err instanceof ModelCallError)) return true;
  if (err.terminal) return false;
  if (!err.assistant) return true;
  if (isContextOverflow(err.assistant)) return false;
  return isRetryableAssistantError(err.assistant);
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
// the stream. A stall abort is transient by definition and always retried, up to
// maxAttempts; any other failure is retried only if isRetryableAiFailure says so.
// stopSignal (a user Stop) aborts the in-flight attempt and breaks the loop with
// StoppedError.
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
    // pi does settle an aborted call on its own now (0.82.1 pushes
    // {type:"error", reason:"aborted"} and ends the iterator), so this race is no
    // longer about a call that never returns. It stays for two reasons: it gives
    // the stall its own wording rather than the provider's, and it covers the
    // Tauri http plugin leaving an aborted request unsettled (docs/pitfall/26).
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new Error("stalled: no response for 60s"));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener("abort", fail, { once: true });
    });

    try {
      return await Promise.race([invoke({ signal: controller.signal, onProgress }), aborted]);
    } catch (e) {
      lastErr = e;
      // A user Stop outranks every classification: it is not a failure.
      if (stopSignal?.aborted) throw new StoppedError();
      // Our own watchdog fired. Whatever the call rejected with describes the
      // abort, not the reason the stream fell silent, so there is nothing to
      // classify — a stall is transient by definition and always retried. This
      // has to come before the classifier: the unattended pipelines are exactly
      // where a stall happens and exactly where it can't be reproduced locally.
      if (!controller.signal.aborted && !isRetryableAiFailure(e)) break;
      if (attempt < maxAttempts) {
        await hooks.beforeRetry?.(e, attempt);
        await timers.sleep(retryDelayMs);
      }
    } finally {
      cancelTimer();
      if (stopSignal) stopSignal.removeEventListener("abort", onStop);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
