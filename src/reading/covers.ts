// Library cover thumbnails: page one of a book, rastered once and kept under
// AppData/covers so the shelf — the first screen after launch — does not
// re-render every PDF on every cold start.
//
// Rendering goes through engine/raster, which opens a document on the app's one
// PDFium engine, renders page one and closes it again. No reader instance and no
// second wasm compile. What is kept, and what a failure costs the next launch,
// is decided here.
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
  exists,
  mkdir,
  readFile,
  readTextFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { APPDATA, writeTextAtomic } from "../platform/app/atomic-fs";
import { contentHash } from "../platform/app/content-hash";
import { libraryHas, readLibraryBook } from "../platform/app/library";
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
import { renderFirstPageJpeg } from "./engine/raster";

const COVERS_DIR = "covers";
const MIME = "image/jpeg";

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
  const result = await renderFirstPageJpeg(bytes, {
    id: `cover:${bookId}`,
    scaleFactor: coverScaleFactor,
    quality: COVER_JPEG_QUALITY,
  });
  switch (result.kind) {
    case "ok":
      return result.jpeg;
    case "no-engine":
      // The whole reader is down, not this book: no marker, so covers come back
      // with the engine on the next launch.
      console.warn("no PDFium engine for covers", result.cause);
      return null;
    case "timeout":
      // Transient: said out loud and given up on for this session, but not
      // written down, so a slow engine does not cost the book its cover for a
      // day.
      console.warn(`cover render gave up on ${file.name}`, file.path, result.message);
      return null;
    case "open-failed":
      await recordFailure(bookId, file, "open", result.cause);
      return null;
    case "no-pages":
      await recordFailure(bookId, file, "no-pages", result.cause);
      return null;
    case "render-failed":
      await recordFailure(bookId, file, "render", result.cause);
      return null;
  }
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
