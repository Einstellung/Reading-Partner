// X search as a source (docs/info/88): the topic search reads X's own search
// page in the hidden browse window, signed in as the reader's main account.
//
// It is not a subscription. Nothing polls it, it is never in info-sources.json,
// and the engine never runs it; what reads X is the topic search's own run. The
// descriptor exists for the one thing every source with a session shares: the
// sign-in row. Once the reader has a topic search, site-session.ts folds it in
// with the subscribed sources, so x.com gets the same row Bloomberg has — open
// the login window, check the session, sign out — on the same cookie jar the
// browse window reads through.

import type { SourceDescriptor } from "./descriptor";

/** X's own login page. The reader signs in there, in a window of X's. */
export const X_SIGN_IN_URL = "https://x.com/i/flow/login";

export const X_SEARCH_SOURCE: SourceDescriptor = {
  id: "x-search",
  name: "X search",
  line: "x",
  builtin: true,
  enabled: false,
  // An index in the docs/69 sense: a fixed site and an open query. No provider
  // of this name is registered, which is the point — nothing collects it.
  discovery: { kind: "index", provider: "x-search", query: {} },
  fulltext: { mode: "webview", signInUrl: X_SIGN_IN_URL },
};
