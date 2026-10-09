// Where a card goes when it is tapped (docs/68): "点一张跳到原地——是书就开那本
// 书、翻到那页、开那条线程，跨书先开书".
//
// The decision is here and the doing is in the shell, because the two shells do
// it differently and neither of them can be tested. What comes out is a list of
// steps in the order they have to happen; a shell walks it.

import { t } from "../../../i18n";
import type { BoxItem, BoxItemState, BoxOrigin } from "../../../box/types";
import { intakeIdOfItem } from "../../../reading/ingest/intake-box";

export type Shell = "desktop" | "phone";

/** Where the reader is standing when the card is tapped. */
export interface Place {
  shell: Shell;
  /** Desktop only: a book is open. */
  inReader: boolean;
  /** The open book's id, or null when no book is open. */
  openBookId: string | null;
}

export type JumpStep =
  | { step: "open-book"; bookId: string }
  | { step: "go-to-page"; page: number }
  | { step: "open-annotation"; annotationId: string }
  | { step: "open-thread"; bookId: string; threadId: string }
  | { step: "go-to-door"; date: string }
  | { step: "go-to-briefing"; date: string }
  | { step: "go-to-meals" }
  // The door conversation of that day, opened over whatever is on screen, at an
  // intake card (lumen/DoorChat.tsx).
  | { step: "open-door-chat"; date: string; intakeId: string };

export interface Jump {
  steps: JumpStep[];
  /** Why this card cannot be followed here, or null when it can. */
  unreachable: string | null;
}

// The phone has no reader (PhoneApp.tsx), so a card born over a book has
// nowhere to land on it. The card still shows and can still be pressed away —
// what it must not do is fail silently.
export function noReaderHereLine(): string {
  return t("shell.box.notReadable");
}

export function planJump(origin: BoxOrigin, place: Place): Jump {
  switch (origin.place) {
    case "book": {
      if (place.shell === "phone") return { steps: [], unreachable: noReaderHereLine() };
      const steps: JumpStep[] = [];
      // Across books, the book first: the page and the thread are both inside
      // the one being opened.
      if (!place.inReader || place.openBookId !== origin.bookId) {
        steps.push({ step: "open-book", bookId: origin.bookId });
      }
      if (origin.page !== undefined) steps.push({ step: "go-to-page", page: origin.page });
      // A highlight's thread is opened through the highlight, so the reader
      // lands on the mark and not only on the conversation about it.
      steps.push(
        origin.annotationId === undefined
          ? { step: "open-thread", bookId: origin.bookId, threadId: origin.threadId }
          : { step: "open-annotation", annotationId: origin.annotationId },
      );
      return { steps, unreachable: null };
    }
    case "door":
      return { steps: [{ step: "go-to-door", date: origin.date }], unreachable: null };
    case "briefing":
      return { steps: [{ step: "go-to-briefing", date: origin.date }], unreachable: null };
    case "meals":
      return { steps: [{ step: "go-to-meals" }], unreachable: null };
  }
}

type ItemFacts = Pick<BoxItem, "origin" | "kind" | "body">;

/**
 * Where a card goes. A link intake's card opens the door conversation it was
 * raised in, at the intake card, on every shell: picking the topic there is the
 * one thing the card is for (docs/68 「收链接」). Anything else goes by origin.
 */
export function planItemJump(item: ItemFacts, place: Place): Jump {
  const intakeId = intakeIdOfItem(item);
  if (intakeId && item.origin.place === "door") {
    return { steps: [{ step: "open-door-chat", date: item.origin.date, intakeId }], unreachable: null };
  }
  return planJump(item.origin, place);
}

/**
 * Whether a card stays in the box until the reader decides what it asks: a
 * link intake's, until its topic is picked. Following it does not move it and
 * it cannot be pressed away; the pick takes it out (reading/ingest/intake-box.ts).
 */
export function staysUntilDecided(item: Pick<BoxItem, "kind" | "body">): boolean {
  return intakeIdOfItem(item) !== null;
}

/** The state a followed card moves to, or null for one that stays until decided. */
export function stateAfterFollow(item: Pick<BoxItem, "kind" | "body">): BoxItemState | null {
  return staysUntilDecided(item) ? null : "told";
}
