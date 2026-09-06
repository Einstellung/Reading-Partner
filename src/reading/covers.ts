// Library cover thumbnails: page one of a book, rastered once and kept under
// AppData/covers so the shelf — the first screen after launch — does not
// re-render every PDF on every cold start. The same open also reads the
// document's Author, which is the line under the title on a card.
//
// Rendering goes through engine/raster, which opens a document on the app's one
// PDFium engine, renders page one, reads its metadata and closes it again. No
// reader instance and no second wasm compile. What is kept, and what a failure
// costs the next launch, is decided here.
//
// Two renders at a time (cover-cache.ts): the raster runs on the thread the app
// draws on, and a topic of thirty books asks for thirty covers in one tick.
//
// Covers are content-addressed under the book id (see cover-cache.ts), so a
// file replaced at the same path renders a new cover instead of showing the old
// one forever. A topic file that has never been opened carries no book id yet;
// its bytes are read and hashed here, which costs one read but keeps every
// stored cover keyed by what it is a picture of.
//
// The image comes back as a data: URL rather than an object URL: the signature
// hands back a bare string with nowhere to revoke it, and an unrevoked blob URL
// lives as long as the document does.

import { appData } from "../platform/app/appdata";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { contentHash } from "../platform/app/content-hash";
import { libraryHas, readLibraryBook } from "../platform/app/library";
import type { FileRef } from "../platform/app/topics";
import {
  cleanAuthor,
  COVER_JPEG_QUALITY,
  COVER_RENDER_LIMIT,
  coverFailurePath,
  coverImagePath,
  coverMetaPath,
  coverRequestKey,
  coverRetryDue,
  coverScaleFactor,
  createGate,
  createSingleFlight,
  parseCoverFailure,
  parseCoverMeta,
  unreadableKey,
  type CoverFailure,
  type CoverFailureReason,
  type CoverMeta,
} from "./cover-cache";
import { renderFirstPageJpeg } from "./engine/raster";

const COVERS_DIR = "covers";
const MIME = "image/jpeg";

/** What a card shows for a book: the picture, and the name under the title. */
export interface BookCover {
  // A data: URL for an `<img src>`, or null when there is none (not rendered
  // yet and unrenderable, file gone, engine unavailable).
  url: string | null;
  // The document's Author field, cleaned; null when it has none, which is what
  // omits the line.
  author: string | null;
}

const NONE: BookCover = { url: null, author: null };

const flight = createSingleFlight<BookCover>();
const renders = createGate(COVER_RENDER_LIMIT);

/**
 * The cover and author for a shelf entry. Concurrent calls for the same file
 * share one render, and a resolved cover is kept for the session.
 */
export function bookCover(file: FileRef): Promise<BookCover> {
  return flight.run(coverRequestKey(file), () => produce(file));
}

async function produce(file: FileRef): Promise<BookCover> {
  // The fast path a cold start takes: the book id is known, the cover and its
  // record are on disk under it, and the PDF itself is never touched.
  if (file.hash) {
    const cached = await readCached(file.hash);
    if (cached) return cached;
    if (await givenUp(file.hash)) return NONE;
  }
  if (await givenUp(unreadableKey(file.path))) return NONE;

  let bytes: Uint8Array;
  try {
    // The one read here that is not AppData-relative: a file the reader picked,
    // still at wherever they keep it, because this book has never been imported.
    bytes =
      file.hash && (await libraryHas(file.hash))
        ? await readLibraryBook(file.hash)
        : await appData.readPicked(file.path);
  } catch (e) {
    await recordFailure(unreadableKey(file.path), file, "unreadable", e);
    return NONE;
  }

  const bookId = file.hash ?? (await contentHash(bytes));
  if (!file.hash) {
    // The id was only learned by reading the file, so the on-disk cache has not
    // been consulted under it yet — an earlier session may have rendered this
    // very content already.
    const cached = await readCached(bookId);
    if (cached) return cached;
    if (await givenUp(bookId)) return NONE;
  }

  const rendered = await renders.run(() => renderCover(bytes, bookId, file));
  if (!rendered) {
    // A cover rendered before this file kept an author record is on disk with
    // nothing beside it. If the render that would have written one just failed,
    // the picture is still a picture: show it, with no name under it.
    const stale = await readCoverImage(bookId);
    return stale ? { url: stale, author: null } : NONE;
  }
  await writeCover(bookId, rendered.jpeg, rendered.author);
  return { url: dataUrl(rendered.jpeg), author: rendered.author || null };
}

// --- rendering -------------------------------------------------------------

async function renderCover(
  bytes: Uint8Array,
  bookId: string,
  file: FileRef,
): Promise<{ jpeg: Uint8Array; author: string } | null> {
  const result = await renderFirstPageJpeg(bytes, {
    id: `cover:${bookId}`,
    scaleFactor: coverScaleFactor,
    quality: COVER_JPEG_QUALITY,
  });
  switch (result.kind) {
    case "ok":
      return { jpeg: result.jpeg, author: cleanAuthor(result.metadata?.author) };
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

// A book is only answered from disk when both files are there. A cover written
// before the author record existed reads as a miss and is rendered once more,
// which is what writes the record; the alternative is a second open of every
// book on the shelf to fill records in.
async function readCached(bookId: string): Promise<BookCover | null> {
  const url = await readCoverImage(bookId);
  if (!url) return null;
  const meta = await readMeta(bookId);
  if (!meta) return null;
  return { url, author: meta.author || null };
}

async function readCoverImage(bookId: string): Promise<string | null> {
  const path = coverImagePath(bookId);
  try {
    if (!(await appData.exists(path))) return null;
    return dataUrl(await appData.readBytes(path));
  } catch (e) {
    console.warn("failed to read cached cover", path, e);
    return null;
  }
}

async function readMeta(bookId: string): Promise<CoverMeta | null> {
  const path = coverMetaPath(bookId);
  try {
    if (!(await appData.exists(path))) return null;
    return parseCoverMeta(JSON.parse(await appData.readText(path)));
  } catch (e) {
    console.warn("failed to read a cover record", path, e);
    return null;
  }
}

// The record is written even for a document with no author: what stops the next
// launch re-rendering the book is the file being there, not what is in it.
async function writeCover(bookId: string, jpeg: Uint8Array, author: string): Promise<void> {
  try {
    if (!(await appData.exists(COVERS_DIR))) {
      await appData.mkdirp(COVERS_DIR);
    }
    await appData.writeBytes(coverImagePath(bookId), jpeg);
    const meta: CoverMeta = { author };
    await writeTextAtomic(coverMetaPath(bookId), JSON.stringify(meta, null, 2));
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
    if (!(await appData.exists(path))) return null;
    return parseCoverFailure(JSON.parse(await appData.readText(path)));
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
