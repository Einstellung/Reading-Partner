// App-level PDFium engine singleton. usePdfiumEngine builds a fresh engine
// (wasm fetch + compile + init) on every mount and destroys it on unmount, so
// with EmbedPdfView remounting per book, every open re-pays the wasm cost — the
// most WebKitGTK-sensitive part of the load. Here the engine is created once and
// kept for the app's lifetime; a book open only opens a document on it. Prewarm
// at app start so the wasm is compiled before the first open.
//
// PDFium rasterises in a worker. On the main thread it was the reader's scroll
// stutter: rasterising a page competes with the frame that has to show it, and
// on a slow scroll of the demo book that cost 682ms of main-thread script and
// two long tasks per pass, against 135ms and none in the worker; on a fast
// scroll the worst frame went from 83ms to 17ms.
//
// The wasm URL has to be absolute. The worker engine inlines its whole source
// into a `blob:` URL worker and then fetches the wasm from inside it, and a
// blob: URL has an opaque path, so a root-relative "/pdfium/pdfium.wasm" has no
// base to resolve against and the fetch throws — which the worker reports as a
// message type the executor ignores, so it hangs rather than failing
// (docs/pitfall/21). Resolved against location.href, not location.origin: under
// a custom scheme the origin can serialise to "null", and href is a usable base
// either way.
//
// fontFallback:null keeps it offline (no CDN fonts). encoderPoolSize is left at
// the default: the measurement that once said it does not move first paint was
// taken on the direct engine, which never reads the option at all
// (docs/pitfall/139), so it says nothing about the worker engine that does.

import type { PdfEngine } from "@embedpdf/models";
import { probePdfBytes, startEngine, type EngineMode } from "./engine-start";

const WASM_PATH = "/pdfium/pdfium.wasm";

// Long enough for a cold wasm fetch, compile and PDFium init on a tablet, short
// enough that a hung worker does not look like a hung app. The hang in pitfall
// 21 was permanent, not slow: 8s and 25s both sat there.
const WORKER_PROBE_TIMEOUT_MS = 15_000;

let enginePromise: Promise<PdfEngine> | null = null;
let mode: EngineMode | null = null;

/** Where PDFium ended up rasterising, or null before the engine has started. */
export function pdfiumEngineMode(): EngineMode | null {
  return mode;
}

function wasmUrl(): string {
  return new URL(WASM_PATH, location.href).href;
}

// The round trip that proves the worker is alive: open a one-page PDF built in
// engine-start.ts and close it again. Reaching this at all means the wasm was
// fetched, compiled and initialised, since the executor holds every call until
// the worker says it is ready.
async function probeEngine(engine: PdfEngine): Promise<void> {
  const doc = await engine
    .openDocumentBuffer({ id: "engine-probe", content: probePdfBytes() })
    .toPromise();
  await engine.closeDocument(doc).toPromise();
}

function createWorkerEngine(): Promise<PdfEngine> {
  return import("@embedpdf/engines/pdfium-worker-engine").then(({ createPdfiumEngine }) =>
    createPdfiumEngine(wasmUrl(), { fontFallback: null }),
  );
}

function createDirectEngine(): Promise<PdfEngine> {
  return import("@embedpdf/engines/pdfium-direct-engine").then(({ createPdfiumEngine }) =>
    createPdfiumEngine(wasmUrl(), { fontFallback: null }),
  );
}

export function getPdfiumEngine(): Promise<PdfEngine> {
  if (!enginePromise) {
    enginePromise = startEngine<PdfEngine>({
      createWorker: createWorkerEngine,
      probe: probeEngine,
      discard: (engine) => {
        try {
          engine.destroy?.();
        } catch {
          // Already gone, or gone in a way that has nothing left to terminate.
        }
      },
      createDirect: createDirectEngine,
      timeoutMs: WORKER_PROBE_TIMEOUT_MS,
      // No toast: the reader still works, it just stutters, and a platform where
      // the worker never comes up would say this on every launch. The line and
      // the mode below are for whoever is looking at why scrolling is rough.
      onFallback: (reason) =>
        console.warn("PDFium worker unavailable; rasterising on the main thread:", reason),
    }).then(({ engine, mode: started }) => {
      mode = started;
      // Readable from a devtools console or an injected script, which is how
      // this gets checked inside a packaged webview.
      (window as unknown as { __pdfiumEngineMode?: EngineMode }).__pdfiumEngineMode = started;
      return engine;
    });
  }
  return enginePromise;
}

// Fire-and-forget: kick off wasm download + compile early (call at app start)
// so it is not on the first book-open's critical path. With the worker engine
// this also runs the probe, so the fallback decision is made before a book is
// ever opened.
export function prewarmPdfiumEngine(): void {
  void getPdfiumEngine().catch(() => {});
}
