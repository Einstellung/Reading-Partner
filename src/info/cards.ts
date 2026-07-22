// Chat-card payloads for the info add-source flow (docs/17). These are transient
// UI data (never persisted, like the tool trace): a trial's result shown for
// confirmation, and the first briefing's readiness/failure. Kept in the info
// layer (not components/) so both the source tools and the card components import
// one definition, matching the components -> info dependency direction.

import type { SourceDescriptor } from "./descriptor";

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

export type InfoCard = ProbeConfirmCardData | BriefingReadyCardData | BriefingFailedCardData;
