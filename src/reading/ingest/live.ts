// Live deps for the URL ingest: the app's own fetch, the readable extractor out
// of its lazy chunk, the library and the topic store.
//
// Separate from article.ts so that file stays testable: everything here reaches
// the host, and none of it can run in bun.

import { importBook } from "../../platform/app/library";
import { addFileToTopic, setFileHash } from "../../platform/app/topics";
import { loadExtractReadable } from "../../info/extract/readable-lazy";
import { fetchWithRetry } from "../papers/http";
import { ingestArticleUrl, type ArticleIngestDeps, type IngestedDocument } from "./article";

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
    attach: async (topicId, path, hash) => {
      await addFileToTopic(topicId, path);
      await setFileHash(topicId, path, hash);
    },
  };
}

/** Ingest a URL into a topic with the real host behind it. */
export async function ingestUrlLive(
  url: string,
  topicId: string | null,
): Promise<IngestedDocument> {
  return ingestArticleUrl(url, topicId, await liveIngestDeps());
}
