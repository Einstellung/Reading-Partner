// The result builder with the real host (docs/info/88): the everyday-tier model,
// the app's fetch, 86's `open` route for links, the counted GitHub lookup,
// AppData, the reader's profile and known statements. Apart from build-result.ts so that
// file stays testable: everything here reaches the host.
//
// The run pipeline (run.ts) injects `buildTopicSearchResult`, and searches
// arXiv and Hugging Face in its read phase with `searchArxivLive` and
// `searchHfLive`.
//
// Every request here goes through `infoFetch`, whose host gate spaces arXiv to
// one request per three seconds for the whole process, Hugging Face's paper
// search to one per six, and holds off after a rate limit (platform/http/host-gate.ts,
// pitfall 502). arXiv page reads are
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
import { standingStatements } from "../../memory/statements/section";
import { arxivPlugin } from "../sources/plugins/arxiv";
import { huggingfacePlugin } from "../sources/plugins/huggingface";
import { parseS2ArxivId, s2DoiUrl } from "../sources/plugins/s2-client";
import { RepoLookups } from "../sources/plugins/github-lookup";
import { resolveRedirect } from "../x/live";
import type { ArxivSearch } from "./arxiv-ladder";
import type { HfSearch } from "./hf-ladder";
import { memoArxivFetchText } from "./fetch-memo";
import { loadTopicLabels } from "./labels";
import { liveSeedSearches } from "./seed-live";
import { loadStudy, putStudyLines } from "./study";
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

/** The Hugging Face plugin's search slot, through the host gate: one request, the window applied to its answer. */
export const searchHfLive: HfSearch = (text, window, signal) =>
  huggingfacePlugin.search!(text, { since: window.since, until: window.until }, {
    fetchFn: infoFetch,
    signal,
    now: () => Date.now(),
    today: () => localDay(Date.now()),
  });

export const liveResultDeps: BuildResultDeps = {
  model: ({ system, user, tail, cache, signal }) =>
    callModel("prep", "plan", system, [user, ...(tail ?? [])], { signal, onProgress: () => {} }, { spend: { caller: "info" } }, cache ? undefined : "none"),
  fetchText: memoArxivFetchText(async (url, signal) => {
    const res = await fetchWithRetry(url, { signal }, interactiveRetry(infoFetch));
    return { status: res.status, text: await res.text() };
  }),
  // pdf.js in the webview; a PDF the open route fetched already is not fetched again.
  readPdfText: async (url, _signal, fetched) => {
    let bytes = fetched;
    if (!bytes) {
      const got = await fetchBytes(url);
      if (!got.ok) throw new Error(`${new URL(url).hostname} answered HTTP ${got.status}`);
      bytes = got.bytes;
    }
    if (!isPdfBytes(bytes)) return null;
    const { extractFulltext } = await import("../../fulltext/extract");
    const { pages, status } = await extractFulltext(bytes.slice().buffer);
    return status === "ok" ? pages.join("\n\n") : null;
  },
  openLink: async (url) => openOriginal(url, { fetch: fetchBytes, extractReadable: await loadExtractReadable() }),
  // One redirect read off the answer, as t.co is: goo.gle, bit.ly and the like.
  resolveShortLink: (url) => resolveRedirect(url),
  // Semantic Scholar's DOI route, in a gate lane of its own: one retry at most,
  // and while the lane cools down after a 429 the gate refuses at once (a miss).
  arxivIdOfDoi: async (doi, signal) => {
    const res = await fetchWithRetry(s2DoiUrl(doi), { signal }, interactiveRetry(infoFetch));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Semantic Scholar answered HTTP ${res.status}`);
    return parseS2ArxivId(await res.json());
  },
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
  // Reader's own words first: they beat what dream concluded (docs/48).
  labels: (searchId) => loadTopicLabels(searchId),
  // A study's update (docs/info/91 更新): the confirmed lines it revises by,
  // and the mark that a version used them.
  study: (searchId) => loadStudy(searchId),
  useLines: async (searchId, lines) => void (await putStudyLines(searchId, lines)),
  // A study's seed no read found, looked up as find_seed_paper looks it up (docs/info/91 起草与种子).
  seedPaper: (arxivId) => liveSeedSearches.byArxivId(arxivId),
  known: async () => standingStatements(await listStatements(), "known").map((s) => s.text.trim()),
  language: async () => languageInstruction((await resolveModel("prep")).aiLanguage),
  bookLanguage: async () => bookLanguageInstruction((await resolveModel("prep")).aiLanguage),
  now: () => Date.now(),
  today: () => localDay(Date.now()),
};

/** The run pipeline's `BuildTopicSearchResult`, on the real host. */
export const buildTopicSearchResult: BuildTopicSearchResult = makeResultBuilder(liveResultDeps);
