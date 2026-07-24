// Figure-index cache persistence: one figures-<key>.json per document under
// AppData, beside the full-text cache and keyed the same way (book id / prep
// key). Extraction is skipped when a same-version cache exists. An extraction failure
// degrades to an empty index (persisted, so it isn't retried every open) and is
// reported, never thrown — a missing figure index must never break full text.

import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { extractFiguresFromDocument, FIGURES_VERSION } from "./extract";
import { loadPdfjs } from "../fulltext/extract";
import type { FiguresIndex } from "./types";

function fileFor(hash: string): string {
  return `figures-${hash}.json`;
}

let onError: (e: unknown) => void = () => {};
export function onFiguresError(handler: (e: unknown) => void): void {
  onError = handler;
}

// Validate a parsed cache against the current version. Pure so cache versioning
// is unit-testable without touching the filesystem.
export function parseFiguresCache(raw: unknown, version: number = FIGURES_VERSION): FiguresIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const idx = raw as Partial<FiguresIndex>;
  if (idx.version !== version) return null;
  if (!Array.isArray(idx.figures)) return null;
  return idx as FiguresIndex;
}

// Load a document's cached figure index by path hash. Missing or stale-version
// caches return null (caller re-extracts). A read/parse error is reported, not
// thrown.
export async function getFigures(hash: string): Promise<FiguresIndex | null> {
  const name = fileFor(hash);
  try {
    if (!(await exists(name, { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(await readTextFile(name, { baseDir: BaseDirectory.AppData }));
    return parseFiguresCache(parsed);
  } catch (e) {
    console.warn("failed to read figures cache", e);
    return null;
  }
}

const EMPTY: FiguresIndex = { version: FIGURES_VERSION, figures: [] };

// Coalesce concurrent extraction requests for the same document.
const inFlight = new Map<string, Promise<FiguresIndex>>();

// Return the cached figure index, extracting and caching it on a miss.
// Fire-and-forget safe: extraction runs on the pdf.js worker off the UI thread.
// Any extraction failure resolves to (and caches) an empty index.
export async function ensureFigures(key: string, buffer: ArrayBuffer): Promise<FiguresIndex> {
  const hash = key;
  const cached = await getFigures(hash);
  if (cached) return cached;
  const existing = inFlight.get(hash);
  if (existing) return existing;

  const job = (async () => {
    let index: FiguresIndex = EMPTY;
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
      console.warn("failed to extract figures", e);
      onError(e);
      index = EMPTY;
    }
    try {
      await writeTextFile(fileFor(hash), JSON.stringify(index), { baseDir: BaseDirectory.AppData });
    } catch (e) {
      console.warn("failed to persist figures cache", e);
      onError(e);
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
