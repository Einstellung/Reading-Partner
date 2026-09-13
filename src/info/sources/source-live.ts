// Live wiring on the add-source path: the hidden-webview article fetcher, bound
// to the host that has one. The probe/trial logic itself stays pure with
// injected deps (probe.ts, source-tools.ts); this is only where the app hands it
// the real thing.

import { fetchArticleViaWebview } from "../extract/webview-article";
import { hasWebviewFetch } from "../../platform/app/platform";
import type { WebviewFetch } from "./engine";

// The hidden-webview article fetcher where the host has one, wired exactly as
// the collection path wires it (program/live.ts). A trial without it answers
// "summary only" for every `webview` source — which is the wrong answer to the
// question the trial is asked, since that is the gate a source has to pass to be
// added at all.
export function liveWebviewFetch(): WebviewFetch | undefined {
  return hasWebviewFetch() ? fetchArticleViaWebview : undefined;
}
