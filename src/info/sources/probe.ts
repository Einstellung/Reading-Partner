// AI source probing (docs/17): given a site URL or bare domain, try the common
// feed paths, sniff the response format, judge whether the feed carries full text
// or only summaries, and — when no feed exists — fall back to the homepage to
// tell an SSR list page from a browser-rendered SPA. The result is a candidate
// SourceDescriptor plus a human-readable probe log. This固化s what the five
// rounds of ingestion research did by hand into a tool.
//
// Everything here is pure except probeSource, whose only side effect is the
// injected fetch (a FetchFn). The path generation, response sniffing, full-text
// assessment, and descriptor assembly are pure functions so they unit-test in bun
// without a network. The feed parser (parseFeed) and text measurer (htmlToText)
// are the same DOM-free helpers the engine uses.

import { parseFeed, type FeedEntry } from "./feed";
import { htmlToText } from "../extract/sanitize";
import { BUILTIN_SOURCES, builtinCaveat } from "./builtins";
import type { FetchFn } from "../extract/http";
import type { Fulltext, SourceDescriptor } from "./descriptor";

// The feed paths tried in order, most common first. wp-json is last: it is a full
// JSON API, only reached when the plain feed paths miss.
export const FEED_PATHS = [
  "/feed",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/feed.xml",
  "/index.xml",
  "/wp-json/wp/v2/posts",
];

// A feed body long enough to count as full text rather than a teaser.
const FULLTEXT_MIN_CHARS = 600;
// Below this the homepage looks like an empty SPA shell rather than SSR content.
const SPA_TEXT_MAX = 500;

export interface SiteInput {
  origin: string;
  url: string;
  host: string;
}

// Normalize "example.com" / "www.example.com/blog" / "https://example.com" to an
// origin + full url + host. Bare words with no dot (not a domain) return null.
export function normalizeSiteInput(input: string): SiteInput | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return { origin: u.origin, url: u.toString(), host: u.hostname };
  } catch {
    return null;
  }
}

// The ordered feed URLs to try. If the user already pasted a URL with a path (it
// may itself be a feed), that exact URL is tried first, then the origin + each
// common path. Deduplicated.
export function feedCandidateUrls(input: string): string[] {
  const n = normalizeSiteInput(input);
  if (!n) return [];
  const u = new URL(n.url);
  const out: string[] = [];
  if (u.pathname && u.pathname !== "/") out.push(n.url);
  for (const p of FEED_PATHS) out.push(n.origin + p);
  return [...new Set(out)];
}

// A stable descriptor id from a host: drop www, dots to dashes ("www.qbitai.com"
// -> "qbitai-com"). Never empty for a valid host.
export function idFromHost(host: string): string {
  const h = host.replace(/^www\./i, "").toLowerCase();
  return h.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

export type FeedFormat = "rss" | "atom" | "rdf" | "wp-json" | "unknown";

// Sniff a response's shape from its first bytes (and content-type as a fallback).
// JSON bodies are reported as "wp-json" — the caller confirms the posts shape.
export function sniffFeedFormat(body: string, contentType?: string | null): FeedFormat {
  const head = body.slice(0, 2000);
  const trimmed = head.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "wp-json";
  if (/<rdf:RDF[\s>]/i.test(head)) return "rdf";
  if (/<feed[\s>]/i.test(head)) return "atom";
  if (/<rss\b/i.test(head)) return "rss";
  if (contentType) {
    if (/atom\+xml/i.test(contentType)) return "atom";
    if (/(rss|rdf)\+xml/i.test(contentType)) return "rss";
    if (/json/i.test(contentType)) return "wp-json";
  }
  return "unknown";
}

// If a JSON body is a WordPress posts list (rows with title + a body/excerpt
// field), return the rows; else null. WP posts carry title.rendered and
// content.rendered, so the engine can read the whole body inline.
export function wpJsonPosts(body: string): Record<string, unknown>[] | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  if (!data.every((r) => r && typeof r === "object")) return null;
  const first = data[0] as Record<string, unknown>;
  const hasTitle = "title" in first || "title.rendered" in first;
  const hasBody = "content" in first || "excerpt" in first;
  return hasTitle && hasBody ? (data as Record<string, unknown>[]) : null;
}

type FeedFieldName = "content:encoded" | "content" | "summary" | "description";

// Map a FeedEntry property name to the descriptor's fulltext field selector.
const FIELD_KEYS: { key: keyof FeedEntry; field: FeedFieldName }[] = [
  { key: "contentEncoded", field: "content:encoded" },
  { key: "content", field: "content" },
  { key: "summary", field: "summary" },
  { key: "description", field: "description" },
];

export interface FeedAssessment {
  mode: "feed-field" | "fetch-page" | "none";
  field?: FeedFieldName;
  // Median plain-text length of the chosen field across the sampled entries.
  sampleChars: number;
}

// Decide where an feed's body comes from: the field with the longest median text
// wins; if that clears the full-text bar it is feed-field, otherwise the entries
// with article links become fetch-page, and a feed with neither is discovery-only.
export function assessFeedFulltext(entries: FeedEntry[]): FeedAssessment {
  const sample = entries.slice(0, 5);
  let bestField: FeedFieldName | undefined;
  let bestLen = 0;
  for (const { key, field } of FIELD_KEYS) {
    const lens = sample
      .map((e) => htmlToText(String(e[key] || "")).length)
      .sort((a, b) => a - b);
    const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
    if (median > bestLen) {
      bestLen = median;
      bestField = field;
    }
  }
  if (bestLen >= FULLTEXT_MIN_CHARS) return { mode: "feed-field", field: bestField, sampleChars: bestLen };
  if (sample.some((e) => /^https?:\/\//i.test(e.link))) return { mode: "fetch-page", sampleChars: bestLen };
  return { mode: "none", sampleChars: bestLen };
}

// Same-origin article-link paths pulled from a homepage's HTML (query/hash
// stripped, deduped). Used to tell an SSR list page from an SPA shell.
export function extractArticleLinks(html: string, origin: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let href = m[1];
    if (href.startsWith("//") || /^https?:\/\//i.test(href)) {
      try {
        const u = new URL(href.startsWith("//") ? "https:" + href : href);
        if (u.origin !== origin) continue;
        href = u.pathname;
      } catch {
        continue;
      }
    } else if (!href.startsWith("/")) {
      continue;
    }
    href = href.split(/[?#]/)[0];
    if (!href || href === "/") continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

// Turn a concrete path into a regex source: escape it, then generalize digit runs
// to \d+ ("/article/12345.html" -> "/article/\d+\.html").
export function generalizePath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\d+/g, "\\d+");
}

// Infer a shared article-link pattern from a homepage's links: generalize each
// numeric path, then take the pattern shared by at least three links. Numeric ids
// are required — a slug-only path can't be generalized without over-matching nav.
export function inferLinkPattern(paths: string[]): string | null {
  const counts = new Map<string, number>();
  for (const p of paths) {
    if (!/\d/.test(p)) continue;
    const pat = generalizePath(p);
    counts.set(pat, (counts.get(pat) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [pat, n] of counts) {
    if (n > bestN) {
      best = pat;
      bestN = n;
    }
  }
  return bestN >= 3 ? best : null;
}

// A homepage that is a client-rendered app shell: an empty mount div and almost
// no server-rendered text. Such sites have no article links to scrape.
export function looksLikeSpa(html: string): boolean {
  const hasShell = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html);
  return hasShell && htmlToText(html).length < SPA_TEXT_MAX;
}

// --- descriptor assembly ---------------------------------------------------

function buildFeedDescriptor(n: SiteInput, feedUrl: string, fmt: FeedFormat, entries: FeedEntry[]): SourceDescriptor {
  const a = assessFeedFulltext(entries);
  const fulltext: Fulltext =
    a.mode === "feed-field"
      ? { mode: "feed-field", field: a.field }
      : a.mode === "fetch-page"
        ? { mode: "fetch-page" }
        : { mode: "none" };
  const format = fmt === "atom" ? "atom" : fmt === "rdf" ? "rdf" : "rss";
  return {
    id: idFromHost(n.host),
    name: n.host.replace(/^www\./i, ""),
    line: "",
    discovery: { kind: "feed", url: feedUrl, format },
    fulltext,
    enabled: true,
  };
}

function buildWpJsonDescriptor(n: SiteInput, listUrl: string): SourceDescriptor {
  const withCount = listUrl.includes("per_page")
    ? listUrl
    : listUrl + (listUrl.includes("?") ? "&" : "?") + "per_page=20";
  return {
    id: idFromHost(n.host),
    name: n.host.replace(/^www\./i, ""),
    line: "",
    discovery: {
      kind: "json-api",
      listUrl: withCount,
      urlTemplate: `${n.origin}/?p={id}`,
      fields: {
        id: "id",
        title: "title.rendered",
        url: "link",
        publishedAt: "date",
        summary: "excerpt.rendered",
        content: "content.rendered",
      },
    },
    fulltext: { mode: "feed-field" },
    enabled: true,
  };
}

function buildListpageDescriptor(n: SiteInput, linkPattern: string): SourceDescriptor {
  return {
    id: idFromHost(n.host),
    name: n.host.replace(/^www\./i, ""),
    line: "",
    discovery: { kind: "listpage", url: n.origin + "/", linkPattern, base: n.origin },
    fulltext: { mode: "fetch-page" },
    enabled: true,
  };
}

// A human phrase for a descriptor's pipe type, for the confirm card and probe
// summary. Pure.
export function pipeLabel(desc: SourceDescriptor): string {
  const d = desc.discovery;
  const f = desc.fulltext;
  if (d.kind === "json-api") {
    return f.mode === "detail-endpoint" || (f.mode === "feed-field" && d.fields.content)
      ? "API with full articles"
      : "API, headlines only";
  }
  if (d.kind === "listpage") return "Article list, fetches each page";
  if (d.kind === "stream") return "Live updates";
  // feed discovery
  if (f.mode === "feed-field") return f.truncationMarker ? "Full text in feed (some paywalled)" : "Full text in feed";
  if (f.mode === "fetch-page") return "Feed headlines, fetches each page";
  return "Headlines only, opens in browser";
}

// --- builtin domain matching -----------------------------------------------
// The ingestion research is sunk here rather than injected as a menu: when the
// user names a domain a builtin already covers, the probe returns that verified
// descriptor (with its noFetchPage/paywall/limit fixes) instead of re-probing.
// Zero bias toward recommendation — this only fires after the user points at a
// source by name or link.

// Every hostname a descriptor references (discovery url + json-api template/base
// + detail-endpoint template), www-stripped and lower-cased.
function descriptorHosts(d: SourceDescriptor): string[] {
  const urls: string[] = [];
  const disc = d.discovery;
  if (disc.kind === "feed" || disc.kind === "listpage" || disc.kind === "stream") urls.push(disc.url);
  if (disc.kind === "json-api") {
    urls.push(disc.listUrl);
    if (disc.urlTemplate) urls.push(disc.urlTemplate);
  }
  if (disc.kind === "listpage" && disc.base) urls.push(disc.base);
  if (d.fulltext.mode === "detail-endpoint") urls.push(d.fulltext.urlTemplate);
  const hosts = new Set<string>();
  for (const u of urls) {
    try {
      hosts.add(new URL(u).hostname.replace(/^www\./i, "").toLowerCase());
    } catch {
      // Skip an unparseable template.
    }
  }
  return [...hosts];
}

// Two hosts belong to the same site when they are equal or one is a subdomain of
// the other (www already stripped): "rss.arxiv.org" matches "arxiv.org".
function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

// The builtin descriptor whose site the input names, or undefined. Returned
// enabled, paired with the source's engineering caveat when it has one.
export function matchBuiltinSource(
  input: string,
): { descriptor: SourceDescriptor; note?: string } | undefined {
  const n = normalizeSiteInput(input);
  if (!n) return undefined;
  const inHost = n.host.replace(/^www\./i, "").toLowerCase();
  for (const d of BUILTIN_SOURCES) {
    if (descriptorHosts(d).some((h) => sameSite(inHost, h))) {
      return { descriptor: { ...d, enabled: true }, note: builtinCaveat(d.id) };
    }
  }
  return undefined;
}

// --- the probe orchestrator (network injected) -----------------------------

export interface ProbeDeps {
  fetchFn: FetchFn;
}

export interface ProbeResult {
  ok: boolean;
  descriptor?: SourceDescriptor;
  // Human phrase for the pipe type when ok.
  pipeLabel: string;
  // Honest reason it can't be connected when not ok.
  reason?: string;
  // An engineering caveat to relay (a builtin match's known pitfall), if any.
  note?: string;
  // The step-by-step probe log, one line per URL tried.
  steps: string[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Probe a site: try each feed candidate, then fall back to the homepage. Returns
// a candidate descriptor + a log. Only the fetch is a side effect.
export async function probeSource(input: string, deps: ProbeDeps): Promise<ProbeResult> {
  const steps: string[] = [];
  const n = normalizeSiteInput(input);
  if (!n) return { ok: false, pipeLabel: "", reason: "That is not a valid site URL or domain.", steps };

  // A domain a builtin already covers short-circuits: return the verified
  // descriptor rather than re-probing (the research already solved its quirks).
  const builtin = matchBuiltinSource(input);
  if (builtin) {
    const label = pipeLabel(builtin.descriptor);
    steps.push(`${n.host} → matched the verified built-in "${builtin.descriptor.name}" (${label}); no probing needed`);
    return { ok: true, descriptor: builtin.descriptor, pipeLabel: label, note: builtin.note, steps };
  }

  for (const url of feedCandidateUrls(input)) {
    let body: string;
    let ct: string | null;
    try {
      const r = await deps.fetchFn(url);
      if (!r.ok) {
        steps.push(`${url} → HTTP ${r.status}`);
        continue;
      }
      body = await r.text();
      ct = r.headers.get("content-type");
    } catch (e) {
      steps.push(`${url} → ${errMsg(e)}`);
      continue;
    }
    const fmt = sniffFeedFormat(body, ct);
    if (fmt === "wp-json") {
      const posts = wpJsonPosts(body);
      if (posts) {
        steps.push(`${url} → WordPress JSON API, ${posts.length} posts with inline bodies`);
        const d = buildWpJsonDescriptor(n, url);
        return { ok: true, descriptor: d, pipeLabel: pipeLabel(d), steps };
      }
      steps.push(`${url} → JSON but not a posts list`);
      continue;
    }
    if (fmt === "rss" || fmt === "atom" || fmt === "rdf") {
      const entries = parseFeed(body);
      if (entries.length === 0) {
        steps.push(`${url} → ${fmt} but no entries`);
        continue;
      }
      const d = buildFeedDescriptor(n, url, fmt, entries);
      const a = assessFeedFulltext(entries);
      steps.push(`${url} → ${fmt} feed, ${entries.length} entries, ${a.mode} (~${a.sampleChars} chars/body)`);
      return { ok: true, descriptor: d, pipeLabel: pipeLabel(d), steps };
    }
    steps.push(`${url} → not a feed`);
  }

  // No feed — try the homepage to tell SSR list from SPA.
  try {
    const r = await deps.fetchFn(n.origin + "/");
    if (r.ok) {
      const html = await r.text();
      const links = extractArticleLinks(html, n.origin);
      const pattern = inferLinkPattern(links);
      if (pattern) {
        steps.push(`homepage → SSR list, article links match ${pattern}`);
        const d = buildListpageDescriptor(n, pattern);
        return { ok: true, descriptor: d, pipeLabel: pipeLabel(d), steps };
      }
      if (looksLikeSpa(html)) {
        steps.push("homepage → SPA shell, no server-rendered article links");
        return {
          ok: false,
          pipeLabel: "",
          reason: "This site renders its articles in the browser (a single-page app) and has no feed, so it can't be connected automatically.",
          steps,
        };
      }
      steps.push("homepage → no recognizable article-link pattern");
    } else {
      steps.push(`homepage → HTTP ${r.status}`);
    }
  } catch (e) {
    steps.push(`homepage → ${errMsg(e)}`);
  }

  return {
    ok: false,
    pipeLabel: "",
    reason: "No feed was found and the homepage has no detectable article list.",
    steps,
  };
}
