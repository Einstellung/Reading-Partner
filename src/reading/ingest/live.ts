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
import { runSubagentTurnLive } from "../../legion/subagent/live";
import { xPostOfUrl } from "../../info/x/post";
import { saveLinkRecord } from "../../info/links/store";
import { takeLinkInFiled, type IngestBatch } from "./link-intake";
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
    contentDisposition: res.headers.get("content-disposition"),
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

/** What the run hands an ingest besides the link: the reader's words, and where to say what is being read. */
export interface IngestRunContext {
  /** What the reader said when pasting the link (the ask's note). */
  note?: string;
  /** The host about to be read, for the run's progress line. */
  report?(host: string): void;
}

/**
 * Ingest a URL with the real host behind it: one document, or for an X post
 * what the link agent took in from it (docs/86).
 */
export async function ingestUrlLive(
  url: string,
  target: IngestTarget,
  context: IngestRunContext = {},
): Promise<IngestedDocument | IngestBatch> {
  if (xPostOfUrl(url)) return takeLinkInLive(url, target, context);
  return ingestArticleUrl(url, target, await liveIngestDeps());
}

/** Take a link in through the link agent (docs/86) with the real host and the daily-tier model. */
export async function takeLinkInLive(url: string, target: IngestTarget, context: IngestRunContext = {}): Promise<IngestBatch> {
  const deps = await liveIngestDeps();
  return takeLinkInFiled(url, target, {
    ...deps,
    turn: runSubagentTurnLive,
    saveRecord: (k, e) => saveLinkRecord(k, e),
    ...(context.note ? { note: context.note } : {}),
    ...(context.report ? { report: context.report } : {}),
  });
}
