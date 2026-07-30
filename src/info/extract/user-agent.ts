// The default request identity for the info engine (docs/17). Endpoints and
// per-source headers live in the source descriptors (sources/descriptor.ts /
// sources/builtins.ts); the shared default User-Agent lives here, next to the
// http wrapper that forces it onto every request a descriptor doesn't override.

// A plain desktop-browser UA. Feeds/APIs reject the polite bot UA the prep
// pipeline uses (arxiv/openalex), so this path presents as an ordinary browser.
export const INFO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
