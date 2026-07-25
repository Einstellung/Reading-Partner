// App-level PDFium engine singleton. usePdfiumEngine builds a fresh engine
// (wasm fetch + compile + init) on every mount and destroys it on unmount, so
// with EmbedPdfView remounting per book, every open re-pays the wasm cost — the
// most WebKitGTK-sensitive part of the load. Here the engine is created once and
// kept for the app's lifetime; a book open only opens a document on it. Prewarm
// at app start so the wasm is compiled before the first open.

import type { PdfEngine } from "@embedpdf/models";

const WASM_URL = "/pdfium/pdfium.wasm";

let enginePromise: Promise<PdfEngine> | null = null;

export function getPdfiumEngine(): Promise<PdfEngine> {
  if (!enginePromise) {
    enginePromise = import("@embedpdf/engines/pdfium-direct-engine").then(({ createPdfiumEngine }) =>
      // worker:false equivalent — direct main-thread engine (worker mode hangs,
      // see pitfall 21). fontFallback:null keeps it offline (no CDN fonts).
      // (encoderPoolSize was measured to not move first paint — raster, not
      // encode, is the cost — so it is left at the default.)
      createPdfiumEngine(WASM_URL, { fontFallback: null }),
    );
  }
  return enginePromise;
}

// Fire-and-forget: kick off wasm download + compile early (call at app start)
// so it is not on the first book-open's critical path.
export function prewarmPdfiumEngine(): void {
  void getPdfiumEngine().catch(() => {});
}
