// Taking a URL the reader pasted and making a document out of it (docs/67).
//
// One URL produces one document. A web page is fetched and handed to the
// bindery (workshop/bindery, docs/85), which cuts out its body, downloads its
// pictures and builds an EPUB — or turns the page back when there is nothing to
// read in it, and then nothing is filed. From the library on it is a book like
// any other, and the reader, the pagination, the marks and the prep have
// nothing new to learn. A link that turns out to be a PDF or an EPUB skips all
// of that: the bytes are already a document, so they go straight into the
// library. A link a site adapter claims is the bindery's to read: an arXiv
// abstract or PDF link comes back as the paper's PDF with its real title.
//
// Where it is then listed is the target's: a book's supplements, or a topic's
// documents. The bytes and everything derived from them are the same either way.
//
// Every side effect is injected. The fetch, the extractor (which needs a DOM and
// a 355 kB chunk) and the two stores are deps, so the whole path runs in a test
// with a fixture page and no network — which is the only way the caps, the
// placeholders and the metadata are pinned at all.

import { contentHash } from "../../platform/app/content-hash";
import {
  documentPath,
  type ImportMeta,
  type LibraryEntry,
  type LibraryKind,
} from "../../platform/app/library";
import type { ExtractReadable } from "../../workshop/extract/readable-select";
import { t } from "../../i18n";
import {
  bind,
  siteAdapterFor,
  type BindResult,
  type Bound,
  type FetchedBytes,
} from "../../workshop/bindery";
import { articleFileName } from "../../workshop/bindery/page-meta";
import { decodePage, resolveUrlSource, sniffContentType } from "../sources";

export type { FetchedBytes };
export { documentPath };

/**
 * Where an ingested document is filed (docs/67 「辅助资料」).
 *
 * A book: the URL was pasted while reading it, and what comes out is that book's
 * supplement — under its outline, not on the shelf. A topic: the row lands on the
 * shelf beside the books. The topic route is what the share sheet and a topic-root
 * chat will take; today every caller names a book.
 */
export type IngestTarget =
  | { kind: "topic"; topicId: string | null }
  | { kind: "book"; bookId: string };

/** What a book's supplement list is told about a document just taken in. */
export interface SupplementAttachment {
  hash: string;
  title: string;
  sourceUrl?: string;
}

export interface ArticleIngestDeps {
  fetch(url: string): Promise<FetchedBytes>;
  extractReadable: ExtractReadable;
  importBook(bytes: Uint8Array, originalPath: string, meta?: ImportMeta): Promise<LibraryEntry>;
  /**
   * List the document in a topic under this reference and record its book id.
   * Both halves are idempotent: an article ingested twice is one row.
   */
  attachToTopic(topicId: string, path: string, hash: string): Promise<unknown>;
  /**
   * List the document among a book's supplements. Idempotent by hash: the same
   * URL ingested twice is the same bytes, so it is the same one entry.
   */
  attachToBook(bookId: string, ref: SupplementAttachment): Promise<void>;
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
  /** Sections of a document the bindery built; absent for a document fetched whole. */
  sections?: number;
  /** Where it was filed, or null when the caller named a topic and had none. */
  attachedTo: IngestTarget | null;
}

// The page itself, matching what prep's own link ingestion allows.
const MAX_PAGE_BYTES = 30 * 1024 * 1024;

async function fetchWithin(
  deps: ArticleIngestDeps,
  url: string,
  limit: number,
): Promise<FetchedBytes> {
  const res = await deps.fetch(url);
  if (res.ok && res.bytes.length > limit) {
    throw new Error(t("reader.ingest.sourceTooLarge", { mb: Math.round(res.bytes.length / 1e6) }));
  }
  return res;
}

/**
 * Ingest a pasted URL: into a book's supplements, or into a topic's documents.
 *
 * Throws, with a sentence a chat can print, when the link cannot be fetched or
 * holds no readable article: an ingest that produced nothing must not leave a
 * row on the shelf that opens onto an empty page.
 */
export async function ingestArticleUrl(
  url: string,
  target: IngestTarget,
  deps: ArticleIngestDeps,
): Promise<IngestedDocument> {
  const source = resolveUrlSource(url);
  const binderyDeps = { fetch: deps.fetch, extractReadable: deps.extractReadable };

  // A site the bindery has an adapter for is read by that adapter, which knows
  // how to fetch it; a plain fetch of such a page is what returns a shell.
  const bare = { kind: "url", url: source.url } as const;
  if (siteAdapterFor(bare)) {
    return await fileBound(deps, target, url, source.slugBase, await bind(bare, binderyDeps));
  }

  const res = await fetchWithin(deps, source.url, MAX_PAGE_BYTES);
  if (!res.ok) throw new Error(t("reader.ingest.fetchFailed", { status: res.status }));

  const sniffed = sniffContentType(res.bytes, res.contentType);
  if (sniffed !== "html") {
    // Already a document. It keeps `kind` absent — it is a book, and a book on
    // the shelf is a cover card — but it still records where it came from.
    return await file(
      deps,
      target,
      res.bytes,
      articleFileName("", source.slugBase, sniffed),
      { sourceUrl: source.url },
      { kind: "book", chars: 0, imagesEmbedded: 0, imagePlaceholders: 0 },
    );
  }

  const page = decodePage(res.bytes, res.contentType);
  const bound = await bind(
    { kind: "web", url: source.url, html: page, fallbackTitle: source.title },
    binderyDeps,
  );
  return await fileBound(deps, target, url, source.slugBase, bound);
}

/**
 * File what the bindery built, or say why there is nothing to file. A rejection
 * names the link as the model passed it, so the sentence it reads back is about
 * the link it knows.
 */
export async function fileBound(
  deps: FilingDeps,
  target: IngestTarget,
  url: string,
  slugBase: string,
  bound: BindResult,
): Promise<IngestedDocument> {
  if (!bound.ok) throw new Error(t("reader.ingest.unreadable", { url, reason: bound.message }));
  if ("passedThrough" in bound) {
    // A document the site serves whole (an arXiv paper's PDF): a book, as a PDF
    // link is, but named by the title the adapter read rather than the URL.
    const meta = bound.metadata;
    return await file(
      deps,
      target,
      bound.bytes,
      articleFileName(meta.title, slugBase, bound.format),
      {
        ...(meta.sourceUrl === undefined ? {} : { sourceUrl: meta.sourceUrl }),
        ...(meta.author === undefined ? {} : { byline: meta.author }),
        ...(meta.publishedAt === undefined ? {} : { publishedAt: meta.publishedAt }),
      },
      { kind: "book", chars: 0, imagesEmbedded: 0, imagePlaceholders: 0 },
    );
  }
  return fileBuilt(deps, target, bound, slugBase);
}

/** The stores filing a built document writes to. */
export type FilingDeps = Pick<ArticleIngestDeps, "importBook" | "attachToTopic" | "attachToBook">;

/**
 * Put an EPUB the bindery built into the library as an article and list it where
 * the target says. For a caller that bound the material itself — a kept briefing
 * article, whose body is already in hand (keep.ts). `slugBase` names the file
 * when the manuscript had no title.
 */
export async function fileBuilt(
  deps: FilingDeps,
  target: IngestTarget,
  bound: Bound,
  slugBase: string,
): Promise<IngestedDocument> {
  const meta = bound.metadata;
  return await file(
    deps,
    target,
    bound.epub,
    articleFileName(meta.title, slugBase),
    {
      kind: "article",
      ...(meta.sourceUrl === undefined ? {} : { sourceUrl: meta.sourceUrl }),
      byline: meta.author,
      publishedAt: meta.publishedAt,
    },
    {
      kind: "article",
      chars: meta.chars,
      imagesEmbedded: meta.imagesEmbedded,
      imagePlaceholders: meta.imagesMissing,
      sections: meta.sections,
    },
  );
}

// Put the bytes in the library and list them where the target says. Both stores
// are idempotent, so a URL ingested twice produces the entry it produced the
// first time and one row — and a document already in the library that was never
// listed here is still filed, which is what makes "ingest it again, for this
// book" work.
async function file(
  deps: FilingDeps,
  target: IngestTarget,
  bytes: Uint8Array,
  fileName: string,
  meta: ImportMeta,
  counts: { kind: LibraryKind; chars: number; imagesEmbedded: number; imagePlaceholders: number; sections?: number },
): Promise<IngestedDocument> {
  const path = documentPath(await contentHash(bytes), fileName);
  const entry = await deps.importBook(bytes, path, meta);
  const title = fileName.replace(/\.[^.]+$/, "");
  if (target.kind === "book") {
    await deps.attachToBook(target.bookId, {
      hash: entry.hash,
      title,
      ...(meta.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
    });
  } else if (target.topicId) {
    await deps.attachToTopic(target.topicId, path, entry.hash);
  }
  return {
    entry,
    title,
    kind: counts.kind,
    path,
    chars: counts.chars,
    imagesEmbedded: counts.imagesEmbedded,
    imagePlaceholders: counts.imagePlaceholders,
    ...(counts.sections === undefined ? {} : { sections: counts.sections }),
    attachedTo: target.kind === "topic" && target.topicId === null ? null : target,
  };
}
