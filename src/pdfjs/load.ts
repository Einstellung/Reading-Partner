// The one pinned pdf.js the app parses PDFs with, outside the reader engine:
// full-text extraction (fulltext/extract.ts), the figure index
// (reading/figures/store.ts) and figure rasterization
// (reading/figures/render.ts) all load it through here, so they share one copy
// of the library and its worker. Browser only.

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

// WebKitGTK (the Tauri webview) trails newer JS built-ins; the reader's own
// pdf.js needed a Math.sumPrecise polyfill for the same reason.
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
// bundle (a separate chunk fetched on the first book open).
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
