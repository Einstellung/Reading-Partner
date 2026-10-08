// Live deps for the URL ingest and for keeping a briefing article: the app's own
// fetch, the readable extractor out of its lazy chunk, the library, the topic
// store and the kept-article records.
//
// Separate from article.ts so that file stays testable: everything here reaches
// the host, and none of it can run in bun.

import { getLibraryEntry, importBook } from "../../platform/app/library";
import { addSupplement } from "../../platform/app/supplements";
import { addFileToTopic } from "../../platform/app/topics";
import {
  loadSavedArticles,
  saveArticle,
  type SavedArticle,
  type SavedArticleInput,
} from "../saved/saved-articles";
import { keepArticle, type KeepDeps } from "./keep";
import { loadExtractReadable } from "../../workshop/extract/readable-lazy";
import { fetchWithRetry } from "../../platform/http/throttled-fetch";
import { isTauri } from "../../platform/app/host";
import { hasWebviewFetch } from "../../platform/app/platform";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import { siteAdapterFor } from "../../workshop/bindery";
import { fetchPageViaWebview } from "../../workshop/extract/webview-page";
import { tcoTarget } from "../../info/x/outbound";
import { PERMALINK_SCRIPT } from "../../info/x/permalink";
import { xPostOfUrl } from "../../info/x/post";
import type { XReadDeps } from "../../info/x/read-post";
import { saveXPost } from "../../info/x/store";
import { ingestXPost, type IngestBatch } from "./x-post";
import {
  ingestArticleUrl,
  type ArticleIngestDeps,
  type IngestedDocument,
  type IngestTarget,
} from "./article";

// The same fetch the prep pipeline's link ingestion uses: the Tauri http plugin
// with the per-host spacing and the retry on 429/5xx.
async function fetchBytes(url: string): ReturnType<ArticleIngestDeps["fetch"]> {
  const res = await fetchWithRetry(url);
  // The body is read whether or not the status was ok, because it is needed only
  // when it was; a failed response's body is small and is thrown away with it.
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return {
    ok: res.ok,
    status: res.status,
    bytes,
    contentType: res.headers.get("content-type"),
  };
}

export async function liveIngestDeps(): Promise<ArticleIngestDeps> {
  return {
    fetch: fetchBytes,
    // Resolved before the ingest starts, so the 355 kB extractor chunk arrives
    // once and the ingest itself never awaits a chunk mid-way.
    extractReadable: await loadExtractReadable(),
    importBook,
    attachToTopic: (topicId, path, hash) => addFileToTopic(topicId, path, hash),
    // The clock is here rather than in the ingest: when it was taken in is a
    // fact about this device's run, and article.ts stays a function of its
    // inputs.
    attachToBook: async (bookId, ref) => {
      await addSupplement(bookId, { ...ref, addedAt: Date.now() });
    },
  };
}

/** The keep's deps with the real host behind them (keep.ts). */
export function liveKeepDeps(): KeepDeps {
  return {
    fetch: fetchBytes,
    importBook,
    attachToTopic: (topicId, path, hash) => addFileToTopic(topicId, path, hash),
    save: (input) => saveArticle(input),
    existing: async (id) => (await loadSavedArticles()).find((a) => a.id === id) ?? null,
    libraryEntry: getLibraryEntry,
  };
}

/** Keep a briefing article with the real host behind it. Answers the record written. */
export async function keepArticleLive(input: SavedArticleInput): Promise<SavedArticle | null> {
  return (await keepArticle(input, liveKeepDeps())).record;
}

// A permalink page signed out takes 11-13 s to show the post (docs/84 「实测」);
// the fetcher's own settle wait comes on top.
const X_PAGE_TIMEOUT_MS = 60_000;

// One redirect of a t.co link, read off the 301 without fetching the target.
async function resolveRedirect(url: string): Promise<string | null> {
  const res = isTauri()
    ? await cleanTauriFetch(url, { method: "GET", maxRedirections: 0 })
    : await fetch(url, { method: "GET", redirect: "manual" });
  const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
  return tcoTarget(res.status, res.headers.get("location"), body);
}

/** Reading an X post with the real host: the embed, and the hidden webview where there is one. */
export function liveXReadDeps(): XReadDeps {
  return {
    fetch: fetchBytes,
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
    claimedBySite: (link) => siteAdapterFor({ kind: "url", url: link }) !== null,
  };
}

/**
 * Ingest a URL with the real host behind it: one document, or for an X post
 * (docs/84) what it led to.
 */
export async function ingestUrlLive(
  url: string,
  target: IngestTarget,
): Promise<IngestedDocument | IngestBatch> {
  const deps = await liveIngestDeps();
  if (xPostOfUrl(url)) {
    return ingestXPost(url, target, { ...deps, x: liveXReadDeps(), saveRecord: (e) => saveXPost(e) });
  }
  return ingestArticleUrl(url, target, deps);
}
