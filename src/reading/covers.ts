// Library cover thumbnails: page one of a book, rastered once and kept under
// AppData/covers so the shelf — the first screen after launch — does not
// re-render every PDF on every cold start.
//
// Rendering reuses the app's one PDFium engine (engine/engine-singleton): a
// cover opens a document on it, renders page one and closes it again. No reader
// instance and no second wasm compile.
//
// Covers are content-addressed under the book id (see cover-cache.ts), so a
// file replaced at the same path renders a new cover instead of showing the old
// one forever. A topic file that has never been opened carries no book id yet;
// its bytes are read and hashed here, which costs one read but keeps every
// stored cover keyed by what it is a picture of.
//
// The result is a data: URL rather than an object URL: the signature hands back
// a bare string with nowhere to revoke it, and an unrevoked blob URL lives as
// long as the document does.

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import type { PdfDocumentObject, PdfEngine, PdfRenderPageOptions } from "@embedpdf/models";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { contentHash, libraryHas, readLibraryBook } from "../platform/app/library";
import type { FileRef } from "../platform/app/topics";
import {
  COVER_JPEG_QUALITY,
  coverFailurePath,
  coverImagePath,
  coverRequestKey,
  coverRetryDue,
  coverScaleFactor,
  createSingleFlight,
  parseCoverFailure,
  unreadableKey,
  type CoverFailure,
  type CoverFailureReason,
} from "./cover-cache";
import { getPdfiumEngine } from "./engine/engine-singleton";

const COVERS_DIR = "covers";
const MIME = "image/jpeg";
const APPDATA = { baseDir: BaseDirectory.AppData } as const;

// The direct engine has hung on a document before (pitfall 21); a hang here
// would leave a card waiting forever. A timeout is treated as transient: it is
// logged and gives up for this session, but writes no failure marker.
const OPEN_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 20_000;

const flight = createSingleFlight<string | null>();

/**
 * A cover for a shelf entry, as a URL for an `<img src>`, or null when there is
 * none (not rendered yet and unrenderable, file gone, engine unavailable).
 * Concurrent calls for the same file share one render, and a resolved cover is
 * kept for the session.
 */
export function coverUrl(file: FileRef): Promise<string | null> {
  return flight.run(coverRequestKey(file), () => produce(file));
}

async function produce(file: FileRef): Promise<string | null> {
  // The fast path a cold start takes: the book id is known, the cover is on
  // disk under it, and the PDF itself is never touched.
  if (file.hash) {
    const cached = await readCover(file.hash);
    if (cached) return cached;
    if (await givenUp(file.hash)) return null;
  }
  if (await givenUp(unreadableKey(file.path))) return null;

  let bytes: Uint8Array;
  try {
    bytes =
      file.hash && (await libraryHas(file.hash))
        ? await readLibraryBook(file.hash)
        : await readFile(file.path);
  } catch (e) {
    await recordFailure(unreadableKey(file.path), file, "unreadable", e);
    return null;
  }

  const bookId = file.hash ?? (await contentHash(bytes));
  if (!file.hash) {
    // The id was only learned by reading the file, so the on-disk cache has not
    // been consulted under it yet — an earlier session may have rendered this
    // very content already.
    const cached = await readCover(bookId);
    if (cached) return cached;
    if (await givenUp(bookId)) return null;
  }

  const jpeg = await renderCover(bytes, bookId, file);
  if (!jpeg) return null;
  await writeCover(bookId, jpeg);
  return dataUrl(jpeg);
}

// --- rendering -------------------------------------------------------------

async function renderCover(
  bytes: Uint8Array,
  bookId: string,
  file: FileRef,
): Promise<Uint8Array | null> {
  let engine: PdfEngine<Blob>;
  try {
    engine = await getPdfiumEngine();
  } catch (e) {
    // The whole reader is down, not this book: no marker, so covers come back
    // with the engine on the next launch.
    console.warn("no PDFium engine for covers", e);
    return null;
  }

  // A fresh copy: the engine takes ownership of the buffer it is handed.
  const content = bytes.slice().buffer as ArrayBuffer;
  const opening = engine.openDocumentBuffer({ id: `cover:${bookId}`, content }).toPromise();
  let doc: PdfDocumentObject;
  try {
    doc = await withTimeout(opening, OPEN_TIMEOUT_MS, "openDocumentBuffer");
  } catch (e) {
    if (e instanceof CoverTimeout) {
      // The open may still land after the deadline; close it when it does,
      // rather than leaving a document behind on the engine the reader shares.
      void opening.then((late) => engine.closeDocument(late).toPromise()).catch(() => {});
      return transient(file, e);
    }
    await recordFailure(bookId, file, "open", e);
    return null;
  }

  try {
    const page = doc.pages[0];
    if (!page) {
      // A document that failed to parse can still open (pitfall 58), and what
      // it opens as is a document with nothing in it.
      await recordFailure(bookId, file, "no-pages", new Error("document opened with no pages"));
      return null;
    }
    const blob = await withTimeout(
      engine.renderPage(doc, page, renderOptions(page.size.width)).toPromise(),
      RENDER_TIMEOUT_MS,
      "renderPage",
    );
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    if (e instanceof CoverTimeout) return transient(file, e);
    await recordFailure(bookId, file, "render", e);
    return null;
  } finally {
    engine
      .closeDocument(doc)
      .toPromise()
      .catch(() => {});
  }
}

// The quality is passed under both names on purpose: the encoder reads
// `quality` while the documented option is `imageQuality`, so the documented
// one alone leaves the cover at the canvas default and half again as large
// (pitfall 102). Both survive that being fixed upstream.
function renderOptions(pageWidthPt: number): PdfRenderPageOptions {
  return {
    scaleFactor: coverScaleFactor(pageWidthPt),
    dpr: 1,
    imageType: MIME,
    imageQuality: COVER_JPEG_QUALITY,
    quality: COVER_JPEG_QUALITY,
  } as PdfRenderPageOptions;
}

class CoverTimeout extends Error {}

function withTimeout<T>(task: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const alarm = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CoverTimeout(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([task, alarm]).finally(() => clearTimeout(timer));
}

function transient(file: FileRef, e: CoverTimeout): null {
  console.warn(`cover render gave up on ${file.name}`, file.path, e.message);
  return null;
}

// --- cache ------------------------------------------------------------------

async function readCover(bookId: string): Promise<string | null> {
  const path = coverImagePath(bookId);
  try {
    if (!(await exists(path, APPDATA))) return null;
    return dataUrl(await readFile(path, APPDATA));
  } catch (e) {
    console.warn("failed to read cached cover", path, e);
    return null;
  }
}

async function writeCover(bookId: string, jpeg: Uint8Array): Promise<void> {
  try {
    if (!(await exists(COVERS_DIR, APPDATA))) {
      await mkdir(COVERS_DIR, { ...APPDATA, recursive: true });
    }
    await writeFile(coverImagePath(bookId), jpeg, APPDATA);
  } catch (e) {
    // The cover is already rendered and is returned either way; only the next
    // cold start pays for this.
    console.warn("failed to persist cover", bookId, e);
  }
}

function dataUrl(jpeg: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < jpeg.length; i += 0x8000) {
    binary += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
  }
  return `data:${MIME};base64,${btoa(binary)}`;
}

// --- failures ---------------------------------------------------------------

async function readFailure(key: string): Promise<CoverFailure | null> {
  const path = coverFailurePath(key);
  try {
    if (!(await exists(path, APPDATA))) return null;
    return parseCoverFailure(JSON.parse(await readTextFile(path, APPDATA)));
  } catch (e) {
    console.warn("failed to read cover failure marker", path, e);
    return null;
  }
}

// Whether a key has a failure recent enough to skip. Says so out loud once per
// session (produce runs once per key), so a missing cover is never just a blank
// square with no explanation anywhere.
async function givenUp(key: string): Promise<boolean> {
  const failure = await readFailure(key);
  if (coverRetryDue(failure, Date.now())) return false;
  console.warn(
    `no cover for ${failure!.name || failure!.path}: ${failure!.reason} — ${failure!.message}`,
  );
  return true;
}

async function recordFailure(
  key: string,
  file: FileRef,
  reason: CoverFailureReason,
  cause: unknown,
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.warn(`cover failed for ${file.name} (${reason})`, file.path, cause);
  const failure: CoverFailure = {
    reason,
    message,
    path: file.path,
    name: file.name,
    at: Date.now(),
  };
  try {
    await writeTextAtomic(coverFailurePath(key), JSON.stringify(failure, null, 2));
  } catch (e) {
    console.warn("failed to record a cover failure", key, e);
  }
}
