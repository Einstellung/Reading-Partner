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
// Two passes. The first reads a sample of the document and settles the
// vocabulary (glossary.ts); the second translates the blocks in batches that
// all carry that one list and nothing from each other. That is the whole reason
// for the split: batches that share nothing can run at the same time, and a
// reader waiting on an article waits for the longest batch rather than for the
// sum of them, while the terms still match across the page.
//
// At the same time, not all at once. The calls go through the shared limiter
// (src/legion/execute/limiter), which owns the ceiling, the stagger between
// starts and what the whole group does when a provider answers 429 — the same
// device the chapter pipeline paces itself with, for the same reason: a rate
// limit is the group being told to slow down, not one unlucky call.
//
// The model is injected. Nothing here knows which provider is in use or how a
// call is made, so the whole path — the glossary, the batching, the checks, the
// packing — runs in the test suite against a fake.
//
// The run is all or nothing. A call that comes back the wrong shape is sent once
// more and then the run fails, abandoning whatever is still in flight: half a
// translated article is a book whose second half silently stops being bilingual,
// and nobody would know which half.

import { CallLimiter, isRateLimited, type LimiterConfig, type LimiterTimers } from "../../legion/execute/limiter";
import { StoppedError } from "../../legion/stop";
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
import { glossaryRequestFor } from "./glossary";
import {
  BatchShapeError,
  type GlossaryEntry,
  type GlossaryFn,
  type TranslateBatchFn,
  type TranslateBatchRequest,
  type TranslateBatchResponse,
} from "./prompt";
import { hasTranslations, segmentDocument, ZH_CLASS } from "./segment";

/** How many batches of one article are in flight at once. */
export const TRANSLATE_CONCURRENCY = 4;

export class TranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslateError";
  }
}

export interface TranslateDeps {
  /** The pass that settles the vocabulary, before any block is translated. */
  buildGlossary: GlossaryFn;
  translateBatch: TranslateBatchFn;
  /** Called as each batch finishes, in completion order, not document order. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Batch sizing, for the tests; the run uses the defaults. */
  limits?: BatchLimits;
  /** Batches in flight at once. Defaults to TRANSLATE_CONCURRENCY. */
  concurrency?: number;
  /** The rest of the limiter's settings, and its clock. Both for the tests. */
  limiter?: Partial<LimiterConfig>;
  timers?: LimiterTimers;
}

export interface TranslatedArticle {
  bytes: Uint8Array;
  /** How many blocks were given a translation. */
  blocks: number;
  /** The vocabulary the run fixed, as every batch was given it. */
  glossary: GlossaryEntry[];
}

const REAL_TIMERS: LimiterTimers = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

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
 * One call, sent once and — when the answer does not line up, or the provider
 * pushed back on volume — once more. Two failures are worth a second attempt
 * and no more: a mis-shaped answer is a sampling accident that a differently
 * worded request would not fix, and a 429 is answered by the limiter's pause
 * rather than by trying harder. Anything else fails on the spot.
 */
async function once<T>(
  limiter: CallLimiter,
  call: (signal?: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return limiter.run(async () => {
    try {
      return await call(signal);
    } catch (err) {
      limiter.noteFailure(err);
      if (err instanceof StoppedError) throw err;
      if (!(err instanceof BatchShapeError) && !isRateLimited(err)) throw err;
      await limiter.hold(signal);
      return await call(signal);
    }
  }, signal);
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

  const limiter = new CallLimiter(
    { limit: deps.concurrency ?? TRANSLATE_CONCURRENCY, ...deps.limiter },
    deps.timers ?? REAL_TIMERS,
  );
  // The run's own stop, so the first terminal failure takes the calls that are
  // still waiting for a slot down with it instead of paying for a book that is
  // already not going to be written. A user Stop reaches it the same way.
  const stop = new AbortController();
  const onOuterAbort = (): void => stop.abort();
  deps.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    deps.signal?.throwIfAborted();

    // Pass one. It fails the run rather than being skipped: if the model cannot
    // answer the smallest call of the run, the dozen larger ones are not going
    // to go better, and failing here costs one call instead of twelve.
    let glossary: GlossaryEntry[] = [];
    try {
      const request = glossaryRequestFor(meta.title, blocks);
      glossary = [...(await once(limiter, (signal) => deps.buildGlossary(request, signal), stop.signal))];
    } catch (err) {
      if (err instanceof StoppedError) throw err;
      throw new TranslateError(`the glossary could not be settled: ${String(err)}`);
    }

    // Pass two. Every batch is handed the same list and knows nothing of the
    // others, so they are started together and answered in whatever order they
    // are answered in.
    const batches = planBatches(blocks, deps.limits);
    const translations = new Map<string, string>();
    let failure: unknown = null;
    let done = 0;

    const runOne = async (batch: typeof blocks): Promise<void> => {
      const request: TranslateBatchRequest = {
        title: meta.title,
        glossary,
        blocks: batch.map((b) => ({ id: b.id, text: b.text })),
      };
      const response: TranslateBatchResponse = await once(
        limiter,
        (signal) => deps.translateBatch(request, signal),
        stop.signal,
      );
      const answers = new Map(response.blocks.map((row) => [row.id, row.text]));
      for (const block of batch) {
        const text = answers.get(block.id);
        if (text !== undefined) translations.set(block.id, text);
      }
      done += batch.length;
      deps.onProgress?.(done, blocks.length);
    };

    await Promise.all(
      batches.map((batch) =>
        runOne(batch).catch((err: unknown) => {
          if (failure === null) {
            failure = err;
            // Whatever is still queued gives up now; whatever is in flight is
            // awaited and its answer discarded.
            stop.abort();
          }
        }),
      ),
    );
    if (failure !== null) {
      if (deps.signal?.aborted || failure instanceof StoppedError) throw failure;
      throw new TranslateError(`a batch could not be translated: ${String(failure)}`);
    }

    // Completion order is not document order, and the document does not care:
    // the translations are written back by walking the blocks.
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
  } finally {
    deps.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** The class a translated block carries, re-exported for the wiring. */
export { ZH_CLASS };
