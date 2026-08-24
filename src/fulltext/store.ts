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

function fileFor(hash: string): string {
  return `fulltext-${hash}.json`;
}

// Load a document's cached full text by path hash. Missing or stale-version
// caches return null (caller re-extracts). A read/parse error is reported, not
// thrown, so a corrupt cache degrades to a re-extraction rather than a crash.
export async function getFulltext(hash: string): Promise<Fulltext | null> {
  const name = fileFor(hash);
  try {
    if (!(await appData.exists(name))) return null;
    const parsed = JSON.parse(await appData.readText(name)) as Fulltext;
    if (!parsed || parsed.version !== FULLTEXT_VERSION) return null;
    return parsed;
  } catch (e) {
    // The line is written by the channel, not here (store-errors.ts).
    reportStoreError("fulltext", e);
    return null;
  }
}

// Persist a full text that was built elsewhere (a fetched web article's single
// "page", link ingestion in docs/09) under the same cache key a real document
// uses, so the reading tools can serve it immediately. Overwrites any prior
// entry for the key.
export async function saveFulltext(key: string, ft: Fulltext): Promise<void> {
  await writeTextAtomic(fileFor(key), JSON.stringify(ft));
}

// Coalesce concurrent extraction requests for the same document so a double
// open doesn't parse twice.
const inFlight = new Map<string, Promise<Fulltext>>();

// Return the cached full text, extracting and caching it on a miss. Idempotent:
// a second call while extraction is running joins the same job. Safe to call
// fire-and-forget at book-open time; the pdf.js worker keeps parsing off the UI.
export async function ensureFulltext(key: string, buffer: ArrayBuffer): Promise<Fulltext> {
  const hash = key;
  const cached = await getFulltext(hash);
  if (cached) return cached;
  const existing = inFlight.get(hash);
  if (existing) return existing;

  const job = (async () => {
    const result = await extractFulltext(buffer);
    const ft: Fulltext = { version: FULLTEXT_VERSION, ...result };
    try {
      await writeTextAtomic(fileFor(hash), JSON.stringify(ft));
    } catch (e) {
      // The line is written by the channel, not here (store-errors.ts).
      reportStoreError("fulltext", e);
    }
    return ft;
  })();

  inFlight.set(hash, job);
  try {
    return await job;
  } finally {
    inFlight.delete(hash);
  }
}
