// Pure page reader for the info companion's read_page query tool (docs/17). Given
// a fetched page's body + content-type, turn it into a readable summary the AI
// can scan to find its way around a site: the <title>, the visible text, and the
// FULL link list (every nav/section link, not just article links — reading the
// navigation to find a channel's real URL is the whole point). Non-HTML bodies
// (feeds, JSON) are passed back raw and truncated with their content-type noted.
//
// DOM-free (regex + the shared htmlToText), so it unit-tests in bun without a
// webview. This is deliberately the htmlToText layer, not the Readability stack:
// Readability strips nav to isolate an article body, which is the opposite of
// what read_page needs.

import { htmlToText, decodeEntities } from "./sanitize";

// How much readable text / raw body to keep. The AI is exploring, not reading in
// full; a few thousand chars is enough to judge a page's nature and find links.
export const READ_PAGE_TEXT_CHARS = 4000;
// Cap on the link list so a link-heavy homepage doesn't flood the tool result.
export const READ_PAGE_MAX_LINKS = 120;

export interface PageLink {
  text: string;
  url: string;
}

export interface PageReadout {
  isHtml: boolean;
  // HTML pages:
  title?: string;
  text?: string;
  textTruncated?: boolean;
  links?: PageLink[];
  linksTruncated?: boolean;
  // Non-HTML bodies (feed/JSON/plain): the raw body, truncated.
  raw?: string;
  rawTruncated?: boolean;
  // The content-type reported for a non-HTML body, for the AI to see.
  contentType?: string;
}

// Whether a fetched body should be read as HTML. The content-type wins; with no
// usable type, sniff the first bytes for an HTML marker (a feed/JSON body starts
// with "<?xml", "<rss", "<feed", "{" or "[" instead).
export function isHtmlPage(body: string, contentType?: string | null): boolean {
  if (contentType) {
    if (/html/i.test(contentType)) return true;
    if (/xml|json|rss|atom|rdf|text\/plain/i.test(contentType)) return false;
  }
  const head = body.slice(0, 2000).replace(/^﻿/, "").trimStart();
  if (/^<!doctype\s+html/i.test(head) || /<html[\s>]/i.test(head) || /<body[\s>]/i.test(head)) return true;
  if (/^<\?xml|^<rss\b|^<feed[\s>]|^<rdf:RDF[\s>]|^[{[]/i.test(head)) return false;
  // A bare HTML fragment with no doctype still reads as HTML.
  return /<[a-z][\s\S]*>/i.test(head);
}

// The page's <title>, decoded and whitespace-collapsed. Empty string if none.
export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return "";
  return decodeEntities(m[1]).replace(/\s+/g, " ").trim();
}

// Every anchor in the page as { anchor text → absolute URL }. Relative hrefs are
// resolved against baseUrl; anchors with empty text are skipped; duplicate URLs
// are dropped (first anchor text wins); only http(s) destinations are kept (so
// javascript:, mailto:, tel:, and bare #fragments fall out). Unlike the probe's
// article-link scraper this keeps ALL links — nav and sections included.
export function extractPageLinks(html: string, baseUrl: string): PageLink[] {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    if (!href || href.startsWith("#")) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(abs)) continue;
    const text = htmlToText(m[2]).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ text, url: abs });
  }
  return out;
}

// Read a fetched body into a readout: HTML → title/text/links, anything else →
// raw truncated with its content-type. Pure; the tool injects the fetch.
export function readPage(body: string, baseUrl: string, contentType?: string | null): PageReadout {
  if (!isHtmlPage(body, contentType)) {
    const raw = body.slice(0, READ_PAGE_TEXT_CHARS);
    return {
      isHtml: false,
      raw,
      rawTruncated: body.length > raw.length,
      contentType: contentType?.split(";")[0].trim() || "unknown",
    };
  }
  const fullText = htmlToText(body);
  const text = fullText.slice(0, READ_PAGE_TEXT_CHARS);
  const allLinks = extractPageLinks(body, baseUrl);
  const links = allLinks.slice(0, READ_PAGE_MAX_LINKS);
  return {
    isHtml: true,
    title: extractTitle(body),
    text,
    textTruncated: fullText.length > text.length,
    links,
    linksTruncated: allLinks.length > links.length,
  };
}
