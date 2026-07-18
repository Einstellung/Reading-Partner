// Full-text cache persistence: one fulltext-<pathHash>.json per document under
// AppData, keyed by the same djb2 path hash as annotations. Extraction is
// skipped when a same-version cache exists. Persistence failures are surfaced
// (console.warn + an error hook), never silently swallowed (pitfall 09).

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { hashPath } from "../storage";
import { extractFulltext } from "./extract";
import { FULLTEXT_VERSION, type Fulltext } from "./types";

function fileFor(hash: string): string {
  return `fulltext-${hash}.json`;
}

let onError: (e: unknown) => void = () => {};
export function onFulltextError(handler: (e: unknown) => void): void {
  onError = handler;
}

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// Load a document's cached full text by path hash. Missing or stale-version
// caches return null (caller re-extracts). A read/parse error is reported, not
// thrown, so a corrupt cache degrades to a re-extraction rather than a crash.
export async function getFulltext(hash: string): Promise<Fulltext | null> {
  const name = fileFor(hash);
  try {
    if (!(await exists(name, { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(name, { baseDir: BaseDirectory.AppData }),
    ) as Fulltext;
    if (!parsed || parsed.version !== FULLTEXT_VERSION) return null;
    return parsed;
  } catch (e) {
    console.warn("failed to read fulltext cache", e);
    return null;
  }
}

// Persist a full text that was built elsewhere (a fetched web article's single
// "page", link ingestion in docs/09) under the same cache key a real document
// uses, so the reading tools can serve it immediately. Overwrites any prior
// entry for the path.
export async function saveFulltext(path: string, ft: Fulltext): Promise<void> {
  const hash = hashPath(path);
  await ensureDir();
  await writeTextFile(fileFor(hash), JSON.stringify(ft), { baseDir: BaseDirectory.AppData });
}

// Coalesce concurrent extraction requests for the same document so a double
// open doesn't parse twice.
const inFlight = new Map<string, Promise<Fulltext>>();

// Return the cached full text, extracting and caching it on a miss. Idempotent:
// a second call while extraction is running joins the same job. Safe to call
// fire-and-forget at book-open time; the pdf.js worker keeps parsing off the UI.
export async function ensureFulltext(path: string, buffer: ArrayBuffer): Promise<Fulltext> {
  const hash = hashPath(path);
  const cached = await getFulltext(hash);
  if (cached) return cached;
  const existing = inFlight.get(hash);
  if (existing) return existing;

  const job = (async () => {
    const result = await extractFulltext(buffer);
    const ft: Fulltext = { version: FULLTEXT_VERSION, ...result };
    try {
      await ensureDir();
      await writeTextFile(fileFor(hash), JSON.stringify(ft), {
        baseDir: BaseDirectory.AppData,
      });
    } catch (e) {
      console.warn("failed to persist fulltext cache", e);
      onError(e);
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
