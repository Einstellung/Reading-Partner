// The box in the companion's conversation (docs/68, 2026-10-15): which open items are
// drawn as cards in the day's timeline, and where among the rows.
//
// Today's conversation shows every item still in the box, the ones left from
// earlier days included, each at the moment it arrived; an item from before the
// first line of the day stands above it. An earlier day opened from a card is
// that day as it was, with no box in it.
//
// An item whose own card is already a row of the conversation is not drawn a
// second time: a link intake's item is the intake card itself on the day the
// link was taken (and what cardsHere folded under it goes with it).
//
// The rows made here are for drawing only. The conversation the model is sent
// and the file the day is written to are the hook's own rows, never these.

import type { BoxItemCard } from "../../../box/card";
import type { BoxItem } from "../../../box/types";
import { intakeIdOfItem } from "../../../reading/ingest/intake-box";
import { cardRow, messageToParts } from "../chat/chatParts";
import type { ThreadMessage } from "../chat/types";
import { staysUntilDecided } from "./box-jump";

/** The prefix a box card's id carries, so the host can tell its gestures apart. */
export const BOX_CARD_ID_PREFIX = "box:";

export function boxCardId(itemId: string): string {
  return `${BOX_CARD_ID_PREFIX}${itemId}`;
}

/** The item a card id names, or null for any other card. */
export function itemIdOfBoxCard(cardId: string): string | null {
  return cardId.startsWith(BOX_CARD_ID_PREFIX) ? cardId.slice(BOX_CARD_ID_PREFIX.length) : null;
}

/** The intakes whose cards are rows of this conversation. */
function intakesDrawn(messages: readonly ThreadMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    for (const part of messageToParts(m)) {
      if (part.type === "card" && part.card.kind === "link-intake") ids.add(part.card.intakeId);
    }
  }
  return ids;
}

/**
 * The items drawn as cards in a conversation, oldest first. `items` is what
 * this device shows (box-cards.ts cardsHere); `today` is whether the
 * conversation open is today's.
 */
export function timelineItems(
  items: readonly BoxItem[],
  messages: readonly ThreadMessage[],
  today: boolean,
): BoxItem[] {
  if (!today) return [];
  const drawn = intakesDrawn(messages);
  const hiddenBoxes = new Set<string>();
  for (const item of items) {
    const intakeId = intakeIdOfItem(item);
    if (intakeId !== null && drawn.has(intakeId)) hiddenBoxes.add(item.boxId);
  }
  return items
    .filter((item) => !hiddenBoxes.has(item.boxId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** The card one item is drawn as. */
export function boxCardPayload(item: BoxItem, titles: Readonly<Record<string, string>>): BoxItemCard {
  return {
    kind: "box-item",
    item,
    bookTitle: item.origin.place === "book" ? (titles[item.origin.bookId] ?? null) : null,
    pinned: staysUntilDecided(item),
  };
}

/**
 * The rows drawn: the conversation's own, with a card row for each item at the
 * moment it arrived. A card never goes below a reply still being written or a
 * line still queued for the running turn — those are the live edge of the
 * conversation and stay at the bottom.
 */
export function withBoxCards(
  messages: readonly ThreadMessage[],
  items: readonly BoxItem[],
  titles: Readonly<Record<string, string>>,
): ThreadMessage[] {
  if (items.length === 0) return messages as ThreadMessage[];
  const out: ThreadMessage[] = [];
  let next = 0;
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const m of messages) {
    const live = m.streaming === true || m.queued === true;
    while (next < sorted.length && (live || sorted[next].createdAt <= m.ts)) {
      out.push(cardRow(boxCardId(sorted[next].id), boxCardPayload(sorted[next], titles), sorted[next].createdAt));
      next++;
    }
    out.push(m);
  }
  for (; next < sorted.length; next++) {
    out.push(cardRow(boxCardId(sorted[next].id), boxCardPayload(sorted[next], titles), sorted[next].createdAt));
  }
  return out;
}
