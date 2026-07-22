// The default request identity for the info engine (docs/17). Endpoints and
// per-source headers now live in the source descriptors (descriptor.ts /
// builtins.ts); only the shared default User-Agent stays here, since the http
// wrapper forces it onto every request when a descriptor doesn't override it.

// A plain desktop-browser UA. Feeds/APIs reject the polite bot UA the prep
// pipeline uses (arxiv/openalex), so this path presents as an ordinary browser.
export const INFO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
