// The chat-card payload a write to the talk outline raises (docs/17's parts
// protocol). It sits beside the tools that raise it (tools.ts) rather than in
// reading/retell, because both conversations that write a talk raise it: the
// retell's arrangement and the coach after a pass.
//
// reading/retell/cards.ts re-exports it into the chat's payload union, which is
// the direction that works — reading/talk imports neither of the domains that
// use it.

import type { TalkSegment, TalkSpine } from "./types";

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
