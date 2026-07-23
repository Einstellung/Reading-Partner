// A tolerant feed parser for the info engine (docs/17). One reader eats RSS 2.0,
// Atom, and RDF (RSS 1.0): the three shapes differ in the entry element
// (<item> vs <entry>), where the link lives (text vs an href attribute), and
// which tag carries the body (description / content:encoded / summary /
// content). Regex over the XML, no DOMParser — same posture as arxiv.ts and
// qbitai.ts, so it runs identically in bun tests and the webview. CDATA and
// entities are decoded. A malformed feed yields [] rather than throwing.

import { decodeEntities } from "../extract/sanitize";

// A normalized entry: every body-bearing field the descriptor might name is
// pulled if present, so fulltext "feed-field" can select among them.
export interface FeedEntry {
  title: string;
  link: string;
  publishedAt: string; // ISO where parseable, else the raw string
  description: string; // RSS <description>
  contentEncoded: string; // <content:encoded>
  content: string; // Atom <content> / RSS <content>
  summary: string; // Atom <summary>
  category: string;
}

// Inner text of the first <name>...</name> in a block, CDATA- and
// entity-decoded. Namespaced names (content:encoded) work: the colon is literal.
function tagText(block: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!m) return "";
  const inner = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return decodeEntities((cdata ? cdata[1] : inner).trim());
}

// The link for an entry. RSS/RDF put it in <link>text</link>; Atom uses
// <link href="..."/> (prefer rel="alternate" or a bare link, skip rel="self").
function linkOf(block: string): string {
  const text = tagText(block, "link");
  if (text && /^https?:\/\//i.test(text)) return text;
  // Atom href form. Collect every <link .../> and choose the best.
  const links = block.match(/<link\b[^>]*>/gi) ?? [];
  let fallback = "";
  for (const l of links) {
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(l)?.[1] ?? /\bhref\s*=\s*'([^']*)'/i.exec(l)?.[1];
    if (!href) continue;
    const rel = /\brel\s*=\s*"([^"]*)"/i.exec(l)?.[1] ?? /\brel\s*=\s*'([^']*)'/i.exec(l)?.[1] ?? "";
    if (rel === "self" || rel === "edit") continue;
    if (rel === "" || rel === "alternate") return decodeEntities(href);
    if (!fallback) fallback = href;
  }
  return decodeEntities(fallback || text);
}

// Best-effort ISO date; leaves the raw string if it can't be parsed.
function normDate(raw: string): string {
  if (!raw) return "";
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw : new Date(t).toISOString();
}

function parseEntry(block: string): FeedEntry | null {
  const link = linkOf(block);
  const title = tagText(block, "title");
  if (!title && !link) return null;
  const published =
    tagText(block, "pubDate") ||
    tagText(block, "published") ||
    tagText(block, "updated") ||
    tagText(block, "dc:date") ||
    tagText(block, "date");
  return {
    title,
    link,
    publishedAt: normDate(published),
    description: tagText(block, "description"),
    contentEncoded: tagText(block, "content:encoded"),
    content: tagText(block, "content"),
    summary: tagText(block, "summary"),
    category: tagText(block, "category"),
  };
}

// Parse a feed into entries. <item> covers RSS 2.0 and RDF; <entry> covers Atom.
export function parseFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi);
  if (!blocks) return out;
  for (const block of blocks) {
    const e = parseEntry(block);
    if (e) out.push(e);
  }
  return out;
}

// The body for a "feed-field" fulltext, given the requested field with sane
// fallbacks (a source can mislabel; missing fields degrade gracefully).
export function feedFieldBody(
  entry: FeedEntry,
  field: "content:encoded" | "content" | "summary" | "description" | undefined,
): string {
  switch (field) {
    case "content:encoded":
      return entry.contentEncoded || entry.content || entry.description || entry.summary;
    case "content":
      return entry.content || entry.contentEncoded || entry.description || entry.summary;
    case "summary":
      return entry.summary || entry.description || entry.content || entry.contentEncoded;
    case "description":
      return entry.description || entry.summary || entry.content || entry.contentEncoded;
    default:
      return entry.contentEncoded || entry.content || entry.description || entry.summary;
  }
}
