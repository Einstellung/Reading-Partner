// The result builder with the real host (docs/info/88): the everyday-tier model,
// the app's fetch, 86's `open` route for links, the counted GitHub lookup,
// AppData, the reader's profile statements. Apart from build-result.ts so that
// file stays testable: everything here reaches the host.
//
// The run pipeline (run.ts) injects `buildTopicSearchResult`, and searches
// arXiv in its read phase with `searchArxivLive`.
//
// Every request here goes through `infoFetch`, whose host gate spaces arXiv to
// one request per three seconds for the whole process and holds off after a
// rate limit (platform/http/host-gate.ts, pitfall 502). arXiv page reads are
// memoized for the run's deeper reads (fetch-memo.ts).

import { callModel, resolveModel } from "../../ai/model-call";
import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { languageInstruction } from "../../platform/app/settings";
import { bookLanguageInstruction } from "./book-language";
import { fetchWithRetry, interactiveRetry } from "../../platform/http/throttled-fetch";
import type { FetchBytes } from "../../workshop/bindery";
import { isPdfBytes } from "../../workshop/bindery/pdf";
import { infoFetch } from "../../workshop/extract/http";
import { loadExtractReadable } from "../../workshop/extract/readable-lazy";
import { listStatements } from "../../memory/live/statements";
import { arxivPlugin } from "../sources/plugins/arxiv";
import { RepoLookups } from "../sources/plugins/github-lookup";
import type { ArxivSearch } from "./arxiv-ladder";
import { memoArxivFetchText } from "./fetch-memo";
import { makeResultBuilder, type BuildResultDeps, type BuildTopicSearchResult } from "./build-result";
import { openOriginal } from "./open-link";
import { localDay } from "./windows";

const ARXIV_LIMIT = 20;

const fetchBytes: FetchBytes = async (url) => {
  const res = await fetchWithRetry(url, undefined, interactiveRetry(infoFetch));
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return { ok: res.ok, status: res.status, bytes, contentType: res.headers.get("content-type"), url: res.url || url };
};

async function writeUnder(path: string, content: string): Promise<void> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (dir) await appData.mkdirp(dir);
  await writeTextAtomic(path, content);
}

/** The arXiv plugin's search slot, through the host gate; `since` and `until` are local days, inclusive. */
export const searchArxivLive: ArxivSearch = (text, window, signal) =>
  arxivPlugin.search!(text, { since: window.since, until: window.until, limit: ARXIV_LIMIT }, {
    fetchFn: infoFetch,
    signal,
    now: () => Date.now(),
    today: () => localDay(Date.now()),
  });

export const liveResultDeps: BuildResultDeps = {
  model: ({ system, user, signal }) =>
    callModel("prep", "plan", system, user, { signal, onProgress: () => {} }, { spend: { caller: "info" } }),
  fetchText: memoArxivFetchText(async (url, signal) => {
    const res = await fetchWithRetry(url, { signal }, interactiveRetry(infoFetch));
    return { status: res.status, text: await res.text() };
  }),
  readPdfText: async (url) => {
    const got = await fetchBytes(url);
    if (!got.ok) throw new Error(`${new URL(url).hostname} answered HTTP ${got.status}`);
    if (!isPdfBytes(got.bytes)) return null;
    const { extractFulltext } = await import("../../fulltext/extract");
    const { pages, status } = await extractFulltext(got.bytes.slice().buffer);
    return status === "ok" ? pages.join("\n\n") : null;
  },
  openLink: async (url) => openOriginal(url, { fetch: fetchBytes, extractReadable: await loadExtractReadable() }),
  repoLookups: () => {
    const lookups = new RepoLookups();
    return { lookup: (name) => lookups.lookup(name, { fetchFn: infoFetch }), quotaLeft: () => lookups.quotaRemaining };
  },
  files: {
    read: async (path) => ((await appData.exists(path)) ? await appData.readText(path) : null),
    write: writeUnder,
    list: async (prefix) =>
      (await appData.readDir("")).filter((e) => e.isFile && e.name.startsWith(prefix)).map((e) => e.name),
  },
  profile: async () =>
    (await listStatements()).filter((s) => s.kind === "profile" && !s.supersededBy).map((s) => s.text),
  language: async () => languageInstruction((await resolveModel("prep")).aiLanguage),
  bookLanguage: async () => bookLanguageInstruction((await resolveModel("prep")).aiLanguage),
  now: () => Date.now(),
  today: () => localDay(Date.now()),
};

/** The run pipeline's `BuildTopicSearchResult`, on the real host. */
export const buildTopicSearchResult: BuildTopicSearchResult = makeResultBuilder(liveResultDeps);
