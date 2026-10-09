// Reading X with the real host: the embed through the app's fetch, the
// permalink page in the signed-out hidden webview where the device has one, and
// t.co read off its redirect. Registered as the link agent's X reader at boot.
//
// Apart from read-post.ts so that file stays testable: everything here reaches
// the host, and none of it can run in bun.

import { isTauri } from "../../platform/app/host";
import { hasWebviewFetch } from "../../platform/app/platform";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import { fetchWithRetry } from "../../platform/http/throttled-fetch";
import type { FetchBytes } from "../../workshop/bindery";
import { fetchPageViaWebview } from "../../workshop/extract/webview-page";
import { registerLinkReader } from "../links/readers";
import { tcoTarget } from "./outbound";
import { PERMALINK_SCRIPT } from "./permalink";
import type { XReadDeps } from "./read-post";
import { xLinkReader } from "./reader";

// A permalink page signed out takes 11-13 s to show the post (docs/84 「实测」);
// the fetcher's own settle wait comes on top.
const X_PAGE_TIMEOUT_MS = 60_000;

// The same fetch reading's link ingestion uses: the Tauri http plugin with the
// per-host spacing and the retry on 429/5xx.
const embedFetch: FetchBytes = async (url) => {
  const res = await fetchWithRetry(url);
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return {
    ok: res.ok,
    status: res.status,
    bytes,
    contentType: res.headers.get("content-type"),
    contentDisposition: res.headers.get("content-disposition"),
  };
};

// One redirect of a t.co link, read off the 301 without fetching the target.
async function resolveRedirect(url: string): Promise<string | null> {
  const res = isTauri()
    ? await cleanTauriFetch(url, { method: "GET", maxRedirections: 0 })
    : await fetch(url, { method: "GET", redirect: "manual" });
  const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
  return tcoTarget(res.status, res.headers.get("location"), body);
}

/** Reading an X post with the real host: the embed, and the hidden webview where there is one. */
function liveXReadDeps(): XReadDeps {
  return {
    fetch: embedFetch,
    readPage: hasWebviewFetch()
      ? async (url) => {
          const page = await fetchPageViaWebview(url, {
            script: PERMALINK_SCRIPT,
            timeoutMs: X_PAGE_TIMEOUT_MS,
          });
          const why = [page.status === "ok" ? null : page.status, page.detail].filter(Boolean);
          return { value: page.result, detail: why.length > 0 ? why.join(": ") : null };
        }
      : null,
    resolveRedirect,
  };
}

/** Hand the link agent the X reader (docs/86). Called once from the shells' bootDomains. */
export function registerXLinkReader(): void {
  registerLinkReader(xLinkReader(liveXReadDeps()));
}
