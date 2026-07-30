// Live wiring of the companion tool set (docs/16/17): binds the real fetch
// (infoFetch, browser UA), the readable extractor and the source store to the
// pure companion tools, and takes the host's briefing controller so
// generate_briefing can start a real run. Every info chat entry mounts this.
// Imported only in the webview (extractReadable needs a DOM), never in bun tests.

import { infoFetch } from "../extract/http";
import { extractReadable } from "../extract/readable";
import { addSource } from "../sources/source-store";
import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { ProfileUpdateCardData } from "../briefing/cards";
import { buildCompanionTools, type BriefingScope } from "./companion-tools";
import type { AgentTool } from "../../ai/agent";

// The briefing controller the host hands in so generate_briefing can honestly
// report a run in flight and kick a background job through the host's card
// lifecycle. Kept as a small interface so the pure tool set stays host-agnostic.
export interface BriefingControl {
  running(): boolean;
  start(scope: BriefingScope): void;
}

// The shared companion tool set bound live: the source tools, update_profile, and
// generate_briefing. The two card sinks surface the trial and profile-update
// confirm cards, and the briefing controller drives the regenerate tool.
export function buildLiveCompanionTools(
  onProbeCard: (card: ProbeConfirmCardData) => void,
  onProfileCard: (card: ProfileUpdateCardData) => void,
  briefing: BriefingControl,
): AgentTool[] {
  return buildCompanionTools({
    fetchFn: infoFetch,
    extract: extractReadable,
    addSource: (d) => addSource(d).then(() => {}),
    onProbeCard,
    onProfileCard,
    briefingRunning: briefing.running,
    startBriefing: briefing.start,
  });
}
