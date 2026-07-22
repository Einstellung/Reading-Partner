// Chat-card payloads for the info add-source flow (docs/17). These are transient
// UI data (never persisted, like the tool trace): a trial's result shown for
// confirmation, and the first briefing's readiness/failure. Kept in the info
// layer (not components/) so both the source tools and the card components import
// one definition, matching the components -> info dependency direction.

import type { SourceDescriptor } from "./descriptor";
import type { CollectProgress } from "./pipeline";

export interface TrialSample {
  title: string;
  // Plain-text characters obtained for the article (body, else summary).
  chars: number;
  // True when the full body was retrieved (not a headline/summary only).
  fullText: boolean;
}

// Shown after trial_source fetches 3 articles: the candidate source, its pipe
// type in plain words, the samples, and an "Add source" button. `added` flips
// once the user adds it so the button disables.
export interface ProbeConfirmCardData {
  kind: "probe-confirm";
  descriptor: SourceDescriptor;
  pipeLabel: string;
  samples: TrialSample[];
  added?: boolean;
}

// A persistent progress card shown while the first briefing generates in the
// background: it updates in place from the pipeline snapshot (collection counts,
// then triage liveness) so the user always sees the run is alive. It does not
// scroll away — it stays in the flow and becomes the ready/failed card on finish.
export interface BriefingProgressCardData {
  kind: "briefing-progress";
  phase: "fetching" | "triaging";
  // Collection counts (present from the fetching phase onward).
  collect: CollectProgress | null;
  // Triage streaming liveness, once the AI call starts.
  triage: { startedAt: number; chars: number; attempt: number; attempts: number } | null;
  // Heading; onboarding uses "Building your first briefing".
  title?: string;
}

// Shown when the first briefing finishes generating in the background.
export interface BriefingReadyCardData {
  kind: "briefing-ready";
  date: string;
  worth: number;
  oneLiners: number;
  filtered: number;
}

// Shown when the first briefing generation fails (network / no provider).
export interface BriefingFailedCardData {
  kind: "briefing-failed";
  message: string;
}

export type InfoCard =
  | ProbeConfirmCardData
  | BriefingProgressCardData
  | BriefingReadyCardData
  | BriefingFailedCardData;
