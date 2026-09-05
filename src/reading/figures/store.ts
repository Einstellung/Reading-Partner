// Figure-index cache persistence: one figures-<key>.json per document under
// AppData, beside the full-text cache and keyed the same way (book id / prep
// key). Extraction is skipped when a same-version cache exists. An extraction
// failure degrades to an empty index (persisted, so it isn't retried every open)
// and is reported, never thrown — a missing figure index must never break full
// text.
//
// That empty index used to say nothing about where it came from, so one pdf.js
// failure filed a document as having no figures for good. Nothing ever looked
// again, and view_figure was never offered to the AI for that book (tools.ts).
// The record carries a status and the time of the failure instead, and a failed
// one expires the way a failed cover does (reading/cover-cache.ts).
//
// A cache file that will not open reads the same as one that is not there, and
// the extraction that runs instead writes over it. That is the opposite of the
// stores under platform/app, and the difference is that this file is derived:
// the document makes it again, so bytes nobody can read hold nothing worth
// keeping. Holding the write back cost more than it saved — a file stuck
// unreadable was re-extracted on every open for as long as it stayed that way,
// and the same file was replaced without a second thought whenever its content
// merely failed to parse.

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

/** One document's cache file. Exported so a delete names it the same way. */
export function figuresFile(hash: string): string {
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

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can run the real store — the coalescing included — against its own
// files and its own pdf.js.
export interface FiguresIo {
  /**
   * The cache file's text, or null when there is none. Throwing means the bytes
   * are there and would not open, which reads as a miss like any other.
   */
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  loadPdfjs: () => Promise<unknown>;
  onError: (e: unknown) => void;
}

export interface FiguresStore {
  get: (hash: string, now?: number) => Promise<FiguresIndex | null>;
  ensure: (key: string, buffer: ArrayBuffer, now?: () => number) => Promise<FiguresIndex>;
}

export function createFiguresStore(io: FiguresIo): FiguresStore {
  // Coalesce concurrent extraction requests for the same document.
  //
  // In the closure rather than at module scope: an entry is a promise, and a map
  // of promises shared by everything that ever imported this file hands one
  // caller's unfinished job to the next caller asking for the same key — which,
  // once the caller that started it has gone, is a job nothing will settle.
  const inFlight = new Map<string, Promise<FiguresIndex>>();

  // The cached index, or null when there is none to use. One answer for all
  // three ways of not having one — nothing there, content this version does not
  // accept, bytes that would not open — because the repair is the same in all
  // three: extract it again from the document and write the result down. No
  // quarantine either, for the same reason readGuardedJson has one
  // (platform/app/atomic-fs.ts): that is for what nothing can rebuild.
  async function readCache(hash: string): Promise<FiguresIndex | null> {
    let text: string | null;
    try {
      text = await io.read(figuresFile(hash));
    } catch (e) {
      console.warn("failed to read figures cache", e);
      return null;
    }
    if (text === null) return null;
    try {
      return parseFiguresCache(JSON.parse(text));
    } catch (e) {
      console.warn("failed to parse figures cache", e);
      return null;
    }
  }

  return {
    // Load a document's cached figure index by path hash. Missing, stale-version
    // and unreadable caches return null (caller re-extracts), and so does the
    // record of an extraction that failed long enough ago to be worth another
    // try. A read/parse error is logged, not thrown.
    get: async (hash, now = Date.now()) => {
      const index = await readCache(hash);
      if (!index) return null;
      return figuresCacheFresh(index, now) ? index : null;
    },

    // Return the cached figure index, extracting and caching it on a miss.
    // Fire-and-forget safe: extraction runs on the pdf.js worker off the UI
    // thread. An extraction failure resolves to an empty index marked "failed",
    // which is cached for a day and then tried again.
    ensure: async (key, buffer, now = Date.now) => {
      const hash = key;
      const cached = await readCache(hash);
      if (cached && figuresCacheFresh(cached, now())) return cached;
      const existing = inFlight.get(hash);
      if (existing) return existing;

      const job = (async () => {
        let index: FiguresIndex = failedFigures(now());
        try {
          const pdfjs = (await io.loadPdfjs()) as Awaited<ReturnType<typeof loadPdfjs>>;
          // pdf.js detaches the buffer; copy so the caller's bytes survive.
          const data = new Uint8Array(buffer.slice(0));
          const doc = await pdfjs.getDocument({
            data,
            isEvalSupported: false,
            useSystemFonts: true,
          }).promise;
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
          io.onError(e);
          index = failedFigures(now());
        }
        try {
          await io.write(figuresFile(hash), JSON.stringify(index));
        } catch (e) {
          io.onError(e);
        }
        return index;
      })();

      inFlight.set(hash, job);
      try {
        return await job;
      } finally {
        inFlight.delete(hash);
      }
    },
  };
}

// Called through rather than handed over: the wiring is evaluated once, at
// import, and a name captured then is the one this module keeps for the rest of
// the process — the spy the disk test installs on loadPdfjs would never be
// reached (docs/pitfall/122).
const store = createFiguresStore({
  read: async (file) => ((await appData.exists(file)) ? appData.readText(file) : null),
  write: (file, contents) => writeTextAtomic(file, contents),
  loadPdfjs: () => loadPdfjs(),
  onError: (e) => reportStoreError("figures", e),
});

export function getFigures(hash: string, now: number = Date.now()): Promise<FiguresIndex | null> {
  return store.get(hash, now);
}

export function ensureFigures(
  key: string,
  buffer: ArrayBuffer,
  now: () => number = Date.now,
): Promise<FiguresIndex> {
  return store.ensure(key, buffer, now);
}
