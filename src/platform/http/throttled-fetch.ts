// HTTP for the literature clients and the prep pipeline, and the one retry loop
// every outbound request in the app goes through — info's briefing fetch
// (workshop/extract/http.ts) wraps it with its own budget. Inside Tauri, requests
// go through the http plugin (same posture as the AI fetch bridge): the
// webview's CORS never sees them, and the allowed hosts live in
// src-tauri/capabilities/default.json
// (export.arxiv.org / arxiv.org / api.openalex.org / api.semanticscholar.org).
// Outside Tauri
// (plain vite dev) the native fetch is used and CORS failures surface as
// fetch errors — the pipeline degrades those papers, it doesn't crash.

import { isAbortError, throwIfAborted } from "../app/abort";
import { isTauri, type FetchFn } from "../app/host";
import { cleanTauriFetch } from "../app/tauri-fetch";
import { gatedFetch, hostGate, isRateLimitError, RateLimitError, sleep, type HostGate } from "./host-gate";
import { MAX_RETRY_WAIT_MS, retryAfterMs } from "./retry-after";

export type { FetchFn };
export {
  HostCoolingDownError,
  isHostCoolingDown,
  isRateLimitError,
  RateLimitError,
  sleep,
  type Clock,
} from "./host-gate";

// Polite identification for the literature APIs (arXiv, Semantic Scholar,
// OpenAlex and NCBI ask for a descriptive, contactable UA). Only settable on the
// plugin path; a webview's fetch keeps the browser's own UA.
export const POLITE_USER_AGENT =
  "Reading-Partner (https://github.com/Einstellung/Reading-Partner; mailto:einstellungsu@gmail.com)";

/** Hosts that get POLITE_USER_AGENT from either transport. */
export const POLITE_UA_HOSTS = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "api.semanticscholar.org",
  "api.openalex.org",
  "eutils.ncbi.nlm.nih.gov",
]);

// A modest default for hosts not in the gate's table — user-pasted links (link
// ingestion, docs/09) can point at any host, so space them out politely.
export const DEFAULT_HOST_INTERVAL_MS = 1000;

// The reading domain's outbound fetch, the counterpart of info's infoFetch: any
// host the reading side talks to (literature APIs, a PDF mirror, a pasted
// article) goes through here, so nothing reading fetches is subject to the
// webview's CORS and CSP. Every attempt passes the process-wide host gate.
export const readingFetch: FetchFn = gatedFetch((url, init) => {
  if (isTauri()) {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", POLITE_USER_AGENT);
    return cleanTauriFetch(url, { ...init, headers });
  }
  return fetch(url, init);
}, DEFAULT_HOST_INTERVAL_MS);

// Thrown by a client when the server answered with a status it cannot use. The
// status is carried rather than folded into a sentence because callers have to
// tell a refusal apart from a miss: OpenAlex answers 409 when the keyless free
// credits are spent, and reporting that as "found nothing" would read to the
// user as "nobody researches this" (docs/24).
export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly host: string,
  ) {
    super(`HTTP ${status} from ${host}`);
    this.name = "HttpStatusError";
  }
}

export function isHttpStatusError(e: unknown): e is HttpStatusError {
  return e instanceof HttpStatusError;
}

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
  // Asked after a 429: a host now cooling down ends the loop at once instead
  // of waiting out a backoff only to be refused.
  gate?: HostGate;
  // Injected by tests. Read only to measure an HTTP-date Retry-After against.
  now?: () => number;
  // Cancels the request in flight and ends the retry loop. A stopped run must
  // not spend a retry, nor go on sitting out a rate limiter's cooldown, for a
  // request the caller already gave up on.
  signal?: AbortSignal;
  // The wait when the server names no Retry-After. Jittered exponential by
  // default; info's briefing fetch doubles from half a second flat, which is a
  // budget for a user waiting on a page and not for a background pipeline.
  backoff?: (attempt: number, baseMs: number) => number;
}

// The wait, cut short when the run is stopped. The loop's abort check turns the
// short-circuit into an AbortError before the next request goes out.
function waitFor(
  ms: number,
  doSleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return doSleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
    void doSleep(ms).then(resolve);
  });
}

// Retry budget for a lookup someone is waiting on — a chat tool mid-conversation,
// as opposed to the prep pipeline's background fetches. The default budget is
// three retries with a 5s base on 429, which is right for a pipeline that can
// wait out a rate limiter and wrong here: measured 2026-07-30, one four-library
// search where two libraries were rate-limited took 122 seconds, nearly all of it
// backoff. One retry and a short base fails fast enough to still be an answer.
export const INTERACTIVE_RETRY: RetryOptions = { retries: 1, baseMs: 500, base429Ms: 1500 };

// The interactive budget with a test's fake fetch folded in, for the chat-side
// lookups (topic search, citation graph).
export function interactiveRetry(fetchFn?: FetchFn): RetryOptions {
  return fetchFn ? { ...INTERACTIVE_RETRY, fetchFn } : INTERACTIVE_RETRY;
}

// Fetch with retry on 429/5xx/network errors, honouring Retry-After (either RFC
// form, capped at MAX_RETRY_WAIT_MS) when the server sends one. Other non-OK
// statuses (404, 400) return immediately — the caller decides what a miss
// means. A terminal 429 throws RateLimitError so the pipeline can cool the paper
// down instead of failing it.
export async function fetchWithRetry(url: string, init?: RequestInit, opts?: RetryOptions): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const doFetch = opts?.fetchFn ?? readingFetch;
  const doSleep = opts?.sleep ?? sleep;
  // Spacing and cooldown live in the transports (host-gate.ts), so a fake
  // fetchFn never waits on them and every live one does.
  const gate = opts?.gate ?? hostGate;
  const baseMs = opts?.baseMs ?? 1000;
  const base429 = opts?.base429Ms ?? 5000;
  const backoff = opts?.backoff ?? backoffMs;
  const now = opts?.now ?? Date.now;
  const signal = opts?.signal;
  const host = new URL(url).hostname;

  let lastError: unknown = null;
  let lastWas429 = false;
  // The wait before the next attempt, set by the attempt that just failed. This
  // is where Retry-After lands, so it replaces that attempt's backoff rather
  // than adding a second sleep on top of it.
  let waitBeforeNext = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && waitBeforeNext > 0) await waitFor(waitBeforeNext, doSleep, signal);
    throwIfAborted(signal);
    try {
      const res = await doFetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        lastWas429 = res.status === 429;
        lastError = new Error(`HTTP ${res.status} from ${host}`);
        const cooling = lastWas429 ? gate.coolingDown(host) : null;
        if (cooling) throw cooling.asRefusal();
        const asked = retryAfterMs(res.headers.get("retry-after"), now());
        const base = lastWas429 ? base429 : baseMs;
        // Capped: a host answering 429 with "retry-after: 999999" is asking for
        // longer than any lookup here can wait. A wait of zero — the header said
        // 0, or named a date already past — is nothing to honour, so the backoff
        // stands.
        waitBeforeNext =
          asked !== null && asked > 0
            ? Math.min(asked, MAX_RETRY_WAIT_MS)
            : backoff(attempt, base);
        continue;
      }
      return res;
    } catch (e) {
      // A cooldown is the answer for now; retrying would only be refused again.
      if (isAbortError(e) || signal?.aborted || isRateLimitError(e)) throw e;
      lastError = e;
      lastWas429 = false;
      waitBeforeNext = backoff(attempt, baseMs);
    }
  }
  if (lastWas429) throw new RateLimitError(host);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
