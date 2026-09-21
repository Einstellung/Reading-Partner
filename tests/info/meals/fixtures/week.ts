// One week of three meals a day, shared by the meals tests. The shape the
// prototype settled on (docs/73): breakfast is a real dish so its oats reach
// the shopping list, a cooked dinner feeds the next day's packed lunch, and the
// week ends on a skipped dinner.

import type {
  Dish,
  Ingredient,
  MealsState,
  ShoppingState,
  WeekPlan,
} from "../../../../src/info/meals/types";
import { EMPTY_SHOPPING } from "../../../../src/info/meals/types";

export const MON = "2026-09-21";

function ing(
  name: string,
  category: Ingredient["category"],
  keeps: Ingredient["keeps"],
  qty = "some",
): Ingredient {
  return { name, en: name, qty, category, keeps };
}

export function dishes(): Dish[] {
  return [
    {
      id: "dish-oats",
      name: "Overnight oats",
      searchName: "overnight oats",
      oneLine: "Soaked the night before.",
      base: "soaked oats",
      fresh: "blueberries",
      keepsADay: true,
      handsOnMinutes: 3,
      ingredients: [ing("oats", "grains", "pantry"), ing("yogurt", "dairy", "w1")],
    },
    {
      id: "dish-stew",
      name: "Chickpea stew",
      searchName: "chickpea stew",
      oneLine: "One pot, keeps a day.",
      base: "chickpea and tomato base",
      fresh: "kale",
      keepsADay: true,
      handsOnMinutes: 14,
      ingredients: [
        ing("chickpeas", "pantry", "pantry"),
        ing("kale", "produce", "d3-5", "2 handfuls"),
      ],
    },
    {
      id: "dish-salmon",
      name: "Sheet pan salmon",
      searchName: "sheet pan salmon",
      oneLine: "One tray.",
      base: "",
      fresh: "lemon",
      keepsADay: false,
      handsOnMinutes: 10,
      ingredients: [ing("salmon", "protein", "d1-2", "2 fillets")],
    },
  ];
}

export function week(): WeekPlan {
  const out = (place: string) => ({ mode: "out" as const, place });
  return {
    id: `week-${MON}`,
    startDate: MON,
    breakfastLine: "Oats most days, something on the way on Friday",
    days: [
      {
        date: "2026-09-21",
        breakfast: { mode: "cook", dishId: "dish-oats" },
        lunch: { mode: "packed", dishId: "dish-stew", note: "last week's box" },
        dinner: { mode: "cook", dishId: "dish-stew" },
      },
      {
        date: "2026-09-22",
        breakfast: { mode: "cook", dishId: "dish-oats" },
        lunch: {
          mode: "packed",
          dishId: "dish-stew",
          reheatOf: { date: "2026-09-21", meal: "dinner" },
        },
        dinner: { mode: "cook", dishId: "dish-salmon" },
      },
      {
        date: "2026-09-23",
        breakfast: { mode: "bought", place: "coffee on the way" },
        lunch: out("the canteen"),
        dinner: { mode: "delivery", place: "the usual place" },
      },
      {
        date: "2026-09-24",
        breakfast: { mode: "cook", dishId: "dish-oats" },
        lunch: out("the canteen"),
        dinner: out("with friends"),
      },
      {
        date: "2026-09-25",
        breakfast: { mode: "cook", dishId: "dish-oats" },
        lunch: out("the canteen"),
        dinner: out("with friends"),
      },
      {
        date: "2026-09-26",
        breakfast: { mode: "cook", dishId: "dish-oats" },
        lunch: out("the canteen"),
        dinner: out("with friends"),
      },
      {
        date: "2026-09-27",
        breakfast: { mode: "cook", dishId: "dish-oats" },
        lunch: out("the canteen"),
        dinner: { mode: "skip", note: "late lunch" },
      },
    ],
    dishes: dishes(),
    createdAt: 1,
    revision: 1,
  };
}

export function shopping(over: Partial<ShoppingState> = {}): ShoppingState {
  return { ...EMPTY_SHOPPING, items: [], reader: [], dropped: {}, replaced: {}, checked: {}, ...over };
}

export function state(over: Partial<MealsState> = {}): MealsState {
  return {
    charter: null,
    plan: week(),
    shopping: shopping(),
    deviations: [],
    ...over,
  };
}
