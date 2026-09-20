// The shopping list derived from a week (src/info/dinner/shopping.ts).
//
// The list is the one product of this line the reader holds in one hand in a
// shop, so every rule it is built on is asserted here: what a reheat day buys
// (nothing), what two dishes wanting the same thing become (one line), what
// order a store is walked in, and which raw protein is frozen on the way in.
// Run: scripts/t.sh tests/info/dinner

import { expect, test } from "bun:test";
import {
  deriveShoppingList,
  reconcileShoppingList,
  setShoppingChecked,
  shoppingItemKey,
} from "../../../src/info/dinner/shopping";
import type { Dish, Ingredient, WeekPlan } from "../../../src/info/dinner/types";

const MON = "2026-09-21";

function ing(over: Partial<Ingredient> & { name: string }): Ingredient {
  return { en: "", qty: "1", category: "produce", keeps: "d3-5", ...over };
}

function dish(id: string, ingredients: Ingredient[], over: Partial<Dish> = {}): Dish {
  return {
    id,
    name: id,
    searchName: id,
    oneLine: "",
    base: "base",
    fresh: "",
    keepsADay: true,
    handsOnMinutes: 12,
    ingredients,
    ...over,
  };
}

// Monday cooks, Tuesday reheats it, Wednesday is delivery, Thursday cooks
// again, and Sunday cooks the fish.
function week(dishes: Dish[]): WeekPlan {
  return {
    id: `week-${MON}`,
    startDate: MON,
    days: [
      { date: "2026-09-21", mode: "cook", dishId: "dish-a" },
      { date: "2026-09-22", mode: "reheat", reheatOf: "2026-09-21", freshAdd: "greens" },
      { date: "2026-09-23", mode: "delivery", place: "the noodle place" },
      { date: "2026-09-24", mode: "cook", dishId: "dish-b" },
      { date: "2026-09-25", mode: "reheat", reheatOf: "2026-09-24" },
      { date: "2026-09-26", mode: "out", place: "the canteen" },
      { date: "2026-09-27", mode: "cook", dishId: "dish-c" },
    ],
    dishes,
    createdAt: 1,
    revision: 1,
  };
}

test("only cook days buy anything; out, delivery and reheat buy nothing of their own", () => {
  const list = deriveShoppingList(
    week([dish("dish-a", [ing({ name: "chicken", category: "protein", keeps: "d1-2" })])]),
    MON,
  );
  expect(list.map((i) => i.name)).toEqual(["chicken"]);
  expect(list[0]?.neededBy).toBe("2026-09-21");
});

test("the same thing wanted by two dishes is one line, quantities joined and the earliest day kept", () => {
  const list = deriveShoppingList(
    week([
      dish("dish-a", [ing({ name: "Olive oil", category: "pantry", keeps: "pantry", qty: "1 tbsp" })]),
      dish("dish-b", [ing({ name: "olive oil ", category: "pantry", keeps: "pantry", qty: "2 tbsp" })]),
    ]),
    MON,
  );
  expect(list).toHaveLength(1);
  expect(list[0]?.qty).toBe("1 tbsp + 2 tbsp");
  expect(list[0]?.neededBy).toBe("2026-09-21");
});

test("an identical quantity is not repeated, and the shorter shelf life wins the merge", () => {
  const list = deriveShoppingList(
    week([
      dish("dish-a", [ing({ name: "spinach", keeps: "w1", qty: "1 bag" })]),
      dish("dish-b", [ing({ name: "spinach", keeps: "d3-5", qty: "1 bag" })]),
    ]),
    MON,
  );
  expect(list[0]?.qty).toBe("1 bag");
  expect(list[0]?.keeps).toBe("d3-5");
});

test("raw protein that keeps a day or two and is needed two days out is frozen on arrival", () => {
  const list = deriveShoppingList(
    week([
      dish("dish-a", [ing({ name: "chicken", category: "protein", keeps: "d1-2" })]),
      dish("dish-c", [ing({ name: "sea bass", category: "protein", keeps: "d1-2" })]),
    ]),
    MON,
  );
  const byName = Object.fromEntries(list.map((i) => [i.name, i]));
  // Cooked tonight: it goes in the fridge.
  expect(byName.chicken?.freezeOnArrival).toBe(false);
  // Cooked on Sunday: it would be six days past its window.
  expect(byName["sea bass"]?.freezeOnArrival).toBe(true);
});

test("only raw protein is frozen — a vegetable with a short window is not", () => {
  const list = deriveShoppingList(
    week([dish("dish-c", [ing({ name: "basil", category: "produce", keeps: "d1-2" })])]),
    MON,
  );
  expect(list[0]?.freezeOnArrival).toBe(false);
});

test("the list walks the store by category, shortest shelf life first inside one", () => {
  const list = deriveShoppingList(
    week([
      dish("dish-a", [
        ing({ name: "rice", category: "grains", keeps: "pantry" }),
        ing({ name: "carrots", category: "produce", keeps: "w2plus" }),
        ing({ name: "lettuce", category: "produce", keeps: "d3-5" }),
        ing({ name: "yoghurt", category: "dairy", keeps: "w1" }),
        ing({ name: "mince", category: "protein", keeps: "d1-2" }),
      ]),
    ]),
    MON,
  );
  expect(list.map((i) => i.name)).toEqual([
    "lettuce",
    "carrots",
    "mince",
    "yoghurt",
    "rice",
  ]);
});

test("a re-derived list keeps what was already ticked off, and drops what the week no longer wants", () => {
  const before = deriveShoppingList(
    week([dish("dish-a", [ing({ name: "lettuce" }), ing({ name: "carrots" })])]),
    MON,
  );
  const ticked = setShoppingChecked(before, shoppingItemKey({ name: "lettuce", category: "produce" }), true);
  const after = reconcileShoppingList(
    ticked,
    deriveShoppingList(week([dish("dish-a", [ing({ name: "lettuce" }), ing({ name: "tofu" })])]), MON),
  );
  expect(after.map((i) => [i.name, i.checked])).toEqual([
    ["lettuce", true],
    ["tofu", false],
  ]);
});

test("a day naming a dish the plan does not carry buys nothing rather than throwing", () => {
  expect(deriveShoppingList(week([]), MON)).toEqual([]);
});
