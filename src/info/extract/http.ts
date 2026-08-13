// HTTP for the info briefing. Same posture as papers/http: inside Tauri requests
// go through the http plugin (the webview's CSP/CORS never sees them; the
// https://* scope in capabilities/default.json allows the hosts), outside Tauri
// the native fetch is used so bun/dev at least runs. Both feeds gate on a
// browser User-Agent (see user-agent.ts), so it is forced on the plugin path.

import { isAbortError, throwIfAborted } from "../../platform/app/abort";
import { isTauri, type FetchFn } from "../../platform/app/host";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import { INFO_USER_AGENT } from "./user-agent";

export type { FetchFn };

export const infoFetch: FetchFn = (url, init) => {
  if (isTauri()) {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", INFO_USER_AGENT);
    // Origin is dropped so the feeds don't treat the request as browser CORS
    // (pitfall 15); the plugin's unsafe-headers feature honours an empty Origin.
    if (!headers.has("Origin")) headers.set("Origin", "");
    return cleanTauriFetch(url, { ...init, headers });
  }
  return fetch(url, init);
};

export interface FetchTextOptions {
  // Attempts after the first. Default 2.
  retries?: number;
  // Cancels the request in flight and ends the retry loop. A stopped run must
  // not spend a retry on a request the user already gave up on.
  signal?: AbortSignal;
  // Injected by tests. The live path sleeps on a timer and reads the wall clock.
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// The longest a retry will wait. A source that answers 429 with "come back in
// an hour" is asking for more than a briefing run has: past the cap the attempt
// is given up and the item degrades, which is what any other non-OK status does
// here anyway.
export const MAX_RETRY_WAIT_MS = 30_000;

// Doubling from half a second, so the default two retries wait 0.5s then 1s.
export function retryBackoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

// `Retry-After` in either form the RFC allows: a delay in seconds, or an HTTP
// date. Null when the header is absent or is neither, so the caller falls back
// to its own backoff rather than treating a header it cannot read as "retry
// now". A date already in the past is no wait at all.
export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // Every form of HTTP date carries letters (a month name, a weekday, "GMT"),
  // so a value with none is a broken delay and not a date. Without this,
  // Date.parse reads "-5" as a year and the header becomes "retry now".
  if (!/[a-z]/i.test(value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The wait, cut short when the run is stopped: a briefing the user gave up on
// must not go on sitting out a rate limiter's cooldown. The loop's abort check
// turns the short-circuit into an AbortError on the next turn.
function waitFor(
  ms: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
    void sleep(ms).then(resolve);
  });
}

// Fetch text with a small retry on network/429/5xx, waiting the `Retry-After` a
// rate limiter names (capped) or backing off on its own when it names none.
// Non-OK (404/403) throws so the caller can degrade that one item without
// failing the whole run. `init` carries per-source request headers (a private
// API key, a UA override) from the engine.
export async function fetchText(
  url: string,
  fetchFn: FetchFn = infoFetch,
  init?: RequestInit,
  opts: FetchTextOptions = {},
): Promise<string> {
  const retries = opts.retries ?? 2;
  const signal = opts.signal;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const request: RequestInit | undefined = signal ? { ...init, signal } : init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(signal);
    try {
      const res = await fetchFn(url, request);
      if (res.ok) return await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        const asked = retryAfterMs(res.headers.get("Retry-After"), now());
        await waitFor(Math.min(asked ?? retryBackoffMs(attempt), MAX_RETRY_WAIT_MS), sleep, signal);
        continue;
      }
      throw new Error(`HTTP ${res.status} from ${url}`);
    } catch (e) {
      lastErr = e;
      if (isAbortError(e) || signal?.aborted) break;
      if (attempt >= retries) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
