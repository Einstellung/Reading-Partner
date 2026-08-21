// Rastering page one of a document on the app's PDFium engine, with no reader
// instance and no second wasm compile: open a document on the shared engine,
// render the first page, close it again.
//
// It lives beside the engine so nothing outside src/reading/engine/ has to
// import @embedpdf — the quirks this project has paid for (an engine that can
// hang instead of failing, pitfall 21; a render quality option read under
// another name, pitfall 102) are then all recorded in one directory.
//
// What each outcome means is the caller's business: this reports it as a
// discriminated union and writes nothing down.

import type { PdfDocumentObject, PdfEngine, PdfRenderPageOptions } from "@embedpdf/models";
import { getPdfiumEngine } from "./engine-singleton";

// PDFium has hung on a document before rather than failing (pitfall 21); a hang
// here would leave whoever asked waiting forever.
const OPEN_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 20_000;

export interface RenderFirstPageOptions {
  // The engine scale factor for a page this many points wide. A function
  // because the page size is only known once the document is open, and picking
  // a target size is the caller's decision.
  scaleFactor: (pageWidthPt: number) => number;
  // JPEG quality, 0..1.
  quality: number;
  // The id the document is opened under on the shared engine. Only ever seen in
  // engine-side logs; defaults to a unique one.
  id?: string;
}

export type RenderFirstPageResult =
  | { kind: "ok"; jpeg: Uint8Array }
  // The engine itself is unavailable: nothing about this document is known.
  | { kind: "no-engine"; cause: unknown }
  // Open or render was still running at its deadline. Transient by nature — the
  // engine is shared, and the next attempt may well be fast.
  | { kind: "timeout"; message: string }
  | { kind: "open-failed"; cause: unknown }
  | { kind: "no-pages"; cause: Error }
  | { kind: "render-failed"; cause: unknown };

let seq = 0;

/**
 * Render page one of `bytes` to JPEG. Never throws: every failure comes back as
 * a `kind`.
 */
export async function renderFirstPageJpeg(
  bytes: Uint8Array,
  opts: RenderFirstPageOptions,
): Promise<RenderFirstPageResult> {
  let engine: PdfEngine<Blob>;
  try {
    engine = await getPdfiumEngine();
  } catch (e) {
    return { kind: "no-engine", cause: e };
  }
  return renderFirstPageJpegOn(engine, bytes, opts);
}

export interface RasterTimeouts {
  openMs?: number;
  renderMs?: number;
}

// The sequence itself, against a given engine. Separated so it can be driven by
// a fake engine and short deadlines in tests; the live path always goes through
// renderFirstPageJpeg above.
export async function renderFirstPageJpegOn(
  engine: PdfEngine<Blob>,
  bytes: Uint8Array,
  opts: RenderFirstPageOptions,
  timeouts: RasterTimeouts = {},
): Promise<RenderFirstPageResult> {
  const openMs = timeouts.openMs ?? OPEN_TIMEOUT_MS;
  const renderMs = timeouts.renderMs ?? RENDER_TIMEOUT_MS;
  const id = opts.id ?? `raster:${++seq}`;

  // A fresh copy: the engine takes ownership of the buffer it is handed.
  const content = bytes.slice().buffer as ArrayBuffer;
  const opening = engine.openDocumentBuffer({ id, content }).toPromise();
  let doc: PdfDocumentObject;
  try {
    doc = await withTimeout(opening, openMs, "openDocumentBuffer");
  } catch (e) {
    if (e instanceof RasterTimeout) {
      // The open may still land after the deadline; close it when it does,
      // rather than leaving a document behind on the engine the reader shares.
      void opening.then((late) => engine.closeDocument(late).toPromise()).catch(() => {});
      return { kind: "timeout", message: e.message };
    }
    return { kind: "open-failed", cause: e };
  }

  try {
    const page = doc.pages[0];
    if (!page) {
      // A document that failed to parse can still open (pitfall 58), and what
      // it opens as is a document with nothing in it.
      return { kind: "no-pages", cause: new Error("document opened with no pages") };
    }
    const blob = await withTimeout(
      engine.renderPage(doc, page, renderOptions(opts, page.size.width)).toPromise(),
      renderMs,
      "renderPage",
    );
    return { kind: "ok", jpeg: new Uint8Array(await blob.arrayBuffer()) };
  } catch (e) {
    if (e instanceof RasterTimeout) return { kind: "timeout", message: e.message };
    return { kind: "render-failed", cause: e };
  } finally {
    engine
      .closeDocument(doc)
      .toPromise()
      .catch(() => {});
  }
}

// The quality is passed under both names on purpose: the encoder reads
// `quality` while the documented option is `imageQuality`, so the documented
// one alone leaves the image at the canvas default and half again as large
// (pitfall 102). Both survive that being fixed upstream.
function renderOptions(opts: RenderFirstPageOptions, pageWidthPt: number): PdfRenderPageOptions {
  return {
    scaleFactor: opts.scaleFactor(pageWidthPt),
    dpr: 1,
    imageType: "image/jpeg",
    imageQuality: opts.quality,
    quality: opts.quality,
  } as PdfRenderPageOptions;
}

class RasterTimeout extends Error {}

function withTimeout<T>(task: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const alarm = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RasterTimeout(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([task, alarm]).finally(() => clearTimeout(timer));
}
