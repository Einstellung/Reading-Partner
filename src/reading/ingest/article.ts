// Taking a URL the reader pasted and making a document out of it (docs/67).
//
// One URL produces one thing on the shelf. A web page is fetched, its body
// extracted, its pictures downloaded and packed, and the result is an EPUB in
// the library, listed in a topic — from there it is a book like any other, and
// the reader, the pagination, the marks and the prep have nothing new to learn.
// A link that turns out to be a PDF or an EPUB skips all of that: the bytes are
// already a document, so they go straight into the library.
//
// Every side effect is injected. The fetch, the extractor (which needs a DOM and
// a 355 kB chunk) and the two stores are deps, so the whole path runs in a test
// with a fixture page and no network — which is the only way the caps, the
// placeholders and the metadata are pinned at all.

import { contentHash } from "../../platform/app/content-hash";
import type { ImportMeta, LibraryEntry, LibraryKind } from "../../platform/app/library";
import type { ExtractReadable } from "../../info/extract/readable-select";
import { buildArticleEpub, type ArticleImage } from "../epub/build-article";
import { resolveUrlSource, sniffContentType } from "../sources";
import {
  articleFileName,
  collectImageSrcs,
  decodeDataImage,
  pageLanguage,
  readPageMeta,
} from "./page-meta";

/** What a fetch gave back, stripped to what this path reads. */
export interface FetchedBytes {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  contentType: string | null;
}

export interface ArticleIngestDeps {
  fetch(url: string): Promise<FetchedBytes>;
  extractReadable: ExtractReadable;
  importBook(bytes: Uint8Array, originalPath: string, meta?: ImportMeta): Promise<LibraryEntry>;
  /**
   * List the document in a topic under this reference and record its book id.
   * Both halves are idempotent: an article ingested twice is one row.
   */
  attach(topicId: string, path: string, hash: string): Promise<void>;
}

export interface IngestedDocument {
  entry: LibraryEntry;
  /** What the document is called on the shelf: the entry's title, extension off. */
  title: string;
  /** Which route it took: an extracted page, or a document fetched whole. */
  kind: LibraryKind;
  /** The reference the topic lists it under. */
  path: string;
  /** Body characters, for the line the chat says back. */
  chars: number;
  imagesEmbedded: number;
  imagePlaceholders: number;
  /** The topic it was filed under, or null when the caller named none. */
  attachedTo: string | null;
}

// The page itself, matching what prep's own link ingestion allows.
const MAX_PAGE_BYTES = 30 * 1024 * 1024;
// The pictures. Per image and in total, and a count: an article with two hundred
// images is a gallery, and the reader is waiting on this fetch.
const MAX_IMAGES = 30;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 20 * 1024 * 1024;

function charsetOf(contentType: string | null): string {
  const m = /charset\s*=\s*"?([a-z0-9_:.+-]+)"?/i.exec(contentType ?? "");
  return (m?.[1] ?? "utf-8").toLowerCase();
}

// The page as text. A declared charset is honoured — a GB18030 page decoded as
// UTF-8 is a document of replacement characters — and a label no decoder knows
// falls back to UTF-8 rather than failing the ingest.
function decodePage(bytes: Uint8Array, contentType: string | null): string {
  const charset = charsetOf(contentType);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchWithin(
  deps: ArticleIngestDeps,
  url: string,
  limit: number,
): Promise<FetchedBytes> {
  const res = await deps.fetch(url);
  if (res.ok && res.bytes.length > limit) {
    throw new Error(`the source is too large (${Math.round(res.bytes.length / 1e6)}MB)`);
  }
  return res;
}

/**
 * Download the body's pictures, in document order, within the caps. An image
 * that fails, is too big, or falls past a cap is simply left out: the <img> that
 * pointed at it becomes a fixed-height placeholder when the EPUB is built, which
 * keeps the pagination the same on a device that could not reach the CDN.
 *
 * The key of each is the src string exactly as the HTML spells it, because that
 * is what buildArticleEpub matches on.
 */
export async function fetchArticleImages(
  html: string,
  pageUrl: string,
  deps: ArticleIngestDeps,
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
      res = await deps.fetch(url);
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

/**
 * The reference a document is listed under in a topic.
 *
 * FileRef.path is an identifier here rather than somewhere to read: the bytes
 * live in the library under the book id, and that is where every open of an
 * ingested document reads them (session/open-file.ts takes the library route
 * whenever the id is known). What the path has to do is be unique per document
 * and end in the name the reader should see, because the shelf's row title is
 * derived from its basename (shelf/file-title.ts).
 */
export function documentPath(hash: string, fileName: string): string {
  return `library/${hash}/${fileName}`;
}

/**
 * Ingest a pasted URL into a topic's documents.
 *
 * Throws, with a sentence a chat can print, when the link cannot be fetched or
 * holds no readable article: an ingest that produced nothing must not leave a
 * row on the shelf that opens onto an empty page.
 */
export async function ingestArticleUrl(
  url: string,
  topicId: string | null,
  deps: ArticleIngestDeps,
): Promise<IngestedDocument> {
  const source = resolveUrlSource(url);
  const res = await fetchWithin(deps, source.url, MAX_PAGE_BYTES);
  if (!res.ok) throw new Error(`could not fetch the link (HTTP ${res.status})`);

  const sniffed = sniffContentType(res.bytes, res.contentType);
  if (sniffed !== "html") {
    // Already a document. It keeps `kind` absent — it is a book, and a book on
    // the shelf is a cover card — but it still records where it came from.
    return await file(
      deps,
      topicId,
      res.bytes,
      articleFileName("", source.slugBase, sniffed),
      { sourceUrl: source.url },
      { kind: "book", chars: 0, imagesEmbedded: 0, imagePlaceholders: 0 },
    );
  }

  const page = decodePage(res.bytes, res.contentType);
  const extraction = deps.extractReadable(page, source.url);
  if (!extraction || extraction.textContent.trim() === "") {
    throw new Error("no readable article content at the link");
  }
  const meta = readPageMeta(page);
  const title = extraction.title.trim() || source.title;
  const { images, requested } = await fetchArticleImages(
    extraction.contentHtml,
    source.url,
    deps,
  );
  const bytes = await buildArticleEpub({
    title,
    byline: meta.byline,
    sourceUrl: source.url,
    publishedAt: meta.publishedAt,
    html: extraction.contentHtml,
    images,
    language: pageLanguage(page),
  });
  return await file(
    deps,
    topicId,
    bytes,
    articleFileName(title, source.slugBase),
    {
      kind: "article",
      sourceUrl: source.url,
      byline: meta.byline,
      publishedAt: meta.publishedAt,
    },
    {
      kind: "article",
      chars: extraction.textContent.trim().length,
      imagesEmbedded: images.length,
      imagePlaceholders: requested - images.length,
    },
  );
}

// Put the bytes in the library and list them in the topic. Both stores are
// idempotent, so a URL ingested twice produces the entry it produced the first
// time and one row — and a document already in the library that was never in
// this topic is still filed, which is what makes "ingest it again, into this
// book's topic" work.
async function file(
  deps: ArticleIngestDeps,
  topicId: string | null,
  bytes: Uint8Array,
  fileName: string,
  meta: ImportMeta,
  counts: { kind: LibraryKind; chars: number; imagesEmbedded: number; imagePlaceholders: number },
): Promise<IngestedDocument> {
  const path = documentPath(await contentHash(bytes), fileName);
  const entry = await deps.importBook(bytes, path, meta);
  if (topicId) await deps.attach(topicId, path, entry.hash);
  return {
    entry,
    title: fileName.replace(/\.[^.]+$/, ""),
    kind: counts.kind,
    path,
    chars: counts.chars,
    imagesEmbedded: counts.imagesEmbedded,
    imagePlaceholders: counts.imagePlaceholders,
    attachedTo: topicId ?? null,
  };
}
