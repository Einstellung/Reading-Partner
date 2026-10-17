// The result builder with the real host (docs/info/88): the everyday-tier model,
// the app's fetch, 86's `open` route for links, the counted GitHub lookup,
// AppData, the reader's profile statements. Apart from build-result.ts so that
// file stays testable: everything here reaches the host.
//
// The run pipeline (run.ts) injects `buildTopicSearchResult`, and searches
// arXiv in its read phase with `searchArxivLive`.
//
// Every request here goes through `spacedFetch`: fetchWithRetry takes an
// injected fetchFn for a fake and skips its per-host spacing (pitfall 497), so
// passing `infoFetch` alone would send arXiv's ladder steps back to back.

import { callModel, resolveModel } from "../../ai/model-call";
import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { languageInstruction } from "../../platform/app/settings";
import { bookLanguageInstruction } from "./book-language";
import { createThrottle, fetchWithRetry, HOST_MIN_INTERVAL_MS, interactiveRetry, type FetchFn } from "../../platform/http/throttled-fetch";
import type { FetchBytes } from "../../workshop/bindery";
import { manuscriptText } from "../../workshop/bindery/manuscript";
import { isPdfBytes } from "../../workshop/bindery/pdf";
import { infoFetch } from "../../workshop/extract/http";
import { listStatements } from "../../memory/live/statements";
import { LinkSession } from "../links/session";
import { arxivPlugin } from "../sources/plugins/arxiv";
import { RepoLookups } from "../sources/plugins/github-lookup";
import type { ArxivSearch } from "./arxiv-ladder";
import { makeResultBuilder, type BuildResultDeps, type BuildTopicSearchResult } from "./build-result";
import type { OpenedLink } from "./verify";
import { localDay } from "./windows";

const ARXIV_LIMIT = 20;

/** The per-host spacing of the topic search's requests (arXiv: one per three seconds), every attempt included. */
const hostGate = createThrottle(HOST_MIN_INTERVAL_MS);

const spacedFetch: FetchFn = async (url, init) => {
  await hostGate(new URL(url).hostname);
  return infoFetch(url, init);
};

const fetchBytes: FetchBytes = async (url) => {
  const res = await fetchWithRetry(url, undefined, interactiveRetry(spacedFetch));
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return { ok: res.ok, status: res.status, bytes, contentType: res.headers.get("content-type"), url: res.url || url };
};

/** 86's open route for one link: readers, site adapters, the generic page and PDF read. Nothing is filed. */
async function openLink(url: string): Promise<OpenedLink> {
  const session = new LinkSession<never>(url, {
    fetch: fetchBytes,
    file: async () => {
      throw new Error("a topic search reads originals and files nothing");
    },
  });
  await session.open(1);
  const opened = session.get(1)?.opened;
  const content = opened?.content ?? null;
  if (!opened || content === null) return { ok: false, reason: opened?.why ?? "nothing readable at the link" };
  if (!content.ok) return { ok: false, reason: content.reason };
  if ("passedThrough" in content) {
    const meta = content.metadata;
    return {
      ok: true,
      via: opened.via,
      title: meta.title || null,
      author: meta.author ?? null,
      publishedAt: meta.publishedAt ?? null,
      sections: [],
      whole: { format: content.format, abstract: meta.abstract ?? null },
    };
  }
  const m = content.manuscript;
  if (!manuscriptText(m).trim()) return { ok: false, reason: "the page had no text" };
  return {
    ok: true,
    via: opened.via,
    title: m.title || null,
    author: m.author ?? null,
    publishedAt: m.publishedAt ?? null,
    sections: m.sections.map((s) => ({ heading: s.heading ?? null, html: s.html })),
    whole: null,
  };
}

async function writeUnder(path: string, content: string): Promise<void> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (dir) await appData.mkdirp(dir);
  await writeTextAtomic(path, content);
}

/** The arXiv plugin's search slot, spaced per host; `since` and `until` are local days, inclusive. */
export const searchArxivLive: ArxivSearch = (text, window, signal) =>
  arxivPlugin.search!(text, { since: window.since, until: window.until, limit: ARXIV_LIMIT }, {
    fetchFn: spacedFetch,
    signal,
    now: () => Date.now(),
    today: () => localDay(Date.now()),
  });

export const liveResultDeps: BuildResultDeps = {
  model: ({ system, user, signal }) =>
    callModel("prep", "plan", system, user, { signal, onProgress: () => {} }, { spend: { caller: "info" } }),
  fetchText: async (url, signal) => {
    const res = await fetchWithRetry(url, { signal }, interactiveRetry(spacedFetch));
    return { status: res.status, text: await res.text() };
  },
  readPdfText: async (url) => {
    const got = await fetchBytes(url);
    if (!got.ok || !isPdfBytes(got.bytes)) return null;
    const { extractFulltext } = await import("../../fulltext/extract");
    const { pages, status } = await extractFulltext(got.bytes.slice().buffer);
    return status === "ok" ? pages.join("\n\n") : null;
  },
  openLink: (url) => openLink(url),
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
