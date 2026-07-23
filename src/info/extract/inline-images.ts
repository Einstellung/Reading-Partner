// Inline external article images as data: URLs (docs/pitfall/30). The webview
// blocks every external <img> twice — the CSP img-src allows only 'self'/data:/
// blob:, and COEP require-corp (needed by the PDFium WASM engine) blocks
// cross-origin loads — so `<img src="https://...">` can never render directly.
// The fix: fetch each image's bytes through the Tauri http route (which the
// webview's CSP/CORS never sees) and swap the src for a data: URL.
//
// This module is the pure, testable half: src extraction, src rewrite, caps,
// and the data-URL encoder. The fetch is injected (see fetchImageBytes in
// http.ts); the orchestration and persist-back live in the article view host.

import type { CachedArticle } from "../briefing/store";

// Caps: an article rarely has more than a handful of real images, and a data:
// URL bloats the cache by ~4/3 of the image's bytes, so bound both counts.
export const MAX_IMAGES = 30;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Unique external (http/https) <img> srcs in the sanitized HTML, capped. Data:
// and relative srcs are skipped — data: already renders, relative never resolves.
export function extractImageSrcs(html: string, cap = MAX_IMAGES): string[] {
  const re = /<img\b[^>]*?\ssrc\s*=\s*"([^"]*)"/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= cap) break;
  }
  return out;
}

// Swap every occurrence of `url` in an <img src="..."> for `dataUrl`, leaving
// all other attributes (referrerpolicy, loading) untouched. Never reintroduces
// attributes — the sanitizer stays the security boundary.
export function rewriteImageSrc(html: string, url: string, dataUrl: string): string {
  const re = new RegExp(`(<img\\b[^>]*?\\ssrc\\s*=\\s*")${escapeRegExp(url)}(")`, "gi");
  return html.replace(re, (_full, pre: string, post: string) => `${pre}${dataUrl}${post}`);
}

// Drop every <img> whose src is `url` (a fetch failure or an oversized image
// leaves no broken-image icon — the tag is removed quietly).
export function removeImage(html: string, url: string): string {
  const re = new RegExp(`<img\\b[^>]*?\\ssrc\\s*=\\s*"${escapeRegExp(url)}"[^>]*>`, "gi");
  return html.replace(re, "");
}

// Bytes + response content-type to a data: URL. A non-image or missing
// content-type falls back to image/jpeg (the common case for news CDNs).
export function bytesToDataUrl(bytes: Uint8Array, contentType: string | null): string {
  const raw = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const type = /^image\/[a-z0-9.+-]+$/.test(raw) ? raw : "image/jpeg";
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa exists in the webview and in bun's global scope.
  return `data:${type};base64,${btoa(binary)}`;
}

export interface ImageBytes {
  bytes: Uint8Array;
  contentType: string | null;
}

export type ImageFetch = (url: string) => Promise<ImageBytes>;

export interface InlineOptions {
  onProgress?: (html: string) => void;
  signal?: AbortSignal;
  maxImages?: number;
  maxBytes?: number;
}

// Walk the sanitized HTML's external images, fetch each through the injected
// route, and swap in data: URLs as they arrive. Oversized or failed images are
// removed. Returns the fully rewritten HTML; onProgress fires after each image.
export async function inlineArticleImages(
  html: string,
  fetchImage: ImageFetch,
  opts: InlineOptions = {},
): Promise<string> {
  const cap = opts.maxImages ?? MAX_IMAGES;
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const srcs = extractImageSrcs(html, cap);
  let current = html;
  for (const url of srcs) {
    if (opts.signal?.aborted) break;
    try {
      const { bytes, contentType } = await fetchImage(url);
      current =
        bytes.length > maxBytes
          ? removeImage(current, url)
          : rewriteImageSrc(current, url, bytesToDataUrl(bytes, contentType));
    } catch {
      current = removeImage(current, url);
    }
    opts.onProgress?.(current);
  }
  return current;
}

// Merge inlined HTML back into a day's article record, preserving textContent.
// Pure so the persist-back path is testable without the Tauri fs plugin.
export function mergeInlinedHtml(
  articles: Record<string, CachedArticle>,
  itemId: string,
  contentHtml: string,
): Record<string, CachedArticle> {
  const prev = articles[itemId];
  if (!prev) return articles;
  return { ...articles, [itemId]: { ...prev, contentHtml } };
}
