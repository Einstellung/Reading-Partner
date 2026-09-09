// Chat-card payloads for the info briefing (docs/17). These are transient UI data
// (never persisted, like the tool trace): the first briefing's progress and its
// readiness/failure, and a drafted profile change. Kept in the info layer (not
// components/) so both the tools and the card components import one definition,
// matching the components -> info dependency direction. The InfoCard union at the
// bottom is the whole set the chat renders, add-source cards included.

import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { CollectProgress } from "../collect/pipeline";

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

// Shown when propose_topic offers a home for what was just kept (docs/21): the
// topic it belongs under — one the reader already has, or a new one — and what
// it adds to that topic. The tool writes nothing; Apply creates the topic where
// it is new, files the article, and files this conversation.
export interface TopicProposalCardData {
  kind: "topic-proposal";
  // The kept article this is about. Absent when the proposal is about the
  // conversation itself and there is nothing kept to file.
  articleId?: string;
  // The conversation the proposal files, so a card read back off disk still
  // knows what it was about.
  threadId: string;
  // An existing topic, or a name for one that does not exist yet.
  topic: { id: string; name: string } | { newName: string };
  // What this material adds to that topic: what it contributes, and whether it
  // confirms or contradicts what the reader has already read.
  meaning: string;
  phase: "draft" | "applied";
}

// Shown when propose_lab drafts a research lab out of the conversation (docs/63
// 章程): its name, the field of view its charter draws, the questions it exists
// to answer, and the sources it claims. The AI drafts the charter and the reader
// nods — there is no form, and corrections are made by talking. The tool writes
// nothing; Apply opens the room and claims the sources.
export interface LabProposalCardData {
  kind: "lab-proposal";
  // The conversation the proposal was made in, so a card read back off disk
  // still knows what it belonged to.
  threadId: string;
  name: string;
  // 视野边界: one paragraph saying what is inside the room's field of view.
  scope: string;
  // The questions the room exists to answer.
  questions: string[];
  // Source descriptor ids the room claims. Resolved against the reader's own
  // list when the card was drafted, and again on Apply.
  sources: string[];
  // The same sources by display name, for the chips on the card. Ids are what
  // Apply writes; a reader reads names.
  sourceNames?: string[];
  phase: "draft" | "applied";
}

// Shown when archive_lab proposes closing a room. The record stays on disk —
// its picture and its cables still name the id — so this is a close, not a
// delete (docs/63 态势归档，不删).
export interface LabArchiveCardData {
  kind: "lab-archive";
  threadId: string;
  labId: string;
  name: string;
  phase: "draft" | "applied";
}

export type InfoCard =
  | ProbeConfirmCardData
  | BriefingProgressCardData
  | BriefingReadyCardData
  | ProfileUpdateCardData
  | TopicProposalCardData
  | LabProposalCardData
  | LabArchiveCardData
  | BriefingFailedCardData;
