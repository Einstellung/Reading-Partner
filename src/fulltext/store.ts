// Full-text cache persistence: one fulltext-<key>.json per document under
// AppData, keyed by the book id (content hash) for real books and by a synthetic
// prep key for downloaded papers. Extraction is skipped when a same-version
// cache exists. A cache that could not be read and one that could not be written
// both go to the one store-error channel, which logs them, never silently
// swallowed (pitfall 09).

import { appData } from "../platform/app/appdata";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { reportStoreError } from "../platform/app/store-errors";
import { extractFulltext } from "./extract";
import { FULLTEXT_VERSION, type Fulltext } from "./types";

/** One document's cache file. Exported so a delete names it the same way. */
export function fulltextFile(hash: string): string {
  return `fulltext-${hash}.json`;
}

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can run the real store — the coalescing included — against its own
// files and its own extractor.
export interface FulltextIo {
  /** The cache file's text, or null when there is none. Throwing is a read that failed. */
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  extract: (buffer: ArrayBuffer) => Promise<Omit<Fulltext, "version">>;
  onError: (e: unknown) => void;
}

export interface FulltextStore {
  get: (hash: string) => Promise<Fulltext | null>;
  save: (key: string, ft: Fulltext) => Promise<void>;
  ensure: (key: string, buffer: ArrayBuffer) => Promise<Fulltext>;
}

export function createFulltextStore(io: FulltextIo): FulltextStore {
  // Coalesce concurrent extraction requests for the same document so a double
  // open doesn't parse twice.
  //
  // In the closure rather than at module scope: an entry is a promise, and a map
  // of promises shared by everything that ever imported this file hands one
  // caller's unfinished job to the next caller asking for the same key — which,
  // once the caller that started it has gone, is a job nothing will settle.
  const inFlight = new Map<string, Promise<Fulltext>>();

  // Load a document's cached full text by path hash. Missing or stale-version
  // caches return null (caller re-extracts). A read/parse error is reported, not
  // thrown, so a corrupt cache degrades to a re-extraction rather than a crash.
  async function get(hash: string): Promise<Fulltext | null> {
    try {
      const text = await io.read(fulltextFile(hash));
      if (text === null) return null;
      const parsed = JSON.parse(text) as Fulltext;
      if (!parsed || parsed.version !== FULLTEXT_VERSION) return null;
      return parsed;
    } catch (e) {
      // The line is written by the channel, not here (store-errors.ts).
      io.onError(e);
      return null;
    }
  }

  return {
    get,
    // Persist a full text that was built elsewhere (a fetched web article's
    // single "page", link ingestion in docs/09) under the same cache key a real
    // document uses, so the reading tools can serve it immediately. Overwrites
    // any prior entry for the key.
    save: (key, ft) => io.write(fulltextFile(key), JSON.stringify(ft)),

    // Return the cached full text, extracting and caching it on a miss.
    // Idempotent: a second call while extraction is running joins the same job.
    // Safe to call fire-and-forget at book-open time; the pdf.js worker keeps
    // parsing off the UI.
    ensure: async (key, buffer) => {
      const hash = key;
      const cached = await get(hash);
      if (cached) return cached;
      const existing = inFlight.get(hash);
      if (existing) return existing;

      const job = (async () => {
        const result = await io.extract(buffer);
        const ft: Fulltext = { version: FULLTEXT_VERSION, ...result };
        try {
          await io.write(fulltextFile(hash), JSON.stringify(ft));
        } catch (e) {
          // The line is written by the channel, not here (store-errors.ts).
          io.onError(e);
        }
        return ft;
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
// the process — a spy installed on the imported module later would never be
// reached (docs/pitfall/122).
const store = createFulltextStore({
  read: async (file) => ((await appData.exists(file)) ? appData.readText(file) : null),
  write: (file, contents) => writeTextAtomic(file, contents),
  extract: (buffer) => extractFulltext(buffer),
  onError: (e) => reportStoreError("fulltext", e),
});

export function getFulltext(hash: string): Promise<Fulltext | null> {
  return store.get(hash);
}

export function saveFulltext(key: string, ft: Fulltext): Promise<void> {
  return store.save(key, ft);
}

export function ensureFulltext(key: string, buffer: ArrayBuffer): Promise<Fulltext> {
  return store.ensure(key, buffer);
}
