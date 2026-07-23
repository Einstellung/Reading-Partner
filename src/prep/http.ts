// HTTP for the prep pipeline. Inside Tauri, requests go through the http
// plugin (same posture as the AI fetch bridge): the webview's CORS never sees
// them, and the allowed hosts live in src-tauri/capabilities/default.json
// (export.arxiv.org / arxiv.org / api.openalex.org / api.semanticscholar.org).
// Outside Tauri
// (plain vite dev) the native fetch is used and CORS failures surface as
// fetch errors — the pipeline degrades those papers, it doesn't crash.

import { cleanTauriFetch } from "../app/tauri-fetch";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Polite identification for arXiv/Semantic Scholar (their usage policies ask
// for a contactable UA). Only settable on the plugin path; the browser path
// keeps its own UA.
const POLITE_HEADERS = {
  "User-Agent":
    "Reading-Partner/0.2 (https://github.com/Einstellung/Reading-Partner; mailto:einstellungsu@gmail.com)",
};

export const prepFetch: FetchFn = (url, init) => {
  if (isTauri()) {
    const headers = new Headers(init?.headers);
    for (const [k, v] of Object.entries(POLITE_HEADERS)) {
      if (!headers.has(k)) headers.set(k, v);
    }
    return cleanTauriFetch(url, { ...init, headers });
  }
  return fetch(url, init);
};

// Thrown when a request is terminally rate-limited (429 after every retry).
// The pipeline treats this as "cool down and retry later", not a hard failure.
export class RateLimitError extends Error {
  constructor(public readonly host: string) {
    super(`HTTP 429 from ${host}`);
    this.name = "RateLimitError";
  }
}

export function isRateLimitError(e: unknown): e is RateLimitError {
  return e instanceof RateLimitError;
}

// --- per-host request spacing ---

// Minimum gap between requests to the same host (ms). arXiv's usage policy
// asks for one request per three seconds; Semantic Scholar's shared free pool
// is happier with spacing too. Other hosts (open-access PDF mirrors) are
// unthrottled.
export const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  "arxiv.org": 3000,
  "export.arxiv.org": 3000,
  "api.semanticscholar.org": 1500,
  // Polite pool allows 10 req/s; stay well under it.
  "api.openalex.org": 500,
};

// A modest default for hosts not in the table — user-pasted links (link
// ingestion, docs/09) can point at any host, so space them out politely.
export const DEFAULT_HOST_INTERVAL_MS = 1000;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
};

// A gate that spaces out requests per host. Serializes calls for the same host
// (a chain of promises) so back-to-back metadata+PDF fetches keep their gap.
// The clock is injectable so tests never touch real timers.
export type Throttle = (host: string) => Promise<void>;

export function createThrottle(
  intervals: Record<string, number> = HOST_MIN_INTERVAL_MS,
  clock: Clock = realClock,
  // Applied to hosts not named in `intervals` (0 = no spacing).
  defaultInterval = 0,
): Throttle {
  const last = new Map<string, number>();
  const tail = new Map<string, Promise<void>>();
  return (host: string) => {
    const interval = intervals[host] ?? defaultInterval;
    if (!interval) return Promise.resolve();
    const run = (tail.get(host) ?? Promise.resolve()).then(async () => {
      const lastAt = last.get(host);
      if (lastAt !== undefined) {
        const wait = lastAt + interval - clock.now();
        if (wait > 0) await clock.sleep(wait);
      }
      last.set(host, clock.now());
    });
    // A failed request must not poison the chain for the next one.
    tail.set(host, run.catch(() => {}));
    return run;
  };
}

// Process-wide gate used by the real fetch path.
const hostThrottle = createThrottle(HOST_MIN_INTERVAL_MS, realClock, DEFAULT_HOST_INTERVAL_MS);
const noopThrottle: Throttle = () => Promise.resolve();

// Exponential backoff with deterministic jitter, exported for tests.
export function backoffMs(attempt: number, baseMs = 1000): number {
  return baseMs * 2 ** attempt + (attempt * 137) % 400;
}

export interface RetryOptions {
  retries?: number; // extra attempts after the first (default 3)
  baseMs?: number; // 5xx / network backoff base
  base429Ms?: number; // 429 backoff base (higher: the pool needs longer to clear)
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  throttle?: Throttle;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Fetch with retry on 429/5xx/network errors, honouring Retry-After when the
// server sends one. Other non-OK statuses (404, 400) return immediately — the
// caller decides what a miss means. A terminal 429 throws RateLimitError so the
// pipeline can cool the paper down instead of failing it.
export async function fetchWithRetry(url: string, init?: RequestInit, opts?: RetryOptions): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const doFetch = opts?.fetchFn ?? prepFetch;
  const sleep = opts?.sleep ?? defaultSleep;
  // An injected fetchFn means a fake: don't make it wait on the real per-host
  // gate. The live path (no fetchFn) keeps the process-wide spacing.
  const throttle = opts?.throttle ?? (opts?.fetchFn ? noopThrottle : hostThrottle);
  const baseMs = opts?.baseMs ?? 1000;
  const base429 = opts?.base429Ms ?? 5000;
  const host = new URL(url).hostname;

  let lastError: unknown = null;
  let lastWas429 = false;
  // The wait before the next attempt, set by the attempt that just failed. This
  // is where Retry-After lands, so it replaces that attempt's backoff rather
  // than adding a second sleep on top of it.
  let waitBeforeNext = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && waitBeforeNext > 0) await sleep(waitBeforeNext);
    await throttle(host);
    try {
      const res = await doFetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        lastWas429 = res.status === 429;
        lastError = new Error(`HTTP ${res.status} from ${host}`);
        const after = Number(res.headers.get("retry-after"));
        const base = lastWas429 ? base429 : baseMs;
        waitBeforeNext =
          Number.isFinite(after) && after > 0 ? after * 1000 : backoffMs(attempt, base);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      lastWas429 = false;
      waitBeforeNext = backoffMs(attempt, baseMs);
    }
  }
  if (lastWas429) throw new RateLimitError(host);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
