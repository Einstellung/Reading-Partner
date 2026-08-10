// The generic collection engine (docs/17): collectSource(descriptor) executes a
// declarative source by dispatching on its discovery kind, and collectAll runs a
// list of descriptors with per-source isolation + health tracking. This replaces
// the hand-written jiqizhixin/qbitai adapters — their two shapes (internal JSON
// API, feed + fetched page) are now two branches parameterized by the
// descriptor. Fetching is injected (FetchFn) and readable extraction is injected
// (ExtractReadable), so the whole engine is DOM-free and unit-testable in bun.
//
// A source fetches its articles several at a time (pool.ts) under a cap shared
// by the whole run, and every fetch takes the caller's AbortSignal: a Stop
// pressed during collection has to reach the request in flight, not just the
// phase boundary after it.

import { isAbortError, throwIfAborted } from "../../platform/app/abort";
import { fetchText, infoFetch, type FetchFn } from "../extract/http";
import { itemId } from "../extract/id";
import { htmlToText } from "../extract/sanitize";
import type { ExtractReadable } from "../extract/readable-select";
import { parseFeed, feedFieldBody, type FeedEntry } from "./feed";
import { Gate, mapSettled } from "./pool";
import {
  dotPath,
  pickString,
  type FieldPath,
  type JsonApiDiscovery,
  type SourceDescriptor,
} from "./descriptor";
import type { InfoItem } from "./item";

export interface CollectDeps {
  fetchFn?: FetchFn;
  // Readable extraction for fetch-page/listpage sources. Optional so a purely
  // feed-field/json-api run needs no DOM; a fetch-page source without it yields
  // headline-only items.
  extract?: ExtractReadable;
  // Item text cap fed to triage/chat. Default 20k.
  textMaxChars?: number;
  now?: () => number;
  // Cancels the whole collection: requests in flight are aborted and nothing
  // queued is sent. Sources that settled before the abort are still reported —
  // the run keeps what it paid for and resumes on the rest (docs/16).
  signal?: AbortSignal;
  // Ceiling on requests in flight across every source of a run. collectAll
  // makes one when the caller does not; a lone collectSource (the add-source
  // trial) runs under its per-source limit alone.
  gate?: Gate;
  // Called as each source settles, with the items it produced (none when it
  // failed). Awaited, so the caller can checkpoint a finished source before the
  // slow ones come back — that is what makes a briefing run resumable per source
  // (docs/16) — and it doubles as the collection-liveness signal a UI shows.
  onSourceSettled?(result: SourceSettled): Promise<void> | void;
}

// One settled source. Sources run concurrently, so these arrive in completion
// order, not list order.
export interface SourceSettled {
  source: string;
  sourceName: string;
  items: InfoItem[];
  error?: string;
  // Wall clock the source took, for the timing log and the health sidecar.
  durationMs: number;
}

const DEFAULT_LIMIT = 20;
const SUMMARY_CHARS = 400;

// Article fetches in flight within one source, and across all of them. A source
// is a single host, so its limit is politeness as much as speed; the global one
// keeps a dozen subscribed sources from putting sixty requests on the wire.
export const SOURCE_CONCURRENCY = 5;
export const GLOBAL_CONCURRENCY = 12;

// What the per-kind collectors need, with the optional bits resolved.
interface Filled {
  fetchFn: FetchFn;
  textMaxChars: number;
  extract?: ExtractReadable;
  signal?: AbortSignal;
  gate?: Gate;
}

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

async function collectFeed(desc: SourceDescriptor, deps: Filled): Promise<InfoItem[]> {
  if (desc.discovery.kind !== "feed") return [];
  const init = requestInit(desc);
  const xml = await fetchText(desc.discovery.url, deps.fetchFn, init, { signal: deps.signal });
  const limit = desc.limit ?? DEFAULT_LIMIT;
  const entries = parseFeed(xml).slice(0, limit);
  return perItem(entries, (e) => feedItem(desc, e, deps), deps);
}

// One feed entry as an item. Never throws for a body that would not come — a
// failed page fetch leaves the item summary-only — so the only rejection it
// produces is a cancellation.
async function feedItem(desc: SourceDescriptor, e: FeedEntry, deps: Filled): Promise<InfoItem> {
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
    const body = feedFieldBody(e, desc.fulltext.field);
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
        return base;
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
  return base;
}

// The per-article half of a source, run several at a time under the global cap.
// The results keep the discovery order — triage reads the items in this order
// and so does the reader — and a task that failed anyway is dropped rather than
// left as a hole. A cancellation surfaces as a throw, so the source is not
// reported as settled with half its articles.
async function perItem<T>(
  inputs: T[],
  task: (input: T) => Promise<InfoItem>,
  deps: Filled,
): Promise<InfoItem[]> {
  const results = await mapSettled(inputs, task, {
    limit: SOURCE_CONCURRENCY,
    gate: deps.gate,
    signal: deps.signal,
  });
  throwIfAborted(deps.signal);
  const items: InfoItem[] = [];
  for (const r of results) if (r.ok) items.push(r.value);
  return items;
}

async function fetchAndExtract(
  url: string,
  deps: Filled,
): Promise<{ title: string; contentHtml: string; textContent: string } | null> {
  if (!url || !deps.extract) return null;
  try {
    const html = await fetchText(url, deps.fetchFn, undefined, { signal: deps.signal });
    return deps.extract(html, url);
  } catch (e) {
    // A page that would not load costs the item its body; a stopped run costs
    // the whole source, so that one is not swallowed.
    if (isAbortError(e)) throw e;
    return null;
  }
}

async function collectListpage(desc: SourceDescriptor, deps: Filled): Promise<InfoItem[]> {
  if (desc.discovery.kind !== "listpage") return [];
  const { url, linkPattern, base: baseOrigin } = desc.discovery;
  const html = await fetchText(url, deps.fetchFn, requestInit(desc), { signal: deps.signal });
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
  return perItem(links, (link) => listpageItem(desc, link, deps), deps);
}

async function listpageItem(desc: SourceDescriptor, link: string, deps: Filled): Promise<InfoItem> {
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
  return base;
}

async function collectJsonApi(desc: SourceDescriptor, deps: Filled): Promise<InfoItem[]> {
  if (desc.discovery.kind !== "json-api") return [];
  const disc: JsonApiDiscovery = desc.discovery;
  const listJson = await fetchText(disc.listUrl, deps.fetchFn, requestInit(desc), {
    signal: deps.signal,
  });
  let data: unknown;
  try {
    data = JSON.parse(listJson);
  } catch {
    return [];
  }
  const rows = disc.itemsPath ? dotPath(data, disc.itemsPath) : data;
  if (!Array.isArray(rows)) return [];
  const limit = desc.limit ?? DEFAULT_LIMIT;
  // Rows without an id carry nothing addressable and are dropped before the
  // per-item work, so the concurrent half only ever sees real articles.
  const usable: { row: object; id: string }[] = [];
  for (const row of rows.slice(0, limit)) {
    if (!row || typeof row !== "object") continue;
    const id = pickString(row, disc.fields.id);
    if (id) usable.push({ row, id });
  }
  return perItem(usable, ({ row, id }) => jsonApiItem(desc, disc, row, id, deps), deps);
}

async function jsonApiItem(
  desc: SourceDescriptor,
  disc: JsonApiDiscovery,
  row: object,
  id: string,
  deps: Filled,
): Promise<InfoItem> {
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
        { signal: deps.signal },
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
    } catch (e) {
      // Detail fetch failed — keep the list-summary item, flagged summary-only.
      if (isAbortError(e)) throw e;
    }
  }
  return base;
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
  throwIfAborted(deps.signal);
  const filled: Filled = {
    fetchFn: deps.fetchFn ?? infoFetch,
    textMaxChars: deps.textMaxChars ?? 20_000,
    extract: deps.extract,
    signal: deps.signal,
    gate: deps.gate,
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
  // What the last completed collection of this source cost and produced — the
  // only per-source timing anyone has when a run feels slow.
  lastDurationMs?: number;
  lastItems?: number;
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
  const settled = deps.onSourceSettled;
  const health: Record<string, SourceHealth> = { ...prior };
  const enabled = descriptors.filter((d) => d.enabled);
  // One ceiling for the whole run, shared by every source's per-source limit.
  const gate = deps.gate ?? new Gate(GLOBAL_CONCURRENCY);
  const results = await Promise.all(
    enabled.map(async (desc) => {
      const startedAt = now();
      try {
        const items = await collectSource(desc, { ...deps, gate });
        const durationMs = now() - startedAt;
        health[desc.id] = {
          ...health[desc.id],
          lastSuccess: now(),
          lastError: undefined,
          lastErrorAt: undefined,
          lastDurationMs: durationMs,
          lastItems: items.length,
        };
        await settled?.({ source: desc.id, sourceName: desc.name, items, durationMs });
        return items;
      } catch (e) {
        // A stop is not a source failure. Reporting one would mark the source
        // done-with-an-error in the run checkpoint and blame the host in the
        // health sidecar; staying quiet leaves it pending, so the next Generate
        // simply fetches it.
        if (isAbortError(e) || deps.signal?.aborted) return [] as InfoItem[];
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`info source ${desc.id} failed`, e);
        health[desc.id] = { ...health[desc.id], lastError: msg, lastErrorAt: now() };
        await settled?.({
          source: desc.id,
          sourceName: desc.name,
          items: [],
          error: msg,
          durationMs: now() - startedAt,
        });
        return [] as InfoItem[];
      }
    }),
  );
  return { items: results.flat(), health };
}
