// One page rendered in the app's hidden webview, and what came back.
//
// A stub: the real one is being added in a sibling branch, and this file exists
// so the code that calls it can be written and tested against the contract.

/** What one rendered page came back as. */
export interface WebviewPage {
  status: "ok" | "blocked" | "empty" | "timeout" | "network" | "unsupported";
  requestedUrl: string;
  finalUrl: string | null;
  title: string | null;
  html: string | null;
  /** What the injected script evaluated to, when one was given. */
  result: unknown | null;
  elapsedMs: number;
  detail: string | null;
}

/**
 * Render a URL in the hidden webview and answer what it became. `script` is
 * evaluated in the page once it has settled and its value comes back as
 * `result`.
 */
export async function fetchPageViaWebview(
  url: string,
  opts: { script?: string; timeoutMs?: number } = {},
): Promise<WebviewPage> {
  void opts;
  return {
    status: "unsupported",
    requestedUrl: url,
    finalUrl: null,
    title: null,
    html: null,
    result: null,
    elapsedMs: 0,
    detail: "the hidden webview page fetch is not built yet",
  };
}
