// A box item as a card in the companion's conversation (docs/68, 2026-10-15). The
// program puts it there, not the companion: it is drawn as a card and never written to
// the conversation's file, and the model never sees it — the cover list in the
// system prompt is all it knows of the box.
//
// The payload is the item as read when the conversation was drawn, plus what
// the host looked up for it. Never persisted, so it may carry the whole item.

import type { BoxItem } from "./types";

export interface BoxItemCard {
  kind: "box-item";
  item: BoxItem;
  /** The shelf's name for the book the item came from, when it came from one. */
  bookTitle: string | null;
  /** Stays until the reader decides (a link intake): no swipe, no ×. */
  pinned: boolean;
}

/** The card's gestures, as the host hears them (CardAction `mutate` ops). */
export const BOX_CARD_FOLLOW_OP = "box-follow";
export const BOX_CARD_DISMISS_OP = "box-dismiss";
