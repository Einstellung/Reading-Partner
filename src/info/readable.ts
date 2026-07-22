// The real readable-article extraction (docs/16, docs/17): build a Document from
// the page HTML with the webview's native DOMParser (no jsdom) and run
// Readability over it, falling back to defuddle when Readability under-extracts
// (empty or a suspiciously short body). Kept in its own module so the engine and
// its bun tests never import Readability/defuddle (which need a DOM); live.ts
// injects this. The pick-between logic is pure and tested in readable-select.ts.

import { Readability } from "@mozilla/readability";
import Defuddle from "defuddle";
import { sanitizeArticleHtml, htmlToText } from "./sanitize";
import { pickExtraction, MIN_BODY_CHARS, type Extraction } from "./readable-select";
import type { ExtractReadable } from "./descriptor";

function parseDoc(html: string, url: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  try {
    const base = doc.createElement("base");
    base.setAttribute("href", url);
    doc.head?.appendChild(base);
  } catch {
    // A missing <head> is fine; the extractors still run.
  }
  return doc;
}

function runReadability(doc: Document): Extraction | null {
  try {
    // Readability mutates the document, so give it a clone.
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (!article?.content) return null;
    return {
      title: (article.title ?? "").trim(),
      contentHtml: sanitizeArticleHtml(article.content),
      textContent: (article.textContent ?? "").trim(),
    };
  } catch {
    return null;
  }
}

function runDefuddle(doc: Document, url: string): Extraction | null {
  try {
    // useAsync:false keeps defuddle from making any network call (its FxTwitter
    // transcript fallback), so extraction stays zero-outbound (docs/17).
    const res = new Defuddle(doc.cloneNode(true) as Document, { url, useAsync: false }).parse();
    if (!res?.content) return null;
    const contentHtml = sanitizeArticleHtml(res.content);
    return {
      title: (res.title ?? "").trim(),
      contentHtml,
      textContent: htmlToText(contentHtml),
    };
  } catch {
    return null;
  }
}

export const extractReadable: ExtractReadable = (html, url) => {
  const doc = parseDoc(html, url);
  if (!doc) return null;
  const primary = runReadability(doc);
  // Only spend the second extraction when Readability came up short.
  if (primary && primary.textContent.length >= MIN_BODY_CHARS) return primary;
  const fallback = runDefuddle(doc, url);
  return pickExtraction(primary, fallback);
};
