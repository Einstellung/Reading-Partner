// The one shopping trip (src/info/meals/shopping.ts): what three meals a day
// derive, what the reader's edits do over it, and what Done means.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  addReaderItem,
  currentList,
  deriveShoppingList,
  isChecked,
  leftToBuy,
  markShoppingDone,
  missed,
  reconcileShoppingList,
  removeShoppingItem,
  replaceShoppingItem,
  setShoppingChecked,
  shoppingGroups,
  shoppingItemKey,
  stillToGet,
} from "../../../src/info/meals/shopping";
import type { ShoppingItem } from "../../../src/info/meals/types";
import { MON, shopping, week } from "./fixtures/week";

function reader(name: string): ShoppingItem {
  return {
    name,
    en: name,
    qty: "one",
    category: "other",
    keeps: "pantry",
    freezeOnArrival: false,
    neededBy: "",
  };
}

test("every cooked meal buys, whichever of the three it is", () => {
  const items = deriveShoppingList(week(), MON);
  const names = items.map((i) => i.name);
  // Breakfast's oats and yogurt, dinner's chickpeas and kale, Tuesday's salmon.
  expect(names).toContain("oats");
  expect(names).toContain("yogurt");
  expect(names).toContain("chickpeas");
  expect(names).toContain("kale");
  expect(names).toContain("salmon");
  // A packed lunch and an out lunch buy nothing of their own.
  expect(items).toHaveLength(5);
});

test("the list walks the shop: aisles in order, shortest shelf life first", () => {
  const items = deriveShoppingList(week(), MON);
  expect(items.map((i) => i.category)).toEqual([
    "produce",
    "protein",
    "dairy",
    "grains",
    "pantry",
  ]);
});

test("a line is needed by the first meal that wants it, and raw protein two days out is frozen", () => {
  const items = deriveShoppingList(week(), MON);
  const oats = items.find((i) => i.name === "oats")!;
  expect(oats.neededBy).toBe(MON);
  const salmon = items.find((i) => i.name === "salmon")!;
  expect(salmon.neededBy).toBe("2026-09-22");
  // One day ahead: bought today, cooked tomorrow, no need to freeze.
  expect(salmon.freezeOnArrival).toBe(false);
  const earlier = deriveShoppingList(week(), "2026-09-20");
  expect(earlier.find((i) => i.name === "salmon")!.freezeOnArrival).toBe(true);
});

test("currentList: dropped lines go, swaps keep the aisle, reader lines come last", () => {
  const items = deriveShoppingList(week(), MON);
  const kaleKey = shoppingItemKey(items.find((i) => i.name === "kale")!);
  const oatsKey = shoppingItemKey(items.find((i) => i.name === "oats")!);
  let state = shopping({ items });
  state = { ...state, dropped: { [oatsKey]: true } };
  state = {
    ...state,
    replaced: {
      [kaleKey]: { name: "spinach", en: "spinach", category: "produce", keeps: "d3-5", qty: "1 bag" },
    },
  };
  state = addReaderItem(state, reader("washing up liquid"));

  const list = currentList(state);
  expect(list.map((i) => i.name)).toEqual([
    "spinach",
    "salmon",
    "yogurt",
    "chickpeas",
    "washing up liquid",
  ]);
  const spinach = list[0]!;
  // The swap changed what goes in the basket, not when it is wanted.
  expect(spinach.category).toBe("produce");
  expect(spinach.neededBy).toBe(MON);
  expect(list[4]!.source).toBe("reader");
});

test("a tick is kept outside the lines, so a re-derive keeps it", () => {
  const items = deriveShoppingList(week(), MON);
  const key = shoppingItemKey(items.find((i) => i.name === "kale")!);
  let state = setShoppingChecked(shopping({ items }), key, true);
  expect(leftToBuy(state)).toBe(4);
  state = reconcileShoppingList(state, deriveShoppingList(week(), "2026-09-22"));
  expect(isChecked(state, currentList(state).find((i) => i.name === "kale")!)).toBe(true);
  expect(leftToBuy(state)).toBe(4);
});

test("a re-derive leaves the reader's half alone", () => {
  let state = addReaderItem(shopping({ items: deriveShoppingList(week(), MON) }), reader("milk"));
  state = reconcileShoppingList(state, []);
  expect(currentList(state).map((i) => i.name)).toEqual(["milk"]);
});

test("remove takes a reader line off and drops a derived one", () => {
  const items = deriveShoppingList(week(), MON);
  let state = addReaderItem(shopping({ items }), reader("milk"));
  const gone = removeShoppingItem(state, "milk")!;
  expect(gone.removed.name).toBe("milk");
  expect(currentList(gone.state).some((i) => i.name === "milk")).toBe(false);

  const dropped = removeShoppingItem(state, "kale")!;
  state = dropped.state;
  expect(currentList(state).some((i) => i.name === "kale")).toBe(false);
  // A derived line comes back on the next derivation unless the drop survives.
  state = reconcileShoppingList(state, deriveShoppingList(week(), MON));
  expect(currentList(state).some((i) => i.name === "kale")).toBe(false);
  expect(removeShoppingItem(state, "nothing of the sort")).toBeNull();
});

test("replace swaps the line and is still findable by its new name", () => {
  const state = shopping({ items: deriveShoppingList(week(), MON) });
  const swapped = replaceShoppingItem(state, "kale", { name: "spring onions", en: "spring onions" })!;
  expect(swapped.line.name).toBe("spring onions");
  expect(swapped.line.qty).toBe("2 handfuls");
  const again = removeShoppingItem(swapped.state, "spring onions")!;
  expect(currentList(again.state).some((i) => i.name === "spring onions")).toBe(false);
  expect(replaceShoppingItem(state, "durian", { name: "x", en: "x" })).toBeNull();
});

test("Done splits what is still to get from what the trip missed", () => {
  const items = deriveShoppingList(week(), MON);
  let state = shopping({ items });
  state = setShoppingChecked(state, shoppingItemKey(items[0]!), true);
  state = addReaderItem(state, reader("milk"));
  state = markShoppingDone(state, "2026-09-21");
  expect(state.doneOn).toBe("2026-09-21");
  // Added before the trip: part of the walk, so it counts as missed.
  expect(missed(state).map((i) => i.name)).toContain("milk");
  expect(stillToGet(state)).toEqual([]);

  state = addReaderItem(state, reader("batteries"));
  expect(stillToGet(state).map((i) => i.name)).toEqual(["batteries"]);
  expect(missed(state).map((i) => i.name)).not.toContain("batteries");
});

test("the same line is not added twice", () => {
  const first = addReaderItem(shopping(), reader("milk"));
  expect(addReaderItem(first, reader("milk"))).toBe(first);
});

test("groups sink the ticked lines inside their aisle", () => {
  const items = deriveShoppingList(week(), MON);
  const kale = shoppingItemKey(items.find((i) => i.name === "kale")!);
  const state = setShoppingChecked(shopping({ items }), kale, true);
  const produce = shoppingGroups(state).find((g) => g.category === "produce")!;
  expect(produce.items[produce.items.length - 1]!.name).toBe("kale");
});
