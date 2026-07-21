// HTTP for the info briefing. Same posture as prep/http: inside Tauri requests
// go through the http plugin (the webview's CSP/CORS never sees them; the
// https://* scope in capabilities/default.json allows the hosts), outside Tauri
// the native fetch is used so bun/dev at least runs. Both feeds gate on a
// browser User-Agent (see sources.ts), so it is forced on the plugin path.

import { cleanTauriFetch } from "../tauri-fetch";
import { INFO_USER_AGENT } from "./sources";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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

// Fetch text with a small retry on network/5xx. Non-OK (404/403) throws so the
// caller can degrade that one item without failing the whole run.
export async function fetchText(
  url: string,
  fetchFn: FetchFn = infoFetch,
  retries = 2,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return await res.text();
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      throw new Error(`HTTP ${res.status} from ${url}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
