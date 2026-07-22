// Live wiring of the add-source flow (docs/17): binds the real fetch (infoFetch,
// browser UA) and the readable extractor to the pure probe/trial logic and the
// source tools. The pure logic stays testable with injected deps; this module is
// where the app grabs a ready-to-use tool set and a one-shot "paste a URL" path
// for the source-list page. Imported only in the webview (extractReadable needs a
// DOM), never in bun tests.

import { infoFetch } from "./http";
import { extractReadable } from "./readable";
import { probeSource } from "./probe";
import { buildSourceTools, trialSource } from "./source-tools";
import { addSource } from "./source-store";
import { builtinById } from "./builtins";
import type { ProbeConfirmCardData } from "./cards";
import type { AgentTool } from "../ai/agent";

// The three add-source tools bound to the live fetch/extract/store. `onProbeCard`
// lets the chat surface the confirm card when trial_source succeeds.
export function buildLiveSourceTools(onProbeCard: (card: ProbeConfirmCardData) => void): AgentTool[] {
  return buildSourceTools({
    fetchFn: infoFetch,
    extract: extractReadable,
    resolveKnown: builtinById,
    addSource: (d) => addSource(d).then(() => {}),
    onProbeCard,
  });
}

export type ProbeAddOutcome =
  | { ok: true; card: ProbeConfirmCardData }
  | { ok: false; error: string };

// The source-list page's "paste an RSS URL" path: probe, then trial in one shot,
// returning a confirm card or an honest error — no chat, no AI.
export async function liveProbeAndTrial(input: string): Promise<ProbeAddOutcome> {
  const probe = await probeSource(input, { fetchFn: infoFetch });
  if (!probe.ok || !probe.descriptor) {
    return { ok: false, error: probe.reason ?? "Could not connect this source." };
  }
  const trial = await trialSource(probe.descriptor, { fetchFn: infoFetch, extract: extractReadable });
  if (!trial.ok) {
    return { ok: false, error: trial.error ?? "The trial fetch returned nothing." };
  }
  return { ok: true, card: { kind: "probe-confirm", descriptor: probe.descriptor, pipeLabel: probe.pipeLabel, samples: trial.samples } };
}
