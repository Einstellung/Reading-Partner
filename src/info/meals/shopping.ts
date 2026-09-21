// The shopping trip (docs/73 采购单). One trip a week, derived by the program
// from the week and never written by the model: it is the one product of this
// line that the reader holds in one hand in a shop, and a merge or an order the
// model got creative with is a second trip.
//
// Four pieces, kept apart so a re-derive cannot lose the reader's edits: the
// derived lines, the lines they asked for, the overrides on derived lines, and
// the ticks. `currentList` is the only thing that puts them together, and it is
// pure.

import {
  CATEGORY_ORDER,
  EMPTY_SHOPPING,
  KEEPS_ORDER,
  MEAL_KEYS,
  type Ingredient,
  type ShoppingItem,
  type ShoppingState,
  type WeekPlan,
} from "./types";
import { daysBetween } from "./week";

// How many days ahead a thing that keeps a day or two has to be needed before
// it is bought frozen rather than fresh. Two: bought today, cooked the day
// after tomorrow, which is already past the FoodKeeper window for raw meat and
// fish (diet.md 1–2 天：生鸡肉、肉糜、鱼虾).
const FREEZE_AFTER_DAYS = 2;

/** One line of the list. Identity is the aisle and the name, never the index. */
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
 * Only a meal that cooks buys anything, and any of the three may: breakfast,
 * lunch and dinner are read the same way. A reheat and a packed box eat a base
 * that is already bought, and their fresh part is listed among that dish's
 * ingredients (docs/73); out, delivery, bought and skip buy nothing at all.
 *
 * The order is the walk through a shop — categories in aisle order — and inside
 * a category the shortest shelf life first, so what has to be eaten early is
 * also what is reached for first when the bags are unpacked.
 */
export function deriveShoppingList(plan: WeekPlan, today: string): ShoppingItem[] {
  const byKey = new Map<string, ShoppingItem>();

  for (const day of plan.days) {
    for (const key of MEAL_KEYS) {
      const meal = day[key];
      if (meal.mode !== "cook" || !meal.dishId) continue;
      const dish = plan.dishes.find((d) => d.id === meal.dishId);
      if (!dish) continue;
      for (const ing of dish.ingredients) {
        const name = ing.name.trim();
        if (!name) continue;
        const itemKey = shoppingItemKey({ name, category: ing.category });
        const seen = byKey.get(itemKey);
        if (!seen) {
          byKey.set(itemKey, {
            name,
            en: ing.en.trim(),
            qty: ing.qty.trim(),
            category: ing.category,
            keeps: ing.keeps,
            freezeOnArrival: false,
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
 * The list as it stands: the derived lines with the reader's edits over them,
 * then the lines the reader asked for.
 *
 * A dropped line is gone. A replaced line keeps its aisle, its shelf life and
 * the day it is needed by — the reader swapped what goes in the basket, not
 * when it is wanted — and takes the new name, English name and quantity. Ticks
 * are read off `checked` by the key of the line as it ends up, so a tick
 * follows a swap rather than being lost with the name it was made under.
 */
export function currentList(state: ShoppingState): ShoppingItem[] {
  const out: ShoppingItem[] = [];
  for (const item of state.items) {
    const key = shoppingItemKey(item);
    if (state.dropped[key]) continue;
    const swap = state.replaced[key];
    out.push(swap ? { ...item, ...swap } : { ...item });
  }
  for (const item of state.reader) out.push({ ...item });
  return out;
}

/** Whether a line has been ticked off, by the list's own ticks. */
export function isChecked(state: ShoppingState, item: ShoppingItem): boolean {
  return state.checked[shoppingItemKey(item)] === true;
}

/** The lines still to be bought. The only count the list shows. */
export function leftToBuy(state: ShoppingState): number {
  return currentList(state).filter((i) => !isChecked(state, i)).length;
}

/** Lines added after the trip was called done, not yet picked up. */
export function stillToGet(state: ShoppingState): ShoppingItem[] {
  return currentList(state).filter((i) => i.afterDone && !isChecked(state, i));
}

/** Lines the trip was supposed to bring home and did not. */
export function missed(state: ShoppingState): ShoppingItem[] {
  return currentList(state).filter((i) => !i.afterDone && !isChecked(state, i));
}

/**
 * The week's lines re-derived, the reader's half untouched.
 *
 * An adjustment re-derives from the plan, and a list that came back unticked
 * would have the reader walk the shop again — so the ticks are not in the
 * lines. They are their own map, keyed the same way, and a line that survives
 * the adjustment simply finds its key still ticked.
 */
export function reconcileShoppingList(
  state: ShoppingState,
  derived: readonly ShoppingItem[],
): ShoppingState {
  return { ...state, items: [...derived] };
}

/** Tick or untick one line. */
export function setShoppingChecked(
  state: ShoppingState,
  key: string,
  checked: boolean,
): ShoppingState {
  const next = { ...state.checked };
  if (checked) next[key] = true;
  else delete next[key];
  return { ...state, checked: next };
}

/**
 * Add a line the reader asked for. Theirs, so a re-derive leaves it alone.
 *
 * `afterDone` is set when the trip has already been called done: the aisles
 * were walked, so this line is not part of the walk. Nothing else about the
 * trip changes — one trip a week is the shape (docs/73).
 */
export function addReaderItem(state: ShoppingState, item: ShoppingItem): ShoppingState {
  const key = shoppingItemKey(item);
  if (state.reader.some((i) => shoppingItemKey(i) === key)) return state;
  const line: ShoppingItem = { ...item, source: "reader" };
  if (state.doneOn) line.afterDone = true;
  else delete line.afterDone;
  return { ...state, reader: [...state.reader, line] };
}

/**
 * Take a line off the list by name. A line the reader added is removed; a
 * derived line is recorded as dropped, because the next derivation would put
 * it straight back.
 *
 * Null when the list has no such name, which the tool says rather than
 * pretending something was removed.
 */
export function removeShoppingItem(
  state: ShoppingState,
  name: string,
): { state: ShoppingState; removed: ShoppingItem } | null {
  const wanted = name.trim().toLowerCase();
  const list = currentList(state);
  const hit = list.find((i) => i.name.trim().toLowerCase() === wanted);
  if (!hit) return null;
  if (hit.source === "reader") {
    return {
      state: { ...state, reader: state.reader.filter((i) => i.name.trim().toLowerCase() !== wanted) },
      removed: hit,
    };
  }
  // The key of the derived line, which is what `dropped` is keyed by — a
  // replaced line is dropped under the name it was derived as, not the one on
  // screen.
  const source = state.items.find((i) => {
    const key = shoppingItemKey(i);
    const swap = state.replaced[key];
    return (swap?.name ?? i.name).trim().toLowerCase() === wanted;
  });
  if (!source) return null;
  return {
    state: { ...state, dropped: { ...state.dropped, [shoppingItemKey(source)]: true } },
    removed: hit,
  };
}

/**
 * Swap a derived line for something else. Held as an override on the derived
 * line rather than written into it, so the next derivation still finds the line
 * it derived and still finds the reader's swap over it.
 *
 * Null when nothing on the list is called that.
 */
export function replaceShoppingItem(
  state: ShoppingState,
  from: string,
  to: { name: string; en: string; qty?: string },
): { state: ShoppingState; line: ShoppingItem } | null {
  const wanted = from.trim().toLowerCase();
  const source = state.items.find((i) => {
    const key = shoppingItemKey(i);
    if (state.dropped[key]) return false;
    const swap = state.replaced[key];
    return (swap?.name ?? i.name).trim().toLowerCase() === wanted;
  });
  if (!source) return null;
  const key = shoppingItemKey(source);
  const swap = {
    name: to.name.trim(),
    en: to.en.trim().toLowerCase(),
    category: source.category,
    keeps: source.keeps,
    qty: (to.qty ?? "").trim() || source.qty,
  };
  return {
    state: { ...state, replaced: { ...state.replaced, [key]: swap } },
    line: { ...source, ...swap },
  };
}

/** Call the trip done. Nothing reopens it in this slice (docs/73). */
export function markShoppingDone(state: ShoppingState, date: string): ShoppingState {
  return { ...state, doneOn: date };
}

/** An empty trip, for a week that has none yet. */
export function emptyShopping(): ShoppingState {
  return { ...EMPTY_SHOPPING, items: [], reader: [], dropped: {}, replaced: {}, checked: {} };
}

export interface ShoppingGroup {
  category: ShoppingItem["category"];
  items: ShoppingItem[];
}

/**
 * The list as it is drawn: the aisles in the order the derivation already put
 * them in (CATEGORY_ORDER, so one order and not two), and inside each aisle the
 * ticked lines sunk to the bottom in the order they were already in.
 *
 * Sunk rather than hidden: a ticked line is what is in the fridge, and the list
 * is the inventory (docs/73).
 */
export function shoppingGroups(state: ShoppingState): ShoppingGroup[] {
  const list = currentList(state);
  const groups: ShoppingGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const mine = list.filter((i) => i.category === category);
    if (!mine.length) continue;
    groups.push({
      category,
      items: [
        ...mine.filter((i) => !isChecked(state, i)),
        ...mine.filter((i) => isChecked(state, i)),
      ],
    });
  }
  return groups;
}
