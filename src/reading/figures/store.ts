// Figure-index cache persistence: one figures-<key>.json per document under
// AppData, beside the full-text cache and keyed the same way (book id / prep
// key). Extraction is skipped when a same-version cache exists. An extraction
// failure degrades to an empty index (persisted, so it isn't retried every open)
// and is reported, never thrown — a missing figure index must never break full
// text.
//
// Two things that empty index used to lose, both because it said nothing about
// where it came from:
//
//   One pdf.js failure filed a document as having no figures for good. Nothing
//   ever looked again, so view_figure was never offered to the AI for that book
//   again (tools.ts). The record now carries a status and the time of the
//   failure, and a failed one expires the way a failed cover does
//   (reading/cover-cache.ts).
//
//   A cache file that could not be read looked exactly like one that was not
//   there, so the re-extraction wrote its result over bytes nobody had read.
//   readCache keeps those two apart and refuses the write for the second.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { reportStoreError } from "../../platform/app/store-errors";
import { extractFiguresFromDocument, FIGURES_VERSION } from "./extract";
import { loadPdfjs } from "../../fulltext/extract";
import type { FiguresIndex } from "./types";

// A failed extraction is written down so the next open does not repeat it, and
// expires so a document is not written off forever over one bad day — the same
// bargain, and the same day, as the cover cache's COVER_RETRY_AFTER_MS.
export const FIGURES_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

// The record of an extraction that failed: no figures, and why there are none.
export function failedFigures(at: number): FiguresIndex {
  return { version: FIGURES_VERSION, status: "failed", figures: [], failedAt: at };
}

// Whether a cached index still answers for the document, or the extraction is
// due to be tried again. An "ok" index always answers, empty or not: that is
// what the document has in it. Pure — unit-tested.
export function figuresCacheFresh(index: FiguresIndex, now: number): boolean {
  if (index.status !== "failed") return true;
  return now - (index.failedAt ?? 0) < FIGURES_RETRY_AFTER_MS;
}

function fileFor(hash: string): string {
  return `figures-${hash}.json`;
}

// Validate a parsed cache against the current version. Pure so cache versioning
// is unit-testable without touching the filesystem. A record with no status is
// a version-2 file, which the version gate has already turned down; the check
// is here so nothing else can produce one.
export function parseFiguresCache(raw: unknown, version: number = FIGURES_VERSION): FiguresIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const idx = raw as Partial<FiguresIndex>;
  if (idx.version !== version) return null;
  if (!Array.isArray(idx.figures)) return null;
  if (idx.status !== "ok" && idx.status !== "failed") return null;
  return idx as FiguresIndex;
}

// The cache file, plus whether this document's cache may be written. Three
// answers, not two:
//
//   nothing there, or content this version does not accept — no index, and the
//   name is free: the cache is derived from the PDF and re-extracting is the
//   whole repair.
//   bytes that could not be read — no index either, and the name is NOT free.
//   Nothing is known to be wrong with that file, and a re-extraction that wrote
//   over it would be a guess replacing a record. Costs one extraction that is
//   thrown away; the next launch reads the file again.
//
// The same split readGuardedJson makes for files that cannot be rebuilt
// (platform/app/atomic-fs.ts). It is spelled out here rather than reused
// because a figure index is a cache: bad content is silently replaced instead
// of being quarantined and shown to the reader.
async function readCache(hash: string): Promise<{ index: FiguresIndex | null; writable: boolean }> {
  const name = fileFor(hash);
  let text: string;
  try {
    if (!(await appData.exists(name))) return { index: null, writable: true };
    text = await appData.readText(name);
  } catch (e) {
    console.warn("failed to read figures cache", e);
    return { index: null, writable: false };
  }
  try {
    return { index: parseFiguresCache(JSON.parse(text)), writable: true };
  } catch (e) {
    console.warn("failed to parse figures cache", e);
    return { index: null, writable: true };
  }
}

// Load a document's cached figure index by path hash. Missing, stale-version and
// unreadable caches return null (caller re-extracts), and so does the record of
// an extraction that failed long enough ago to be worth another try. A
// read/parse error is logged, not thrown.
export async function getFigures(hash: string, now: number = Date.now()): Promise<FiguresIndex | null> {
  const { index } = await readCache(hash);
  if (!index) return null;
  return figuresCacheFresh(index, now) ? index : null;
}

// Coalesce concurrent extraction requests for the same document.
const inFlight = new Map<string, Promise<FiguresIndex>>();

// Return the cached figure index, extracting and caching it on a miss.
// Fire-and-forget safe: extraction runs on the pdf.js worker off the UI thread.
// An extraction failure resolves to an empty index marked "failed", which is
// cached for a day and then tried again.
export async function ensureFigures(
  key: string,
  buffer: ArrayBuffer,
  now: () => number = Date.now,
): Promise<FiguresIndex> {
  const hash = key;
  const { index: cached, writable } = await readCache(hash);
  if (cached && figuresCacheFresh(cached, now())) return cached;
  const existing = inFlight.get(hash);
  if (existing) return existing;

  const job = (async () => {
    let index: FiguresIndex = failedFigures(now());
    try {
      const pdfjs = await loadPdfjs();
      // pdf.js detaches the buffer; copy so the caller's bytes survive.
      const data = new Uint8Array(buffer.slice(0));
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
      try {
        index = await extractFiguresFromDocument(
          doc as unknown as Parameters<typeof extractFiguresFromDocument>[0],
          (pdfjs as unknown as { OPS: Record<string, number> }).OPS,
        );
      } finally {
        await doc.destroy();
      }
    } catch (e) {
      // Reported, not logged here: the line for this scope is the channel's
      // (store-errors.ts), and it covers both halves of the index failing.
      reportStoreError("figures", e);
      index = failedFigures(now());
    }
    // Not when the file on disk could not be read: what is there was never
    // seen, and this result is not evidence about it.
    if (writable) {
      try {
        await writeTextAtomic(fileFor(hash), JSON.stringify(index));
      } catch (e) {
        reportStoreError("figures", e);
      }
    }
    return index;
  })();

  inFlight.set(hash, job);
  try {
    return await job;
  } finally {
    inFlight.delete(hash);
  }
}
