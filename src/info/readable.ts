// The real readable-article extraction (docs/16): build a Document from the page
// HTML with the webview's native DOMParser (no jsdom) and run Readability over
// it. Kept in its own module so the adapters and their bun tests never import
// Readability (which needs a DOM); live.ts injects this into collectQbitai.

import { Readability } from "@mozilla/readability";
import { sanitizeArticleHtml } from "./sanitize";
import type { ExtractReadable } from "./qbitai";

export const extractReadable: ExtractReadable = (html, url) => {
  if (typeof DOMParser === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Readability resolves relative URLs against the document's base; set it so
    // images/links in the article point at absolute URLs.
    try {
      const base = doc.createElement("base");
      base.setAttribute("href", url);
      doc.head?.appendChild(base);
    } catch {
      // A missing <head> is fine; Readability still runs.
    }
    const article = new Readability(doc).parse();
    if (!article?.content) return null;
    return {
      title: (article.title ?? "").trim(),
      contentHtml: sanitizeArticleHtml(article.content),
      textContent: (article.textContent ?? "").trim(),
    };
  } catch {
    return null;
  }
};
