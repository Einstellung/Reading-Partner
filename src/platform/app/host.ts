// What host the code is running in, and the shape of the fetch it is handed.
// No imports, so anything from the sync engine to a domain's HTTP client can
// ask without dragging a Tauri plugin into its module scope.

// True inside the Tauri webview, false under bun and the plain-browser dev
// server. `__TAURI_INTERNALS__` is the object the runtime injects into the page.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// An injected fetch: the native one, a domain's plugin-routed replacement
// (reading's readingFetch, info's infoFetch), or a test's stub. Everything that
// goes out over HTTP takes one of these rather than reaching for the global, so
// the same code runs headless.
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
