// Translating an article on the shelf: an EPUB in, a bilingual EPUB out.
//
// The output is a whole book, not a patch. It carries the original's header,
// its pictures and its outline, it is packed by the same rules as the original
// (build-article.ts: packArticleEpub), and every one of its pages is therefore
// laid out the same way on every device (docs/64). What it does not carry is
// the original's identity: the bytes are different, so it is a different file
// on the shelf, and it replaces the original in the topic rather than editing
// it (docs/60's rule about a new version).
//
// The model is injected. Nothing here knows which provider is in use or how a
// call is made, so the whole path — segmentation, batching, the glossary, the
// checks, the packing — runs in the test suite against a fake.
//
// The run is all or nothing. A batch that comes back the wrong shape is sent
// once more and then the run fails: half a translated article is a book whose
// second half silently stops being bilingual, and nobody would know which half.

import {
  ARTICLE_ENTRY,
  collectHeadings,
  IMAGE_DIR,
  packArticleEpub,
  type ArticleMetadata,
  type Heading,
} from "../epub/build-article";
import { parseEpub, type EpubBook } from "../epub/parse";
import { sanitizeDocument } from "../epub/sanitize";
import { applyTranslations } from "./apply";
import { planBatches, type BatchLimits } from "./batch";
import {
  BatchShapeError,
  type GlossaryEntry,
  type TranslateBatchFn,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
} from "./prompt";
import { hasTranslations, segmentDocument, ZH_CLASS } from "./segment";

export class TranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslateError";
  }
}

export interface TranslateDeps {
  translateBatch: TranslateBatchFn;
  /** Called after every batch with how many blocks are done out of how many. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Batch sizing, for the tests; the run uses the defaults. */
  limits?: BatchLimits;
}

export interface TranslatedArticle {
  bytes: Uint8Array;
  /** How many blocks were given a translation. */
  blocks: number;
  /** Every term the run settled, in the order they were settled. */
  glossary: GlossaryEntry[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The article's pictures, by the entry name the document points at. */
function readImages(book: EpubBook): {
  images: Map<string, Uint8Array>;
  imageTypes: Map<string, string>;
} {
  const images = new Map<string, Uint8Array>();
  const imageTypes = new Map<string, string>();
  const typeByEntry = new Map<string, string>();
  for (const item of book.pkg.manifest.values()) typeByEntry.set(item.entry, item.mediaType);
  for (const entry of book.zip.entries) {
    if (!entry.name.startsWith(`${IMAGE_DIR}/`)) continue;
    const bytes = book.zip.bytes(entry.name);
    const mediaType = typeByEntry.get(entry.name);
    if (!bytes || !mediaType) continue;
    images.set(entry.name, bytes);
    imageTypes.set(entry.name, mediaType);
  }
  return { images, imageTypes };
}

function metadataOf(book: EpubBook): ArticleMetadata {
  return {
    title: book.pkg.title ?? "Untitled",
    byline: book.pkg.creator ?? undefined,
    sourceUrl: book.pkg.source ?? "",
    publishedAt: book.pkg.date ?? undefined,
    language: book.pkg.language ?? undefined,
  };
}

/**
 * One batch, sent once and — when the answer does not line up with what was
 * sent — once more. The retry is a fresh call with the same request: the shapes
 * that fail here are a dropped block or a renamed id, and those are a sampling
 * accident rather than something a differently worded request would fix.
 */
async function runBatch(
  deps: TranslateDeps,
  request: TranslateBatchRequest,
): Promise<TranslateBatchResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await deps.translateBatch(request, deps.signal);
    } catch (err) {
      lastError = err;
      // Only a mis-shaped answer is worth a second call. A cancelled run, a
      // provider that refused, a network that is gone: sending it again is the
      // same failure twice.
      if (!(err instanceof BatchShapeError)) break;
    }
  }
  throw new TranslateError(`a batch could not be translated: ${String(lastError)}`);
}

/** The pictures, the header, the outline and the CSS of the original, translated. */
export async function translateArticleEpub(
  epubBytes: Uint8Array,
  deps: TranslateDeps,
): Promise<TranslatedArticle> {
  if (typeof DOMParser === "undefined") {
    throw new TranslateError("no DOMParser: an article cannot be translated unsanitized");
  }
  const book = parseEpub(epubBytes);
  if (book.docs.length !== 1 || book.docs[0].entry !== ARTICLE_ENTRY) {
    throw new TranslateError("only an article EPUB can be translated in the app");
  }
  const spine = book.docs[0];

  // The sanitized markup, read back as HTML. Parsing rather than reusing
  // spine.doc because what goes into the archive is written from an HTML
  // serialization (build-article.ts does the same), and the sanitizer is the
  // one that turns it back into well-formed XML.
  const parsed = new DOMParser().parseFromString(spine.html, "text/html");
  const body = parsed.body;
  const head = parsed.head;
  if (!body) throw new TranslateError("the article's spine document parsed to no body");
  if (hasTranslations(body)) {
    throw new TranslateError("this article is already bilingual");
  }

  // The outline is the original's. Collected before anything is inserted, so a
  // translated heading is never a nav entry.
  const headings: Heading[] = collectHeadings(body);
  const meta = metadataOf(book);
  const language = (meta.language ?? "en").trim() || "en";

  const blocks = segmentDocument(body);
  if (blocks.length === 0) throw new TranslateError("the article has nothing to translate");

  const batches = planBatches(blocks, deps.limits);
  const glossary: GlossaryEntry[] = [];
  const seenTerms = new Set<string>();
  const translations = new Map<string, string>();
  let done = 0;

  // The glossary grows as the batches settle it, and a batch is told what was
  // decided before it and nothing after: that is what makes the run's output a
  // function of the order the article is read in rather than of the schedule.
  const rememberTerms = (terms: readonly GlossaryEntry[]): void => {
    for (const term of terms) {
      const key = term.source.toLowerCase();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      glossary.push(term);
    }
  };

  for (const batch of batches) {
    deps.signal?.throwIfAborted();
    const response = await runBatch(deps, {
      title: meta.title,
      glossary: [...glossary],
      blocks: batch.map((b) => ({ id: b.id, text: b.text })),
    });
    const answers = new Map(response.blocks.map((row) => [row.id, row.text]));
    for (const block of batch) {
      const text = answers.get(block.id);
      if (text !== undefined) translations.set(block.id, text);
    }
    rememberTerms(response.terms);
    done += batch.length;
    deps.onProgress?.(done, blocks.length);
  }

  const written = applyTranslations(body, blocks, translations);

  const source = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
<head>${head ? head.innerHTML : ""}</head>
<body>${body.innerHTML}</body>
</html>`;
  const sanitized = sanitizeDocument(source, ARTICLE_ENTRY, (entry) => book.zip.has(entry));
  if (!sanitized) throw new TranslateError("the translated markup could not be sanitized");

  const { images, imageTypes } = readImages(book);
  const bytes = await packArticleEpub({
    meta,
    articleHtml: sanitized.html,
    headings,
    images,
    imageTypes,
  });
  return { bytes, blocks: written, glossary };
}

/** The class a translated block carries, re-exported for the wiring. */
export { ZH_CLASS };
