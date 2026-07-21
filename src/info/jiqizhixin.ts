// jiqizhixin (机器之心) adapter. The site exposes an internal JSON API: a list
// endpoint with short summaries and slugs, and a per-slug endpoint with the full
// article HTML. Parsing is pure over the fetched text (tolerant of field-name
// variants, since the API is undocumented); the fetch orchestration takes an
// injected FetchFn so tests drive it with fixtures.

import { fetchText, infoFetch, type FetchFn } from "./http";
import { itemId } from "./id";
import { htmlToText } from "./sanitize";
import { JIQIZHIXIN } from "./sources";
import type { InfoItem } from "./types";

// One list-endpoint row, only the fields the briefing uses.
export interface JqxListItem {
  slug: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// Parse the list JSON into rows. Skips entries without a slug (can't fetch full
// text). Tolerant: unknown shape yields [].
export function parseJqxList(json: string): JqxListItem[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const articles = (data as { articles?: unknown })?.articles;
  if (!Array.isArray(articles)) return [];
  const out: JqxListItem[] = [];
  for (const raw of articles) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const slug = firstString(a, ["slug"]);
    if (!slug) continue;
    const summaryHtml = firstString(a, ["content", "summary", "description"]);
    out.push({
      slug,
      title: firstString(a, ["title"]) || slug,
      url: `https://www.jiqizhixin.com/articles/${slug}`,
      publishedAt: firstString(a, ["publishedAt", "published_at", "published_time"]),
      summary: htmlToText(summaryHtml).slice(0, 400),
    });
  }
  return out;
}

// Parse a full-article JSON into {contentHtml, title?, publishedAt?}. Tolerant of
// the field names the API might use for the body.
export function parseJqxArticle(json: string): { contentHtml: string; title: string; publishedAt: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { contentHtml: "", title: "", publishedAt: "" };
  }
  const a = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  // Some JSON APIs nest the article under `article` / `data`.
  const nested = (a.article ?? a.data) as Record<string, unknown> | undefined;
  const body = nested && typeof nested === "object" ? nested : a;
  return {
    contentHtml: firstString(body, ["content", "body", "html", "content_html"]),
    title: firstString(body, ["title"]),
    publishedAt: firstString(body, ["publishedAt", "published_at", "published_time"]),
  };
}

// Fetch the list then each article's full text. limit caps how many articles are
// pulled (each is a request); an article whose full-text fetch fails still ships
// with its list summary rather than dropping out. maxChars trims the plain text.
export async function collectJiqizhixin(opts: {
  fetchFn?: FetchFn;
  limit?: number;
  textMaxChars?: number;
}): Promise<InfoItem[]> {
  const fetchFn = opts.fetchFn ?? infoFetch;
  const limit = opts.limit ?? 20;
  const textMaxChars = opts.textMaxChars ?? 20_000;
  const listJson = await fetchText(JIQIZHIXIN.list, fetchFn);
  const rows = parseJqxList(listJson).slice(0, limit);
  const items: InfoItem[] = [];
  for (const row of rows) {
    const base: InfoItem = {
      id: itemId("jiqizhixin", row.slug),
      source: "jiqizhixin",
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      summary: row.summary || undefined,
    };
    try {
      const articleJson = await fetchText(JIQIZHIXIN.article(row.slug), fetchFn);
      const parsed = parseJqxArticle(articleJson);
      if (parsed.contentHtml) {
        base.contentHtml = parsed.contentHtml;
        base.textContent = htmlToText(parsed.contentHtml).slice(0, textMaxChars);
      }
      if (parsed.title) base.title = parsed.title;
      if (parsed.publishedAt) base.publishedAt = parsed.publishedAt;
    } catch {
      // Full text unavailable — keep the summary-only item.
    }
    items.push(base);
  }
  return items;
}
