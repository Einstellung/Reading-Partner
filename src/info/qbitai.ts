// qbitai (量子位) adapter. The site publishes a native WordPress RSS feed with
// ~10 items carrying only title/link/pubDate/category (no content:encoded), so
// the body is fetched from the article page and pulled out with Readability. The
// feed parse is pure (regex over the XML, no DOMParser — same posture as
// arxiv.ts); the readable extraction is injected (readable.ts wires the real
// DOM-based one in the webview) so this module and its tests stay DOM-free.

import { fetchText, infoFetch, type FetchFn } from "./http";
import { itemId } from "./id";
import { decodeEntities } from "./sanitize";
import { QBITAI } from "./sources";
import type { InfoItem } from "./types";

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  category: string;
}

// A readable-article extraction: (article page HTML, its URL) -> body. Wired to
// Readability in readable.ts; injectable so the collect logic is testable.
export type ExtractReadable = (
  html: string,
  url: string,
) => { title: string; contentHtml: string; textContent: string } | null;

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!m) return "";
  const inner = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return decodeEntities((cdata ? cdata[1] : inner).trim());
}

// Parse the RSS XML into items. Tolerant: a malformed feed yields [].
export function parseQbitaiFeed(xml: string): RssItem[] {
  const out: RssItem[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  if (!items) return out;
  for (const block of items) {
    const link = tag(block, "link");
    const title = tag(block, "title");
    if (!link || !title) continue;
    out.push({ title, link, pubDate: tag(block, "pubDate"), category: tag(block, "category") });
  }
  return out;
}

// Fetch the feed, then each article page, and extract its readable body. limit
// caps how many articles are fetched. An item whose page fetch or extraction
// fails still ships (title/link only) rather than dropping out.
export async function collectQbitai(opts: {
  fetchFn?: FetchFn;
  extract: ExtractReadable;
  limit?: number;
  textMaxChars?: number;
}): Promise<InfoItem[]> {
  const fetchFn = opts.fetchFn ?? infoFetch;
  const limit = opts.limit ?? 10;
  const textMaxChars = opts.textMaxChars ?? 20_000;
  const feedXml = await fetchText(QBITAI.feed, fetchFn);
  const rows = parseQbitaiFeed(feedXml).slice(0, limit);
  const items: InfoItem[] = [];
  for (const row of rows) {
    const base: InfoItem = {
      id: itemId("qbitai", row.link),
      source: "qbitai",
      title: row.title,
      url: row.link,
      publishedAt: row.pubDate ? new Date(row.pubDate).toISOString() : "",
      summary: row.category || undefined,
    };
    try {
      const html = await fetchText(row.link, fetchFn);
      const extracted = opts.extract(html, row.link);
      if (extracted?.contentHtml) {
        base.contentHtml = extracted.contentHtml;
        base.textContent = extracted.textContent.slice(0, textMaxChars);
        if (extracted.title) base.title = extracted.title;
      }
    } catch {
      // Article body unavailable — keep the headline-only item.
    }
    items.push(base);
  }
  return items;
}
