// The shared pacing device for unattended AI work: how many long calls may be in
// flight at once, how far apart they start, and what the whole group does when a
// provider pushes back. Injected timers, no provider imports — the whole thing
// runs on a virtual clock in bun tests.
//
// Why the group and not the call: the subscription OAuth this app uses is
// limited by tokens and requests per minute, not by concurrency, so a 429 is
// never "this one call was unlucky" — it is the group being told to slow down.
// A per-call retry answers it by hammering the same minute from six directions.
// So a rate limit pauses every waiting call, halves the ceiling, and lets the
// ceiling climb back only after the pause has been clear for a while.
//
// The cooldown ladder is the one the prep pipeline has always used for
// rate-limited paper fetches (60s / 5min / 15min, then give up); it lives here
// now so both callers share it.

import { StoppedError } from "./watchdog";

// How long to wait after each successive rate limit that named no interval of
// its own. After the last rung is spent there is nothing left to wait for.
export const COOLDOWN_LADDER_MS: readonly number[] = [60_000, 300_000, 900_000];

// The wait for cooldown round `round` (0-based), or null when the ladder is
// spent. Pure; prep asks it per paper, the limiter per group.
export function cooldownAfter(round: number, ladder: readonly number[] = COOLDOWN_LADDER_MS): number | null {
  if (!Number.isFinite(round) || round < 0) return ladder[0] ?? null;
  return round < ladder.length ? ladder[round] : null;
}

// A `Retry-After` value in either form the RFC allows: a delay in seconds, or an
// HTTP date. Null when it is neither, or when the date has already passed.
export function retryAfterMs(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return null;
  return at > now ? at - now : null;
}

// Everything a failure can say about itself in text: its own message, plus the
// provider's message when pi carried one back on the AssistantMessage. Read by
// duck typing rather than by importing ModelCallError, so this module stays free
// of the provider stack (and of its import cost in tests).
function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (!err || typeof err !== "object") return "";
  const e = err as { message?: unknown; assistant?: { errorMessage?: unknown } };
  const parts = [
    typeof e.message === "string" ? e.message : "",
    typeof e.assistant?.errorMessage === "string" ? e.assistant.errorMessage : "",
  ];
  return parts.join(" ");
}

const RATE_LIMITED = /\b(429|529)\b|rate.?limit|too many requests|overloaded|quota exceeded/i;

// Whether the provider pushed back on volume, as opposed to failing the call.
export function isRateLimited(err: unknown): boolean {
  return RATE_LIMITED.test(errorText(err));
}

// The interval a rate limit named, when it named one. Providers put it in a
// Retry-After header, and pi folds the response text into the error message, so
// the number arrives spelled several ways; all of them are seconds.
const RETRY_AFTER_PATTERNS = [
  /retry[-_ ]?after"?\s*[:=]?\s*"?(\d+(?:\.\d+)?)/i,
  /(?:retry|try again)\s*(?:in|after)\s*(\d+(?:\.\d+)?)\s*(?:s\b|sec|seconds?)/i,
];

export function namedRetryAfterMs(err: unknown): number | null {
  const text = errorText(err);
  for (const re of RETRY_AFTER_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const seconds = Number(m[1]);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    }
  }
  return null;
}

export interface LimiterTimers {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface LimiterConfig {
  // Most calls in flight at once when nothing is pushing back.
  limit: number;
  // Least time between two starts. Providers meter short bursts more finely than
  // the per-minute figure suggests, and a cold start of six identical long calls
  // is exactly the burst that earns a 429 before any of them has answered.
  rampMs: number;
  // Waits for successive rate limits that named no interval.
  ladder: readonly number[];
  // Longest pause to honour from a provider-named interval, so a wild value
  // cannot park the whole run for an afternoon.
  maxPauseMs: number;
  // How long the group must go without a rate limit before the ceiling lifts by
  // one again.
  recoverMs: number;
}

export const DEFAULT_LIMIT = 6;
export const DEFAULT_RAMP_MS = 3_000;
export const DEFAULT_MAX_PAUSE_MS = 900_000;
export const DEFAULT_RECOVER_MS = 60_000;

export function resolveLimiterConfig(partial: Partial<LimiterConfig> = {}): LimiterConfig {
  return {
    limit: Math.max(1, Math.round(partial.limit ?? DEFAULT_LIMIT)),
    rampMs: Math.max(0, partial.rampMs ?? DEFAULT_RAMP_MS),
    ladder: partial.ladder ?? COOLDOWN_LADDER_MS,
    maxPauseMs: partial.maxPauseMs ?? DEFAULT_MAX_PAUSE_MS,
    recoverMs: partial.recoverMs ?? DEFAULT_RECOVER_MS,
  };
}

// A ceiling on concurrent long calls, a stagger between starts, and one shared
// pause the whole group observes. One instance per run that fans out.
export class CallLimiter {
  private readonly config: LimiterConfig;
  private busy = 0;
  private ceilingValue: number;
  private pausedUntilValue = 0;
  private nextStartAt = 0;
  private round = 0;
  private lastLimitAt = -Infinity;
  private waiters = new Set<() => void>();

  constructor(config: Partial<LimiterConfig>, private readonly timers: LimiterTimers) {
    this.config = resolveLimiterConfig(config);
    this.ceilingValue = this.config.limit;
  }

  get ceiling(): number {
    return this.ceilingValue;
  }

  get inFlight(): number {
    return this.busy;
  }

  get pausedUntil(): number {
    return this.pausedUntilValue;
  }

  // Run one call under the ceiling: wait for a slot, for the stagger, and for any
  // pause in force, then run it. `signal` (a user Stop) makes a waiting call give
  // up with StoppedError instead of sitting out a 15-minute cooldown.
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      const out = await fn();
      this.noteSuccess();
      return out;
    } finally {
      this.release();
    }
  }

  // A call failed. When the failure was the provider pushing back on volume, the
  // whole group pauses and the ceiling halves; anything else is left to the
  // caller. Returns the pause imposed, 0 when none was.
  noteFailure(err: unknown): number {
    if (!isRateLimited(err)) return 0;
    const now = this.timers.now();
    const named = namedRetryAfterMs(err);
    const wait = Math.min(
      named ?? cooldownAfter(this.round, this.config.ladder) ?? this.config.ladder[this.config.ladder.length - 1] ?? 0,
      this.config.maxPauseMs,
    );
    this.round++;
    this.lastLimitAt = now;
    this.ceilingValue = Math.max(1, Math.floor(this.ceilingValue / 2));
    this.pausedUntilValue = Math.max(this.pausedUntilValue, now + wait);
    return wait;
  }

  // A call came back. Once the group has gone recoverMs without a rate limit, let
  // the ceiling climb one step; a full recovery also forgets the ladder round.
  noteSuccess(): void {
    if (this.ceilingValue >= this.config.limit) return;
    const now = this.timers.now();
    if (now - this.lastLimitAt < this.config.recoverMs) return;
    this.ceilingValue++;
    if (this.ceilingValue >= this.config.limit) this.round = 0;
    this.wake();
  }

  // Sit out whatever pause is in force. Called before a retry, so a retry after a
  // 429 waits for the group's pause rather than the watchdog's flat delay.
  async hold(signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.timers.now();
      const left = this.pausedUntilValue - now;
      if (left <= 0) return;
      await this.delay(left, signal);
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new StoppedError();
      if (this.busy >= this.ceilingValue) {
        await this.waitForSlot(signal);
        continue;
      }
      const now = this.timers.now();
      const gate = Math.max(this.pausedUntilValue, this.nextStartAt);
      if (gate > now) {
        await this.delay(gate - now, signal);
        continue;
      }
      this.busy++;
      this.nextStartAt = this.timers.now() + this.config.rampMs;
      return;
    }
  }

  private release(): void {
    this.busy = Math.max(0, this.busy - 1);
    this.wake();
  }

  private wake(): void {
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const w of waiting) w();
  }

  private waitForSlot(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        cleanup();
        resolve();
      };
      const onAbort = (): void => {
        this.waiters.delete(wake);
        cleanup();
        reject(new StoppedError());
      };
      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
      };
      this.waiters.add(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await this.timers.sleep(ms);
      return;
    }
    if (signal.aborted) throw new StoppedError();
    let onAbort: (() => void) | null = null;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new StoppedError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.timers.sleep(ms), stopped]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
}
