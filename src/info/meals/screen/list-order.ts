// The order the shopping list is drawn in, and the words above it (docs/73).
//
// The list is held in one hand in a shop, and a line that moves out from under
// the thumb is how a trip loses its place. So the order is a snapshot: it is
// settled when the screen opens and honoured for as long as it stays open, and
// ticking a line changes the box and the count, never where the line is. The
// ticked lines sink the next time the screen is opened.
//
// Pure, and apart from the .tsx, so the rule can be tested without React.

import { currentList, isChecked, leftToBuy, missed, shoppingItemKey, stillToGet } from "../plan/shopping";
import { CATEGORY_ORDER, type IngredientCategory, type ShoppingItem, type ShoppingState } from "../plan/types";
import { categoryLabel, weekdayName } from "./view";

/** One aisle, as the screen draws it. */
export interface ShoppingAisle {
  category: IngredientCategory;
  label: string;
  items: ShoppingItem[];
}

/**
 * The order to draw the list in, as the line keys from first to last.
 *
 * With no previous order this is the list settled: aisles in CATEGORY_ORDER,
 * and inside an aisle the ticked lines sunk to the bottom in the order they
 * were already in. With one, every line the screen has already shown keeps the
 * place it had, and a line that was not there — one the reader added by talking
 * while the screen was open — goes to the end of its aisle.
 */
export function orderShoppingLines(
  state: ShoppingState,
  previous?: readonly string[],
): string[] {
  const list = currentList(state);
  const seen = previous ? new Map(previous.map((key, i) => [key, i])) : null;
  const keys: string[] = [];
  for (const category of CATEGORY_ORDER) {
    const mine = list.filter((i) => i.category === category);
    if (!mine.length) continue;
    const ordered = seen
      ? [
          ...mine
            .filter((i) => seen.has(shoppingItemKey(i)))
            .sort((a, b) => (seen.get(shoppingItemKey(a)) ?? 0) - (seen.get(shoppingItemKey(b)) ?? 0)),
          ...mine.filter((i) => !seen.has(shoppingItemKey(i))),
        ]
      : [
          ...mine.filter((i) => !isChecked(state, i)),
          ...mine.filter((i) => isChecked(state, i)),
        ];
    for (const item of ordered) keys.push(shoppingItemKey(item));
  }
  return keys;
}

/** The lines of the list, flat, in a settled order. */
export function linesInOrder(
  state: ShoppingState,
  order: readonly string[],
): ShoppingItem[] {
  const byKey = new Map(currentList(state).map((i) => [shoppingItemKey(i), i]));
  const out: ShoppingItem[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    if (item) {
      out.push(item);
      byKey.delete(key);
    }
  }
  // A line the order does not know about is still on the list, and the list is
  // what is bought. It goes last rather than nowhere.
  for (const item of byKey.values()) out.push(item);
  return out;
}

/** The aisles, in a settled order, of whichever lines are given. */
export function aislesOf(items: readonly ShoppingItem[]): ShoppingAisle[] {
  const out: ShoppingAisle[] = [];
  for (const category of CATEGORY_ORDER) {
    const mine = items.filter((i) => i.category === category);
    if (!mine.length) continue;
    out.push({ category, label: categoryLabel(category), items: mine });
  }
  return out;
}

/**
 * What the Shopping card says beside its title: how much is left before the
 * trip, and afterwards that it happened — plus anything added since that the
 * reader said they would pick up on the way.
 */
export function shoppingStatus(state: ShoppingState, lines: readonly ShoppingItem[]): string {
  const done = state.doneOn;
  if (!done) return `${leftToBuy(state, lines)} left`;
  const toGet = stillToGet(state, lines).length;
  return `Bought · ${weekdayName(done)}${toGet ? ` · ${toGet} to get` : ""}`;
}

/** The three lines the card previews, and the line of text under them. */
export interface ShoppingPreview {
  items: ShoppingItem[];
  more: string | null;
}

export function shoppingPreview(
  state: ShoppingState,
  lines: readonly ShoppingItem[],
  limit = 3,
): ShoppingPreview {
  const done = state.doneOn;
  if (done) {
    const toGet = stillToGet(state, lines);
    if (toGet.length) return { items: toGet.slice(0, limit), more: null };
    const missedCount = missed(state, lines).length;
    return {
      items: [],
      more: missedCount ? `${missedCount} you didn't get` : "Everything on the list.",
    };
  }
  const left = lines.filter((i) => !isChecked(state, i));
  const rest = Math.max(0, left.length - limit);
  return { items: left.slice(0, limit), more: rest ? `and ${rest} more` : null };
}

// A list longer than this puts its Done button on a bar that follows the thumb
// down the screen instead of waiting at the foot of two dozen lines.
export const LONG_LIST = 8;
