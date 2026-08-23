// Live wiring of the add-source flow (docs/17): binds the real fetch (infoFetch,
// browser UA) and the readable extractor to the pure probe/trial logic. The pure
// logic stays testable with injected deps; this module is where the app grabs a
// one-shot "paste a URL" path for the source-list page. The extractor is loaded
// on first use (readable-lazy) rather than imported here, so Readability and
// defuddle stay off the boot path.

import { infoFetch } from "../extract/http";
import { loadExtractReadable } from "../extract/readable-lazy";
import { fetchArticleViaWebview } from "../extract/webview-article";
import { hasWebviewFetch } from "../../platform/app/platform";
import type { WebviewFetch } from "./engine";
import { probeSource } from "./probe";
import { trialSource, trialUsesWebview } from "./source-tools";
import type { ProbeConfirmCardData } from "./source-cards";

// The hidden-webview article fetcher where the host has one, wired exactly as
// the collection path wires it (briefing/live.ts). A trial without it answers
// "summary only" for every `webview` source — which is the wrong answer to the
// question the trial is asked, since that is the gate a source has to pass to be
// added at all.
export function liveWebviewFetch(): WebviewFetch | undefined {
  return hasWebviewFetch() ? fetchArticleViaWebview : undefined;
}

export type ProbeAddOutcome =
  | { ok: true; card: ProbeConfirmCardData }
  | { ok: false; error: string };

// The source-list page's "paste an RSS URL" path: probe, then trial in one shot,
// returning a confirm card or an honest error — no chat, no AI.
//
// `onSlowTrial` fires once, after the probe, when the trial about to run will
// open a browser window for the body: that call takes tens of seconds and the
// page has only a spinner to show, so the caller is told in time to say so.
export async function liveProbeAndTrial(
  input: string,
  onSlowTrial?: () => void,
): Promise<ProbeAddOutcome> {
  const probe = await probeSource(input, { fetchFn: infoFetch });
  if (!probe.ok || !probe.descriptor) {
    return { ok: false, error: probe.reason ?? "Could not connect this source." };
  }
  const fetchViaWebview = liveWebviewFetch();
  if (trialUsesWebview(probe.descriptor, { fetchViaWebview })) onSlowTrial?.();
  const trial = await trialSource(probe.descriptor, {
    fetchFn: infoFetch,
    extract: await loadExtractReadable(),
    fetchViaWebview,
  });
  if (!trial.ok) {
    return { ok: false, error: trial.error ?? "The trial fetch returned nothing." };
  }
  return { ok: true, card: { kind: "probe-confirm", descriptor: probe.descriptor, pipeLabel: probe.pipeLabel, samples: trial.samples } };
}
