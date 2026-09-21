// The shopping list (docs/73). Derived by the program from the week, never
// written by the model: it is the one product of this line that the reader
// holds in one hand in a shop, and a merge or an order the model got creative
// with is a second trip.
//
// Pure. Everything it needs is the plan and the local date the shopping is
// being done on.

import { CATEGORY_ORDER, KEEPS_ORDER, type Ingredient, type ShoppingItem, type WeekPlan } from "./types";
import { daysBetween } from "./week";

// How many days ahead a thing that keeps a day or two has to be needed before
// it is bought frozen rather than fresh. Two: bought today, cooked the day
// after tomorrow, which is already past the FoodKeeper window for raw meat and
// fish (diet.md 1–2 天：生鸡肉、肉糜、鱼虾).
const FREEZE_AFTER_DAYS = 2;

/** One line of the list, as the checked state is carried across a re-derive. */
export function shoppingItemKey(item: { name: string; category: string }): string {
  return `${item.category}\u0000${item.name.trim().toLowerCase()}`;
}

function shorterKeeps(a: Ingredient["keeps"], b: Ingredient["keeps"]): Ingredient["keeps"] {
  return KEEPS_ORDER.indexOf(a) <= KEEPS_ORDER.indexOf(b) ? a : b;
}

function mergeQty(existing: string, next: string): string {
  const add = next.trim();
  if (!add) return existing;
  if (!existing) return add;
  // Identical quantities are not summed — nothing here does arithmetic on a
  // model's "2 handfuls" — but they are not repeated either.
  const parts = existing.split(" + ");
  return parts.includes(add) ? existing : [...parts, add].join(" + ");
}

/**
 * The week's shopping, merged, grouped and ordered.
 *
 * Only cook days buy anything. A reheat day eats the base made the day before
 * and its fresh part is listed among that dish's ingredients (docs/73), so it
 * is already here; out and delivery buy nothing at all.
 *
 * The order is the walk through a shop — categories in aisle order — and inside
 * a category the shortest shelf life first, so what has to be eaten early is
 * also what is reached for first when the bags are unpacked.
 */
export function deriveShoppingList(plan: WeekPlan, today: string): ShoppingItem[] {
  const byKey = new Map<string, ShoppingItem>();

  for (const day of plan.days) {
    if (day.mode !== "cook" || !day.dishId) continue;
    const dish = plan.dishes.find((d) => d.id === day.dishId);
    if (!dish) continue;
    for (const ing of dish.ingredients) {
      const name = ing.name.trim();
      if (!name) continue;
      const key = shoppingItemKey({ name, category: ing.category });
      const seen = byKey.get(key);
      if (!seen) {
        byKey.set(key, {
          name,
          en: ing.en.trim(),
          qty: ing.qty.trim(),
          category: ing.category,
          keeps: ing.keeps,
          freezeOnArrival: false,
          checked: false,
          neededBy: day.date,
        });
        continue;
      }
      seen.qty = mergeQty(seen.qty, ing.qty);
      // Only fills a gap: the first English name this line was given stands.
      if (!seen.en) seen.en = ing.en.trim();
      // The shorter of the two windows, because the list is eaten in this
      // order and the earlier deadline is the one that bites.
      seen.keeps = shorterKeeps(seen.keeps, ing.keeps);
      if (day.date < seen.neededBy) seen.neededBy = day.date;
    }
  }

  const items = [...byKey.values()];
  for (const item of items) {
    const ahead = daysBetween(today, item.neededBy);
    item.freezeOnArrival =
      item.category === "protein" &&
      item.keeps === "d1-2" &&
      ahead !== null &&
      ahead >= FREEZE_AFTER_DAYS;
  }

  return items.sort(compareItems);
}

function compareItems(a: ShoppingItem, b: ShoppingItem): number {
  const cat = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (cat !== 0) return cat;
  const keeps = KEEPS_ORDER.indexOf(a.keeps) - KEEPS_ORDER.indexOf(b.keeps);
  if (keeps !== 0) return keeps;
  if (a.neededBy !== b.neededBy) return a.neededBy < b.neededBy ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * The newly derived list, wearing what the reader already ticked off.
 *
 * An adjustment re-derives the whole list, and a list that came back unticked
 * would have the reader walk the shop again. An item that survives the
 * adjustment keeps its tick; one the new week does not want is simply gone.
 */
export function reconcileShoppingList(
  previous: readonly ShoppingItem[],
  derived: readonly ShoppingItem[],
): ShoppingItem[] {
  const ticked = new Set(
    previous.filter((p) => p.checked).map((p) => shoppingItemKey(p)),
  );
  return derived.map((item) =>
    ticked.has(shoppingItemKey(item)) ? { ...item, checked: true } : item,
  );
}

/** Tick or untick one line. Identity is the name and the category, not the index. */
export function setShoppingChecked(
  items: readonly ShoppingItem[],
  key: string,
  checked: boolean,
): ShoppingItem[] {
  return items.map((item) =>
    shoppingItemKey(item) === key ? { ...item, checked } : item,
  );
}
