// Chat-card payloads for the reading domain (docs/17's parts protocol). Kept in
// the domain, like info/briefing/cards.ts, so the tool that produces one and the
// component that renders it import the same definition and the dependency
// direction stays components -> reading.

import type { TalkSegment, TalkSpine } from "../talk";
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

// Shown when the arrangement writes to the talk outline (docs/44). One card per
// write, and a write is bounded to one thing, so the reader reads the card and
// knows what landed: a spine, a segment, a segment dropped, a segment moved.
//
// Four variants under one kind rather than four kinds: they are the same receipt
// for the same act, raised by the same stage of the conversation, and the
// registry keys on `kind`, so one component draws all four.
//
// Read-only like the decision card. The talk is corrected by saying so.
export type TalkArrangementCardData =
  | { kind: "talk-arrangement"; change: "spine"; spine: TalkSpine }
  | {
      kind: "talk-arrangement";
      change: "segment";
      // The segment as it now stands, without updatedAt: the card is what was
      // written, and the clock is not part of that.
      segment: Omit<TalkSegment, "updatedAt">;
      // The title of the segment this one pays back. The segment itself carries
      // only that segment's id, which is nothing the reader can read.
      callbackTitle?: string;
      // 1-based, the way the talk is counted out loud.
      position: number;
      total: number;
    }
  | { kind: "talk-arrangement"; change: "removed"; title: string; total: number }
  | {
      kind: "talk-arrangement";
      change: "moved";
      title: string;
      position: number;
      total: number;
    };

// Every card the reading side contributes to the chat's payload union.
export type ReadingCard = RetellDecisionCardData | TalkArrangementCardData;
