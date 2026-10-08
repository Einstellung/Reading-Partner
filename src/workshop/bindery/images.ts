// Fetching the pictures a manuscript's body asks for (docs/67 「图」). Done at
// ingest, once, so the document carries its pictures and paginates the same on
// a device that cannot reach the CDN.

import type { ArticleImage } from "./build-article";
import { collectImageSrcs, decodeDataImage } from "./page-meta";

/** What a fetch gave back, stripped to what the bindery reads. */
export interface FetchedBytes {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  contentType: string | null;
  /**
   * The Content-Disposition header, where the host passes it on: a download
   * (a Drive file) names itself there and nowhere else.
   */
  contentDisposition?: string | null;
}

export type FetchBytes = (url: string) => Promise<FetchedBytes>;

// Per image and in total, and a count: an article with two hundred images is a
// gallery, and the reader is waiting on this fetch.
export const MAX_IMAGES = 30;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_TOTAL = 20 * 1024 * 1024;

/**
 * Download the body's pictures, in document order, within the caps. An image
 * that fails, is too big, or falls past a cap is simply left out: the <img> that
 * pointed at it becomes a fixed-height placeholder when the EPUB is built, which
 * keeps the pagination the same on a device that could not reach the CDN.
 *
 * The key of each is the src string exactly as the HTML spells it, because that
 * is what the build matches on. `requested` counts every distinct src, the ones
 * past the cap included.
 */
export async function fetchImages(
  html: string,
  pageUrl: string,
  fetch: FetchBytes,
): Promise<{ images: ArticleImage[]; requested: number }> {
  const wanted = collectImageSrcs(html, pageUrl);
  const images: ArticleImage[] = [];
  let total = 0;
  for (const { src, url } of wanted.slice(0, MAX_IMAGES)) {
    const inline = decodeDataImage(src);
    if (inline) {
      if (inline.bytes.length > MAX_IMAGE_BYTES || total + inline.bytes.length > MAX_IMAGES_TOTAL) {
        continue;
      }
      total += inline.bytes.length;
      images.push({ src, bytes: inline.bytes, mediaType: inline.mediaType });
      continue;
    }
    let res: FetchedBytes;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok || res.bytes.length === 0) continue;
    if (res.bytes.length > MAX_IMAGE_BYTES || total + res.bytes.length > MAX_IMAGES_TOTAL) continue;
    total += res.bytes.length;
    images.push({
      src,
      bytes: res.bytes,
      mediaType: (res.contentType ?? "").split(";")[0].trim() || "application/octet-stream",
    });
  }
  return { images, requested: wanted.length };
}
