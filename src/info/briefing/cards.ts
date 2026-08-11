// Chat-card payloads for the info briefing (docs/17). These are transient UI data
// (never persisted, like the tool trace): the first briefing's progress and its
// readiness/failure, and a drafted profile change. Kept in the info layer (not
// components/) so both the tools and the card components import one definition,
// matching the components -> info dependency direction. The InfoCard union at the
// bottom is the whole set the chat renders, add-source cards included.

import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { CollectProgress } from "./pipeline";

// A persistent progress card shown while the first briefing generates in the
// background: it updates in place from the pipeline snapshot (collection counts,
// then triage liveness) so the user always sees the run is alive. It does not
// scroll away — it stays in the flow and becomes the ready/failed card on finish.
export interface BriefingProgressCardData {
  kind: "briefing-progress";
  // The funnel phase (docs/35). "fetching" is the article-body step, after
  // screening, not the whole collection.
  phase: "discovering" | "screening" | "fetching" | "triaging";
  // Funnel counts (present from the first phase onward).
  collect: CollectProgress | null;
  // Triage streaming liveness, once the AI call starts.
  triage: { startedAt: number; chars: number; attempt: number; attempts: number } | null;
  // The user pressed Stop and the run is unwinding. The card says so instead of
  // going on counting sources it is no longer collecting.
  stopping?: boolean;
  // Heading; onboarding uses "Building your first briefing".
  title?: string;
}

// Shown when the first briefing finishes generating in the background, or when a
// re-triage settles. `title`/`note` override the onboarding copy for re-triage.
export interface BriefingReadyCardData {
  kind: "briefing-ready";
  date: string;
  worth: number;
  oneLiners: number;
  filtered: number;
  title?: string;
  note?: string;
}

// Shown when update_profile drafts a change to the reading profile. The user
// sees the full proposed profile and applies it explicitly — the tool never
// writes; Apply saves and, when today's briefing exists, offers a re-triage.
export interface ProfileUpdateCardData {
  kind: "profile-update";
  // One line naming the change, written to the user (the card heading).
  summary: string;
  // The complete proposed profile text that Apply saves verbatim.
  profile: string;
  phase: "draft" | "applied";
  // Applied state only: whether a briefing for today exists to re-triage.
  canRetriage?: boolean;
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
  | ProfileUpdateCardData
  | BriefingFailedCardData;
