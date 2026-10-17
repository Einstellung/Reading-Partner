// The box as the corner and the conversation see it (docs/68): which items this
// device shows, the count on the badge, and the line under each cover.
//
// Here and not in LumenCorner.tsx because all of it is arithmetic and strings,
// and none of it needs React to be read. Where the cards stand in the
// conversation is box-timeline.ts.

import { t } from "../../../i18n";
import type { BoxItem, BoxOrigin } from "../../../box/types";
import { intakeIdOfItem } from "../../../reading/ingest/intake-box";

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
      const book = title ?? t("shell.box.bookFallback");
      return origin.page === undefined
        ? book
        : t("shell.box.originBookPage", { book, page: origin.page });
    }
    case "door":
      return t("shell.box.originDoor", { date: origin.date });
    case "briefing":
      return t("shell.box.originBriefing", { date: origin.date });
    case "meals":
      return t("shell.box.originMeals");
    case "talk":
      return t("shell.box.originTalk");
    case "retell":
      return t("shell.box.originRetell");
  }
}

/** Every book the cards have to know the name of. */
export function bookIdsIn(items: readonly BoxItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.origin.place === "book") ids.add(item.origin.bookId);
  }
  return [...ids];
}

/** What a reader hears on the case, which opens the conversation like the body does. */
export function caseLabel(openCount: number): string {
  const n = badgeCount(openCount);
  return n === null ? t("shell.box.label") : t("shell.box.waiting", { count: n });
}

// How far sideways a finger has to travel for a card to count as pressed away.
// 64px rather than a fraction of the card: the panel is narrow and the sheet is
// wide, and a shorter throw collides with the conversation's own scroll.
export const SWIPE_DISMISS_PX = 64;

/**
 * Whether a drag was a dismiss. Sideways further than it went up or down, so a
 * finger scrolling the conversation never presses a card away on its way past.
 */
export function isDismissSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_DISMISS_PX && Math.abs(dx) > Math.abs(dy);
}

/**
 * The open items this device shows. Box items sync and intake records do not
 * (link-intakes/ is machine-local), so a link intake's card is shown only on
 * the device that has its record, the one the topic can be picked on; another
 * device neither draws nor counts it. Where one is shown, anything else of the
 * same delivery (the run's bell, about the same link) is left out under it.
 */
export async function cardsHere(
  items: readonly BoxItem[],
  hasIntake: (intakeId: string) => Promise<boolean>,
): Promise<BoxItem[]> {
  const kept: BoxItem[] = [];
  const intakeBoxes = new Set<string>();
  for (const item of items) {
    const intakeId = intakeIdOfItem(item);
    if (intakeId === null) kept.push(item);
    else if (await hasIntake(intakeId).catch(() => false)) {
      kept.push(item);
      intakeBoxes.add(item.boxId);
    }
  }
  return kept.filter((item) => intakeIdOfItem(item) !== null || !intakeBoxes.has(item.boxId));
}
