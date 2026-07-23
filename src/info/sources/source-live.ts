// Live wiring of the add-source flow (docs/17): binds the real fetch (infoFetch,
// browser UA) and the readable extractor to the pure probe/trial logic and the
// source tools. The pure logic stays testable with injected deps; this module is
// where the app grabs a ready-to-use tool set and a one-shot "paste a URL" path
// for the source-list page. Imported only in the webview (extractReadable needs a
// DOM), never in bun tests.

import { infoFetch } from "../extract/http";
import { extractReadable } from "../extract/readable";
import { probeSource } from "./probe";
import { buildSourceTools, trialSource } from "./source-tools";
import { buildCompanionTools } from "../companion/companion-tools";
import { addSource } from "./source-store";
import type { ProbeConfirmCardData, ProfileUpdateCardData } from "../briefing/cards";
import type { AgentTool } from "../../ai/agent";

// The three add-source tools bound to the live fetch/extract/store. `onProbeCard`
// lets the chat surface the confirm card when trial_source succeeds.
export function buildLiveSourceTools(onProbeCard: (card: ProbeConfirmCardData) => void): AgentTool[] {
  return buildSourceTools({
    fetchFn: infoFetch,
    extract: extractReadable,
    addSource: (d) => addSource(d).then(() => {}),
    onProbeCard,
  });
}

// The shared companion tool set bound live: the source tools plus update_profile.
// Every info chat entry mounts this; the two card sinks let the chat surface the
// trial confirm card and the profile-update confirm card.
export function buildLiveCompanionTools(
  onProbeCard: (card: ProbeConfirmCardData) => void,
  onProfileCard: (card: ProfileUpdateCardData) => void,
): AgentTool[] {
  return buildCompanionTools({
    fetchFn: infoFetch,
    extract: extractReadable,
    addSource: (d) => addSource(d).then(() => {}),
    onProbeCard,
    onProfileCard,
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
