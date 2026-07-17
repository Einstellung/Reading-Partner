// PDF text + outline extraction, independent of the reader engine: the shell
// already holds the file bytes at open time, so we parse with our own pinned
// pdf.js in its worker rather than reaching into the engine's nested iframe.
// The pure functions (page-text assembly, garbage detection, outline
// flattening, extractFromDocument) take a structural pdf.js document so they
// run headless in tests; extractFulltext wires them to the lazily loaded engine.

import { FULLTEXT_VERSION, type Fulltext, type FulltextStatus, type OutlineItem } from "./types";

// Structural subset of pdf.js we depend on — keeps the pure path free of the
// pdfjs-dist type surface and importable without loading the engine.
export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}
export interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}
export interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineNode[];
}
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getOutline(): Promise<PdfOutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
  destroy(): Promise<void>;
}

// A broken font-to-Unicode map yields text but not readable text: mostly the
// replacement char, private-use-area code points, or control characters. Above
// this share of non-whitespace characters we treat the page as having no real
// text layer.
const GARBAGE_THRESHOLD = 0.2;
const GARBAGE_SAMPLE = 20000;
// Yield to the event loop every few pages so a long book doesn't lock the UI.
const YIELD_EVERY = 8;

function buildPageText(items: PdfTextItem[]): string {
  let text = "";
  for (const it of items) {
    if (typeof it.str === "string") text += it.str;
    if (it.hasEOL) text += "\n";
  }
  return text;
}

export function garbageRatio(text: string): number {
  let bad = 0;
  let total = 0;
  const n = Math.min(text.length, GARBAGE_SAMPLE);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue; // whitespace
    total++;
    const isReplacement = c === 0xfffd;
    const isPua = c >= 0xe000 && c <= 0xf8ff; // BMP private use area
    const isControl = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    if (isReplacement || isPua || isControl) bad++;
  }
  return total === 0 ? 0 : bad / total;
}

export function looksLikeGarbage(text: string): boolean {
  return garbageRatio(text) > GARBAGE_THRESHOLD;
}

function classify(joined: string): FulltextStatus {
  if (joined.replace(/\s+/g, "").length === 0) return "no-text-layer";
  if (looksLikeGarbage(joined)) return "no-text-layer";
  return "ok";
}

// Resolve a pdf.js outline destination to a 1-based page number, or null when
// it points nowhere usable (external URL, named dest that doesn't resolve).
export type ResolvePage = (dest: string | unknown[] | null) => Promise<number | null>;

export function makeResolvePage(doc: PdfDocument): ResolvePage {
  return async (dest) => {
    try {
      let d: string | unknown[] | null = dest;
      if (typeof d === "string") d = await doc.getDestination(d);
      if (!Array.isArray(d) || d.length === 0) return null;
      const ref = d[0];
      if (ref === null || ref === undefined) return null;
      const idx = await doc.getPageIndex(ref);
      return idx + 1;
    } catch {
      return null;
    }
  };
}

export async function flattenOutline(
  nodes: PdfOutlineNode[] | null,
  resolvePage: ResolvePage,
  level = 0,
  out: OutlineItem[] = [],
): Promise<OutlineItem[]> {
  if (!nodes) return out;
  for (const node of nodes) {
    const page = await resolvePage(node.dest ?? null);
    if (page !== null) {
      const title = typeof node.title === "string" ? node.title.trim() : "";
      out.push({ title, page, level });
    }
    if (node.items && node.items.length) {
      await flattenOutline(node.items, resolvePage, level + 1, out);
    }
  }
  return out;
}

export async function extractFromDocument(doc: PdfDocument): Promise<Omit<Fulltext, "version">> {
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(buildPageText(content.items));
    if (n % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const outline = await flattenOutline(await doc.getOutline(), makeResolvePage(doc));
  return { status: classify(pages.join("")), pages, outline };
}

// --- Engine-backed path (browser only) ---

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

// WebKitGTK (the Tauri webview) trails newer JS built-ins; the reader's own
// pdf.js needed a Math.sumPrecise polyfill for the same reason (pitfall 02).
// pdf.js 4.x uses Promise.withResolvers, so guard it before loading the engine.
function ensurePromiseWithResolvers(): void {
  const P = Promise as unknown as { withResolvers?: unknown };
  if (typeof P.withResolvers === "function") return;
  P.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Loaded lazily and cached so pdf.js and its worker stay out of the initial
// bundle (a separate chunk fetched on the first book open). Exported so the
// figure-index extractor (src/figures) reuses the exact same pinned pdf.js and
// worker rather than loading a second copy.
export async function loadPdfjs() {
  ensurePromiseWithResolvers();
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function extractFulltext(buffer: ArrayBuffer): Promise<Omit<Fulltext, "version">> {
  const pdfjs = await loadPdfjs();
  // pdf.js detaches the buffer it is handed; copy so the caller's bytes survive.
  const data = new Uint8Array(buffer.slice(0));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    return await extractFromDocument(doc as unknown as PdfDocument);
  } finally {
    await doc.destroy();
  }
}

// Re-exported so callers can stamp the version onto an extraction result.
export { FULLTEXT_VERSION };
