// The generic collection engine (docs/17): collectSource(descriptor) executes a
// declarative source by dispatching on its discovery kind, and collectAll runs a
// list of descriptors with per-source isolation + health tracking. This replaces
// the hand-written jiqizhixin/qbitai adapters — their two shapes (internal JSON
// API, feed + fetched page) are now two branches parameterized by the
// descriptor. Fetching is injected (FetchFn) and readable extraction is injected
// (ExtractReadable), so the whole engine is DOM-free and unit-testable in bun.

import { fetchText, infoFetch, type FetchFn } from "./http";
import { itemId } from "./id";
import { htmlToText } from "./sanitize";
import { parseFeed, feedFieldBody } from "./feed";
import {
  dotPath,
  pickString,
  type ExtractReadable,
  type FieldPath,
  type JsonApiDiscovery,
  type SourceDescriptor,
} from "./descriptor";
import type { InfoItem } from "./types";

export interface CollectDeps {
  fetchFn?: FetchFn;
  // Readable extraction for fetch-page/listpage sources. Optional so a purely
  // feed-field/json-api run needs no DOM; a fetch-page source without it yields
  // headline-only items.
  extract?: ExtractReadable;
  // Item text cap fed to triage/chat. Default 20k.
  textMaxChars?: number;
  now?: () => number;
}

const DEFAULT_LIMIT = 20;
const SUMMARY_CHARS = 400;

function summaryText(html: string): string {
  return htmlToText(html).slice(0, SUMMARY_CHARS);
}

// Substitute {id} into a url template.
function fillTemplate(template: string, id: string): string {
  return template.replace(/\{id\}/g, encodeURIComponent(id));
}

// The article body from a detail JSON, tolerating the API nesting it under
// `article` / `data` (jiqizhixin's undocumented shape does both historically).
function detailContent(detail: unknown, path: FieldPath): string {
  const direct = pickString(detail, path);
  if (direct) return direct;
  for (const container of ["article", "data"]) {
    const nested = dotPath(detail, container);
    if (nested && typeof nested === "object") {
      const v = pickString(nested, path);
      if (v) return v;
    }
  }
  return "";
}

// --- per-kind collectors ---------------------------------------------------

async function collectFeed(
  desc: SourceDescriptor,
  deps: Required<Pick<CollectDeps, "fetchFn" | "textMaxChars">> & { extract?: ExtractReadable },
): Promise<InfoItem[]> {
  if (desc.discovery.kind !== "feed") return [];
  const init = requestInit(desc);
  const xml = await fetchText(desc.discovery.url, deps.fetchFn, init);
  const limit = desc.limit ?? DEFAULT_LIMIT;
  const entries = parseFeed(xml).slice(0, limit);
  const items: InfoItem[] = [];
  for (const e of entries) {
    const key = e.link || e.title;
    const base: InfoItem = {
      id: itemId(desc.id, key),
      source: desc.id,
      sourceName: desc.name,
      title: e.title || key,
      url: e.link,
      publishedAt: e.publishedAt,
      summaryOnly: true,
    };
    const listSummary = summaryText(e.description || e.summary) || e.category;
    if (listSummary) base.summary = listSummary;

    if (desc.fulltext.mode === "feed-field") {
      const marker = desc.fulltext.truncationMarker;
      let body = feedFieldBody(e, desc.fulltext.field);
      const truncated = !!(marker && body.includes(marker));
      // A metered-paywall source (noFetchPage) uses the feed body as-is; others
      // may fall back to fetching the page when the feed body came up empty.
      if (!body && !desc.noFetchPage && deps.extract) {
        const fetched = await fetchAndExtract(e.link, deps);
        if (fetched) {
          base.contentHtml = fetched.contentHtml;
          base.textContent = fetched.textContent.slice(0, deps.textMaxChars);
          if (fetched.title) base.title = fetched.title;
          base.summaryOnly = false;
          items.push(base);
          continue;
        }
      }
      if (body) {
        base.contentHtml = body;
        base.textContent = htmlToText(body).slice(0, deps.textMaxChars);
        base.summaryOnly = truncated; // full body -> not summary-only, unless truncated
      }
    } else if (desc.fulltext.mode === "fetch-page" && !desc.noFetchPage && deps.extract) {
      const fetched = await fetchAndExtract(e.link, deps);
      if (fetched) {
        base.contentHtml = fetched.contentHtml;
        base.textContent = fetched.textContent.slice(0, deps.textMaxChars);
        if (fetched.title) base.title = fetched.title;
        base.summaryOnly = false;
      }
    }
    // fulltext "none": summary-only by construction.
    items.push(base);
  }
  return items;
}

async function fetchAndExtract(
  url: string,
  deps: { fetchFn: FetchFn; extract?: ExtractReadable },
): Promise<{ title: string; contentHtml: string; textContent: string } | null> {
  if (!url || !deps.extract) return null;
  try {
    const html = await fetchText(url, deps.fetchFn);
    return deps.extract(html, url);
  } catch {
    return null;
  }
}

async function collectListpage(
  desc: SourceDescriptor,
  deps: Required<Pick<CollectDeps, "fetchFn" | "textMaxChars">> & { extract?: ExtractReadable },
): Promise<InfoItem[]> {
  if (desc.discovery.kind !== "listpage") return [];
  const { url, linkPattern, base: baseOrigin } = desc.discovery;
  const html = await fetchText(url, deps.fetchFn, requestInit(desc));
  const origin = baseOrigin || new URL(url).origin;
  const limit = desc.limit ?? 10;
  // Find every occurrence of the article-link pattern in the page, dedup, cap.
  const re = new RegExp(linkPattern, "g");
  const seen = new Set<string>();
  const links: string[] = [];
  for (const m of html.matchAll(re)) {
    const path = m[0];
    const abs = /^https?:\/\//i.test(path) ? path : origin + (path.startsWith("/") ? path : `/${path}`);
    if (seen.has(abs)) continue;
    seen.add(abs);
    links.push(abs);
    if (links.length >= limit) break;
  }
  const items: InfoItem[] = [];
  for (const link of links) {
    const base: InfoItem = {
      id: itemId(desc.id, link),
      source: desc.id,
      sourceName: desc.name,
      title: link,
      url: link,
      publishedAt: "",
      summaryOnly: true,
    };
    const fetched = await fetchAndExtract(link, deps);
    if (fetched) {
      base.contentHtml = fetched.contentHtml;
      base.textContent = fetched.textContent.slice(0, deps.textMaxChars);
      if (fetched.title) base.title = fetched.title;
      base.summaryOnly = false;
    }
    items.push(base);
  }
  return items;
}

async function collectJsonApi(
  desc: SourceDescriptor,
  deps: Required<Pick<CollectDeps, "fetchFn" | "textMaxChars">>,
): Promise<InfoItem[]> {
  if (desc.discovery.kind !== "json-api") return [];
  const disc: JsonApiDiscovery = desc.discovery;
  const listJson = await fetchText(disc.listUrl, deps.fetchFn, requestInit(desc));
  let data: unknown;
  try {
    data = JSON.parse(listJson);
  } catch {
    return [];
  }
  const rows = disc.itemsPath ? dotPath(data, disc.itemsPath) : data;
  if (!Array.isArray(rows)) return [];
  const limit = desc.limit ?? DEFAULT_LIMIT;
  const items: InfoItem[] = [];
  for (const row of rows.slice(0, limit)) {
    if (!row || typeof row !== "object") continue;
    const id = pickString(row, disc.fields.id);
    if (!id) continue;
    const url =
      pickString(row, disc.fields.url) ||
      (disc.urlTemplate ? fillTemplate(disc.urlTemplate, id) : "");
    const base: InfoItem = {
      id: itemId(desc.id, id),
      source: desc.id,
      sourceName: desc.name,
      title: pickString(row, disc.fields.title) || id,
      url,
      publishedAt: pickString(row, disc.fields.publishedAt),
      summaryOnly: true,
    };
    const summaryHtml = pickString(row, disc.fields.summary);
    if (summaryHtml) base.summary = summaryText(summaryHtml);

    if (desc.fulltext.mode === "feed-field") {
      // Row already carries the body (wp-json content.rendered).
      const body = pickString(row, disc.fields.content);
      if (body) {
        base.contentHtml = body;
        base.textContent = htmlToText(body).slice(0, deps.textMaxChars);
        base.summaryOnly = false;
      }
    } else if (desc.fulltext.mode === "detail-endpoint") {
      const ft = desc.fulltext;
      try {
        const detailJson = await fetchText(
          fillTemplate(ft.urlTemplate, id),
          deps.fetchFn,
          requestInit(desc, ft.headers),
        );
        const detail = JSON.parse(detailJson);
        const body = detailContent(detail, ft.contentPath);
        if (body) {
          base.contentHtml = body;
          base.textContent = htmlToText(body).slice(0, deps.textMaxChars);
          base.summaryOnly = false;
        }
        const t = ft.titlePath ? detailContent(detail, ft.titlePath) : "";
        if (t) base.title = t;
        const p = ft.publishedAtPath ? detailContent(detail, ft.publishedAtPath) : "";
        if (p) base.publishedAt = p;
      } catch {
        // Detail fetch failed — keep the list-summary item, flagged summary-only.
      }
    }
    items.push(base);
  }
  return items;
}

// Merge a source's UA override + any per-request headers into a fetch init. The
// http wrapper still supplies the default UA and empty Origin when absent.
function requestInit(
  desc: SourceDescriptor,
  extra?: Record<string, string>,
): RequestInit | undefined {
  const headers: Record<string, string> = {};
  const discHeaders = (desc.discovery as { headers?: Record<string, string> }).headers;
  if (discHeaders) Object.assign(headers, discHeaders);
  if (extra) Object.assign(headers, extra);
  if (desc.userAgent) headers["User-Agent"] = desc.userAgent;
  return Object.keys(headers).length ? { headers } : undefined;
}

// --- public API ------------------------------------------------------------

// Execute one descriptor. Throws on a discovery-layer failure (list/feed fetch)
// so collectAll can isolate it; per-item body failures degrade to summary-only.
export async function collectSource(
  desc: SourceDescriptor,
  deps: CollectDeps = {},
): Promise<InfoItem[]> {
  const filled = {
    fetchFn: deps.fetchFn ?? infoFetch,
    textMaxChars: deps.textMaxChars ?? 20_000,
    extract: deps.extract,
  };
  switch (desc.discovery.kind) {
    case "feed":
      return collectFeed(desc, filled);
    case "listpage":
      return collectListpage(desc, filled);
    case "json-api":
      return collectJsonApi(desc, filled);
    case "stream":
      throw new Error(`stream sources are not supported yet (${desc.id})`);
    default:
      return [];
  }
}

// Per-source health, surfaced to the source-list UI later. Derived (not synced).
export interface SourceHealth {
  lastSuccess?: number;
  lastError?: string;
  lastErrorAt?: number;
}

// Run every enabled descriptor with per-source isolation: one source throwing
// (host down, shape changed) never sinks the others. Returns the merged items
// and an updated health map (prior entries for skipped/disabled sources kept).
export async function collectAll(
  descriptors: SourceDescriptor[],
  deps: CollectDeps = {},
  prior: Record<string, SourceHealth> = {},
): Promise<{ items: InfoItem[]; health: Record<string, SourceHealth> }> {
  const now = deps.now ?? (() => Date.now());
  const health: Record<string, SourceHealth> = { ...prior };
  const enabled = descriptors.filter((d) => d.enabled);
  const results = await Promise.all(
    enabled.map(async (desc) => {
      try {
        const items = await collectSource(desc, deps);
        health[desc.id] = { ...health[desc.id], lastSuccess: now(), lastError: undefined, lastErrorAt: undefined };
        return items;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`info source ${desc.id} failed`, e);
        health[desc.id] = { ...health[desc.id], lastError: msg, lastErrorAt: now() };
        return [] as InfoItem[];
      }
    }),
  );
  return { items: results.flat(), health };
}
