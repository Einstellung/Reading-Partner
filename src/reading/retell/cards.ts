// Chat-card payloads for the reading domain (docs/17's parts protocol). Kept in
// the domain, like info/briefing/cards.ts, so the tool that produces one and the
// component that renders it import the same definition and the dependency
// direction stays components -> reading.

import type { TalkArrangementCardData } from "../talk/cards";
import type { PlanDecision } from "./types";

// Shown when record_chapter_decision writes a chapter's decision. Durable: it is
// the reader's receipt for a chapter, and a retell is spread over sittings,
// so a reopened thread has to still show what was settled.
//
// Read-only by design. Correcting a decision is a sentence to the AI, not a
// button on the card (the conversation is the correction UI); the card exists so
// the reader can see what was written down without being asked to trust it.
export interface RetellDecisionCardData extends Omit<PlanDecision, "updatedAt"> {
  kind: "retell-decision";
}

// The card a write to the talk outline raises is defined beside the tools that
// raise it (reading/talk/cards.ts) — the coach raises the same one — and passes
// through here so the chat's payload union stays one import for the components.
export type { TalkArrangementCardData };

// Every card the reading side contributes to the chat's payload union.
export type ReadingCard = RetellDecisionCardData | TalkArrangementCardData;
