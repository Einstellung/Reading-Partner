// The one shopping trip (src/info/meals/shopping.ts): what the week's solved
// grams derive, what the reader's edits do over it, and what Done means.
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
import {
  CATEGORY_ORDER,
  KEEPS_ORDER,
  MEAL_KEYS,
  type Meal,
  type ShoppingItem,
  type SolvedItem,
  type WeekPlan,
} from "../../../src/info/meals/types";
import { addDays } from "../../../src/info/meals/week";
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

// A week whose grams are written out rather than solved, so the totals can be
// counted by hand.
function made(solved: SolvedItem[]): Meal {
  return { mode: "make", name: "x", searchName: "x", flavour: "plain", minutes: 5, method: "x", items: [], solved };
}

function handWeek(dinners: Meal[]): WeekPlan {
  const skip: Meal = { mode: "skip" };
  return {
    id: `week-${MON}`,
    startDate: MON,
    createdAt: 0,
    revision: 1,
    days: dinners.map((dinner, i) => ({
      date: addDays(MON, i),
      breakfast: { mode: "bought", place: "on the way", solved: [{ foodId: "egg", role: "protein", grams: 500 }] },
      lunch: skip,
      dinner,
      snack: skip,
    })),
  };
}

const BOK_CHOY = "上海青";

test("every made meal's solved grams, times the people eating, merged into one line per food", () => {
  const plan = week();
  const expected = new Map<string, number>();
  for (const day of plan.days) {
    for (const key of MEAL_KEYS) {
      if (day[key].mode !== "make") continue;
      for (const row of day[key].solved ?? []) expected.set(row.foodId, (expected.get(row.foodId) ?? 0) + row.grams);
    }
  }
  const one = deriveShoppingList(plan, MON);
  expect(one).toHaveLength(expected.size);
  for (const item of one) expect(item.grams).toBe(expected.get(item.foodId!));

  const two = deriveShoppingList(plan, MON, 2);
  for (const item of two) expect(item.grams).toBe(2 * expected.get(item.foodId!)!);
});

test("a line is the food table's: name, English name, aisle, shelf life, and a quantity in grams or units", () => {
  const plan = handWeek([
    made([
      { foodId: "egg", role: "protein", grams: 100 },
      { foodId: "frozen_shrimp", role: "protein", grams: 150 },
    ]),
    made([
      { foodId: "egg", role: "protein", grams: 100 },
      { foodId: "frozen_shrimp", role: "protein", grams: 150 },
    ]),
    made([{ foodId: "egg", role: "protein", grams: 100 }]),
  ]);
  const items = deriveShoppingList(plan, MON, 2);
  // The bought breakfast's grams buy nothing: only made meals shop.
  expect(items.map((i) => [i.foodId, i.grams, i.qty])).toEqual([
    ["egg", 600, "12 个"],
    ["frozen_shrimp", 600, "600 g"],
  ]);
  const egg = items[0]!;
  expect(egg).toMatchObject({ name: "鸡蛋", en: "egg", category: "protein", keeps: "w2plus", neededBy: MON });
  const shrimp = items[1]!;
  expect(shrimp).toMatchObject({ name: "冻虾仁", en: "raw frozen prawns", category: "frozen", keeps: "w2plus" });
});

test("the list walks the shop: aisles in order, shortest shelf life first", () => {
  const items = deriveShoppingList(week(), MON);
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!;
    const b = items[i]!;
    const cat = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    expect(cat).toBeLessThanOrEqual(0);
    if (cat === 0) expect(KEEPS_ORDER.indexOf(a.keeps)).toBeLessThanOrEqual(KEEPS_ORDER.indexOf(b.keeps));
  }
  expect(items[0]!.category).toBe("produce");
});

test("a line is needed by the first meal that wants it, and raw protein two days out is frozen", () => {
  const items = deriveShoppingList(week(), MON);
  const salmon = items.find((i) => i.foodId === "salmon")!;
  // Monday's dinner is the first salmon.
  expect(salmon.neededBy).toBe(MON);
  expect(salmon.freezeOnArrival).toBe(false);
  expect(items.find((i) => i.foodId === "cucumber")!.neededBy).toBe("2026-09-22");

  const earlier = deriveShoppingList(week(), "2026-09-19");
  expect(earlier.find((i) => i.foodId === "salmon")!.freezeOnArrival).toBe(true);
  // Ready-to-eat chicken keeps a week: never frozen however far ahead.
  expect(earlier.find((i) => i.foodId === "ready_chicken_breast")!.freezeOnArrival).toBe(false);
  expect(deriveShoppingList(week(), "2026-09-20").find((i) => i.foodId === "salmon")!.freezeOnArrival).toBe(false);
});

test("currentList: dropped lines go, swaps keep the aisle, reader lines come last", () => {
  const items = deriveShoppingList(week(), MON);
  const bokKey = shoppingItemKey(items.find((i) => i.name === BOK_CHOY)!);
  const bananaKey = shoppingItemKey(items.find((i) => i.name === "香蕉")!);
  let state = shopping({ items });
  state = { ...state, dropped: { [bananaKey]: true } };
  state = {
    ...state,
    replaced: {
      [bokKey]: { name: "菠菜", en: "spinach", category: "produce", keeps: "d3-5", qty: "1 bag" },
    },
  };
  state = addReaderItem(state, reader("洗洁精"));

  const list = currentList(state);
  expect(list).toHaveLength(items.length);
  expect(list.some((i) => i.name === "香蕉")).toBe(false);
  const spinach = list[0]!;
  expect(spinach.name).toBe("菠菜");
  // The swap changed what goes in the basket, not when it is wanted.
  expect(spinach.category).toBe("produce");
  expect(spinach.neededBy).toBe(MON);
  expect(list[list.length - 1]!.name).toBe("洗洁精");
  expect(list[list.length - 1]!.source).toBe("reader");
});

test("a tick is kept outside the lines, so a re-derive keeps it", () => {
  const items = deriveShoppingList(week(), MON);
  const key = shoppingItemKey(items.find((i) => i.name === BOK_CHOY)!);
  let state = setShoppingChecked(shopping({ items }), key, true);
  expect(leftToBuy(state)).toBe(items.length - 1);
  state = reconcileShoppingList(state, deriveShoppingList(week(), "2026-09-22", 2));
  expect(isChecked(state, currentList(state).find((i) => i.name === BOK_CHOY)!)).toBe(true);
  expect(leftToBuy(state)).toBe(items.length - 1);
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

  state = removeShoppingItem(state, BOK_CHOY)!.state;
  expect(currentList(state).some((i) => i.name === BOK_CHOY)).toBe(false);
  // A derived line comes back on the next derivation unless the drop survives.
  state = reconcileShoppingList(state, deriveShoppingList(week(), MON));
  expect(currentList(state).some((i) => i.name === BOK_CHOY)).toBe(false);
  expect(removeShoppingItem(state, "nothing of the sort")).toBeNull();
});

test("replace swaps the line, keeps its quantity, and is still findable by its new name", () => {
  const items = deriveShoppingList(week(), MON);
  const state = shopping({ items });
  const swapped = replaceShoppingItem(state, BOK_CHOY, { name: "菜心", en: "choy sum" })!;
  expect(swapped.line.name).toBe("菜心");
  expect(swapped.line.qty).toBe(items.find((i) => i.name === BOK_CHOY)!.qty);
  const again = removeShoppingItem(swapped.state, "菜心")!;
  expect(currentList(again.state).some((i) => i.name === "菜心")).toBe(false);
  expect(replaceShoppingItem(state, "durian", { name: "x", en: "x" })).toBeNull();
});

test("Done splits what is still to get from what the trip missed", () => {
  const items = deriveShoppingList(week(), MON);
  let state = shopping({ items });
  state = setShoppingChecked(state, shoppingItemKey(items[0]!), true);
  state = addReaderItem(state, reader("milk"));
  state = markShoppingDone(state, MON);
  expect(state.doneOn).toBe(MON);
  // Added before the trip: part of the walk, so it counts as missed.
  expect(missed(state).map((i) => i.name)).toContain("milk");
  expect(missed(state).map((i) => i.name)).not.toContain(items[0]!.name);
  expect(stillToGet(state)).toEqual([]);

  state = addReaderItem(state, reader("batteries"));
  expect(stillToGet(state).map((i) => i.name)).toEqual(["batteries"]);
  expect(stillToGet(state)[0]!.afterDone).toBe(true);
  expect(missed(state).map((i) => i.name)).not.toContain("batteries");
});

test("the same line is not added twice", () => {
  const first = addReaderItem(shopping(), reader("milk"));
  expect(addReaderItem(first, reader("milk"))).toBe(first);
});

test("groups sink the ticked lines inside their aisle", () => {
  const items = deriveShoppingList(week(), MON);
  const key = shoppingItemKey(items.find((i) => i.name === BOK_CHOY)!);
  const produceBefore = shoppingGroups(shopping({ items })).find((g) => g.category === "produce")!;
  expect(produceBefore.items[0]!.name).toBe(BOK_CHOY);
  const state = setShoppingChecked(shopping({ items }), key, true);
  const produce = shoppingGroups(state).find((g) => g.category === "produce")!;
  expect(produce.items[produce.items.length - 1]!.name).toBe(BOK_CHOY);
});
