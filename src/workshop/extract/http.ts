// HTTP for the info briefing. Same posture as papers/http: inside Tauri requests
// go through the http plugin (the webview's CSP/CORS never sees them; the
// https://* scope in capabilities/default.json allows the hosts), outside Tauri
// the native fetch is used so bun/dev at least runs. Both feeds gate on a
// browser User-Agent (see user-agent.ts), so it is forced on the plugin path.

import { isTauri, type FetchFn } from "../../platform/app/host";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import { fetchWithRetry, noThrottle } from "../../platform/http/throttled-fetch";
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

// Doubling from half a second, so the default two retries wait 0.5s then 1s.
export function retryBackoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

// Fetch text with a small retry on network/429/5xx, waiting the `Retry-After` a
// rate limiter names (capped) or backing off on its own when it names none. The
// loop itself is platform's (throttled-fetch.ts); what is info's own is the
// budget — a shorter backoff, no per-host spacing (the briefing paces its
// sources itself) — and that a non-OK status throws, so the caller can degrade
// that one item without failing the whole run. `init` carries per-source request
// headers (a private API key, a UA override) from the engine.
export async function fetchText(
  url: string,
  fetchFn: FetchFn = infoFetch,
  init?: RequestInit,
  opts: FetchTextOptions = {},
): Promise<string> {
  const signal = opts.signal;
  const res = await fetchWithRetry(url, signal ? { ...init, signal } : init, {
    retries: opts.retries ?? 2,
    fetchFn,
    sleep: opts.sleep,
    now: opts.now,
    signal,
    throttle: noThrottle,
    backoff: (attempt) => retryBackoffMs(attempt),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return await res.text();
}
