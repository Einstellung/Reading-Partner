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
  | { step: "go-to-briefing"; date: string }
  | { step: "go-to-meals" }
  // The door conversation of that day, opened over whatever is on screen
  // (lumen/DoorChat.tsx), at the row the card is about when there is one.
  | { step: "open-door-chat"; date: string; focus?: DoorFocus };

/**
 * The row of a door conversation a card goes back to: an intake card, or the
 * reply that answered a run sent off from there (MessageList's data-origin-run).
 */
export type DoorFocus = { intakeId: string } | { runId: string };

// An attribute value as a double-quoted selector string spells it.
function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/** The selector DoorChat finds the focused row by, once the conversation is drawn. */
export function doorFocusSelector(focus: DoorFocus): string {
  return "intakeId" in focus
    ? `[data-intake-id=${quoted(focus.intakeId)}]`
    : `[data-origin-run=${quoted(focus.runId)}]`;
}

/** A focus's identity, for keying the view that opens it. */
export function doorFocusKey(focus: DoorFocus | undefined): string {
  if (!focus) return "";
  return "intakeId" in focus ? `intake:${focus.intakeId}` : `run:${focus.runId}`;
}

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
    // The day's conversation at the door is the door chat (soul/door.ts); no
    // page draws it.
    case "door":
      return { steps: [{ step: "open-door-chat", date: origin.date }], unreachable: null };
    case "briefing":
      return { steps: [{ step: "go-to-briefing", date: origin.date }], unreachable: null };
    case "meals":
      return { steps: [{ step: "go-to-meals" }], unreachable: null };
  }
}

type ItemFacts = Pick<BoxItem, "origin" | "kind" | "body" | "runId">;

/**
 * Where a card goes. One from the door opens that day's door conversation, on
 * every shell, at the row it is about: a link intake's at the intake card, since
 * picking the topic there is the one thing the card is for (docs/68 「收链接」);
 * a run's at the reply that answered it. Anything else goes by origin.
 */
export function planItemJump(item: ItemFacts, place: Place): Jump {
  if (item.origin.place === "door") {
    const intakeId = intakeIdOfItem(item);
    const focus: DoorFocus | null = intakeId ? { intakeId } : item.runId ? { runId: item.runId } : null;
    return {
      steps: [{ step: "open-door-chat", date: item.origin.date, ...(focus ? { focus } : {}) }],
      unreachable: null,
    };
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
