// The column that rises from the corner (docs/68): which items are in it, in
// what order, how many of them are on screen, and the line under each cover.
//
// Here and not in LumenCorner.tsx because all of it is arithmetic and strings,
// and none of it needs React to be read.

import type { BoxItem, BoxOrigin } from "../../../box/types";

// Five, and the sixth scrolls. Past five the column is a page, and a page in a
// corner is a screen that opened itself.
export const MAX_VISIBLE_CARDS = 5;

// One card is a cover line over an origin line, which is the 64px the column's
// height is counted in; the gap is the column's own `gap-2`.
export const CARD_PX = 64;
export const CARD_GAP_PX = 8;

export function visibleCardCount(total: number): number {
  return Math.min(Math.max(total, 0), MAX_VISIBLE_CARDS);
}

/** How tall the column may get before it scrolls inside itself. */
export function columnMaxPx(): number {
  return MAX_VISIBLE_CARDS * CARD_PX + (MAX_VISIBLE_CARDS - 1) * CARD_GAP_PX;
}

/**
 * The order of the column. The store hands items back newest first; the ones
 * the reader has to decide something about come up out of that order and keep
 * it among themselves.
 *
 * A copy: the array the store returns is the caller's, and a sort in place
 * would reorder whatever else is holding it.
 */
export function sortBoxCards(items: readonly BoxItem[]): BoxItem[] {
  return [...items].sort((a, b) => Number(b.needsDecision) - Number(a.needsDecision));
}

/**
 * Whether the case stands in the corner. Anything open at all and it does;
 * empty and it is gone, leaving Lumen alone there (docs/68). Not a pose of the
 * body: the case is its own layer beside it, and this is the whole of what the
 * count decides about the picture.
 */
export function showsCase(openCount: number): boolean {
  return openCount > 0;
}

/** The count on the badge, or null when there is nothing to show. */
export function badgeCount(openCount: number): number | null {
  return openCount > 0 ? openCount : null;
}

/**
 * The second line of a card: where the item came from, in the reader's terms.
 * `title` is the library's name for a book, which the caller looks up; a book
 * that has left the shelf still has an item pointing at it, so the line says
 * what it can.
 */
export function originLabel(origin: BoxOrigin, title: string | null): string {
  switch (origin.place) {
    case "book": {
      const book = title ?? "A book";
      return origin.page === undefined ? book : `${book} · p. ${origin.page}`;
    }
    case "door":
      return `At the door · ${origin.date}`;
    case "briefing":
      return `Briefing · ${origin.date}`;
    case "meals":
      return "Meals";
  }
}

/** Every book an open column has to know the name of. */
export function bookIdsIn(items: readonly BoxItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.origin.place === "book") ids.add(item.origin.bookId);
  }
  return [...ids];
}

/** What a reader hears on the case, which is the only control in the corner. */
export function caseLabel(openCount: number): string {
  const n = badgeCount(openCount);
  return n === null ? "The box" : `The box, ${n} waiting`;
}

/** The one line an empty column says. */
export const EMPTY_LINE = "Nothing in the box.";

// How far sideways a finger has to travel for a card to count as pressed away.
// 64px rather than a fraction of the card: the column is one width everywhere,
// and a shorter throw collides with the scroll the column does inside itself.
export const SWIPE_DISMISS_PX = 64;

/**
 * Whether a drag was a dismiss. Sideways further than it went up or down, so a
 * finger scrolling the column never presses a card away on its way past.
 */
export function isDismissSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_DISMISS_PX && Math.abs(dx) > Math.abs(dy);
}
