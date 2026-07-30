// The add-source flow's chat-card payloads (docs/17). Transient UI data (never
// persisted, like the tool trace), kept here rather than with the briefing's own
// cards because the source tools build them and the briefing only folds them into
// the InfoCard union it renders. Both the tools and the card components import
// this one definition, matching the components -> info dependency direction.

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
