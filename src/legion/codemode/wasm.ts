// The QuickJS engine the code sandbox runs (docs/soul/686). Self-hosted like
// pdfium.wasm: `bun run wasm` copies it out of the quickjs-wasi package into
// public/quickjs/, and the webview fetches it from there and compiles it once
// per process. Resolved against location.href, not location.origin: under a
// custom scheme the origin can serialise to "null" (engine-singleton.ts).
// Compiled from the bytes rather than streamed, because compileStreaming wants
// an application/wasm content type a custom-scheme handler need not send.

/** Where the webview finds the engine. */
export const QUICKJS_WASM_PATH = "/quickjs/quickjs.wasm";

/** The compiled engine, as the sandbox takes it. */
export type QuickJsWasm = () => Promise<WebAssembly.Module>;

let compiled: Promise<WebAssembly.Module> | null = null;
let replaced: QuickJsWasm | null = null;

/** The engine, fetched and compiled on first use. A failed load is tried again on the next call. */
export const appQuickJsWasm: QuickJsWasm = () => {
  if (replaced) return replaced();
  if (compiled) return compiled;
  const loading = (async () => {
    const url = new URL(QUICKJS_WASM_PATH, location.href);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`the code sandbox engine did not load (HTTP ${response.status} for ${QUICKJS_WASM_PATH})`);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  compiled = loading;
  loading.catch(() => {
    if (compiled === loading) compiled = null;
  });
  return loading;
};

/**
 * Where the engine comes from for a runtime with no page to fetch it from: a
 * test under bun, which reads the installed package. Returns the undo.
 */
export function replaceQuickJsWasm(loader: QuickJsWasm): () => void {
  replaced = loader;
  return () => {
    if (replaced === loader) replaced = null;
  };
}
