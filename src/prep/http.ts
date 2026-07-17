// HTTP for the prep pipeline. Inside Tauri, requests go through the http
// plugin (same posture as the AI fetch bridge): the webview's CORS never sees
// them, and the allowed hosts live in src-tauri/capabilities/default.json
// (export.arxiv.org / arxiv.org / api.semanticscholar.org). Outside Tauri
// (plain vite dev) the native fetch is used and CORS failures surface as
// fetch errors — the pipeline degrades those papers, it doesn't crash.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Polite identification for arXiv/Semantic Scholar (their usage policies ask
// for a contactable UA). Only settable on the plugin path; the browser path
// keeps its own UA.
const POLITE_HEADERS = {
  "User-Agent": "Reading-Partner/0.2 (https://github.com/xinyuan/Reading-Partner)",
};

export const prepFetch: FetchFn = (url, init) => {
  if (isTauri()) {
    const headers = new Headers(init?.headers);
    for (const [k, v] of Object.entries(POLITE_HEADERS)) {
      if (!headers.has(k)) headers.set(k, v);
    }
    return tauriFetch(url, { ...init, headers });
  }
  return fetch(url, init);
};

// Exponential backoff with deterministic jitter, exported for tests.
export function backoffMs(attempt: number, baseMs = 1000): number {
  return baseMs * 2 ** attempt + (attempt * 137) % 400;
}

export interface RetryOptions {
  retries?: number; // extra attempts after the first (default 3)
  baseMs?: number;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Fetch with retry on 429/5xx/network errors, honouring Retry-After when the
// server sends one. Other non-OK statuses (404, 400) return immediately — the
// caller decides what a miss means.
export async function fetchWithRetry(url: string, init?: RequestInit, opts?: RetryOptions): Promise<Response> {
  const retries = opts?.retries ?? 3;
  const doFetch = opts?.fetchFn ?? prepFetch;
  const sleep = opts?.sleep ?? defaultSleep;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1, opts?.baseMs));
    try {
      const res = await doFetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
        const after = Number(res.headers.get("retry-after"));
        if (Number.isFinite(after) && after > 0 && attempt < retries) {
          await sleep(after * 1000);
        }
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
