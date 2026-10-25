// The entry check (docs/671 入库检查): a dish enters the library, seed or
// user, only when its reference serving passes every rule. Every number is
// computed here from the ingredients and the food table.

import { foodById, type FoodRole } from "../nutrition/foods";
import { methodById } from "./methods";
import { referenceServing, type Serving } from "./serving";
import { CUISINES, EQUIPMENT, INGREDIENT_ROLES, type Dish, type DishRole, type IngredientRole } from "./types";

export type CheckRule =
  | "unknown_food"
  | "line"
  | "method"
  | "batch_method"
  | "cuisine"
  | "equipment"
  | "staples"
  | "times"
  | "active_time"
  | "scale"
  | "protein_share"
  | "added_fat"
  | "sodium"
  | "added_sugar"
  | "vegetables"
  | "protein_grams";

export interface CheckFailure {
  rule: CheckRule;
  /** One English line naming the rule and the numbers, for the model to fix the dish. */
  message: string;
  /** The ingredient line it is about, when it is about one. */
  food?: string;
  actual?: number;
  limit?: number;
}

export type DishCheck = { ok: true; serving: Serving } | { ok: false; failures: CheckFailure[]; serving: Serving | null };

interface Limits {
  /** Protein kcal share of the serving's kcal; null: not checked. */
  proteinShare: number | null;
  /** The share when a line is a staple (自带主食). */
  proteinShareWithStaple: number | null;
  addedFatG: number;
  sodiumMg: number;
  addedSugarG: number;
  vegG: number | null;
}

export const LIMITS: Readonly<Record<DishRole, Limits>> = {
  main: { proteinShare: 0.3, proteinShareWithStaple: 0.2, addedFatG: 10, sodiumMg: 600, addedSugarG: 10, vegG: 100 },
  breakfast: { proteinShare: 0.2, proteinShareWithStaple: 0.2, addedFatG: 10, sodiumMg: 400, addedSugarG: 10, vegG: null },
  staple: { proteinShare: null, proteinShareWithStaple: null, addedFatG: 5, sodiumMg: 200, addedSugarG: 5, vegG: null },
};

/** Hands-on minutes: a batch pot (waiting unlimited), a fresh meal, a breakfast. */
export const ACTIVE_MIN = { batch: 20, fresh: 15, breakfast: 10 } as const;

/** The food role an ingredient line's role needs. */
const LINE_FOOD_ROLE: Readonly<Record<IngredientRole, FoodRole>> = {
  protein: "protein",
  veg: "veg",
  staple: "staple",
  oil: "fat",
  seasoning: "sauce",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface CheckOptions {
  /** Staple dish ids a dish may name in `staples` besides staple foods. */
  stapleDishIds?: ReadonlySet<string>;
}

export function checkDish(dish: Dish, opts: CheckOptions = {}): DishCheck {
  const fail: CheckFailure[] = [];
  const add = (f: CheckFailure) => fail.push(f);

  for (const line of dish.ingredients) {
    const food = foodById(line.food);
    if (!food) {
      add({ rule: "unknown_food", food: line.food, message: `${line.food} is not in the food table` });
      continue;
    }
    if (!INGREDIENT_ROLES.includes(line.role)) {
      add({ rule: "line", food: line.food, message: `${line.food}: unknown line role ${line.role}` });
    } else if (!food.roles.includes(LINE_FOOD_ROLE[line.role])) {
      add({ rule: "line", food: line.food, message: `${line.food} cannot be a ${line.role} line` });
    }
    if (!(line.grams > 0)) add({ rule: "line", food: line.food, message: `${line.food}: grams must be above 0` });
  }
  if (dish.ingredients.length === 0) add({ rule: "line", message: "the dish has no ingredients" });

  const method = methodById(dish.method);
  if (!method) add({ rule: "method", message: `method ${dish.method} is not in the method table` });
  else if (dish.prep === "batch" && !method.storage) {
    add({ rule: "batch_method", message: `${method.id} (${method.zh}) is made at the meal and cannot be a batch dish` });
  }
  if (!CUISINES.includes(dish.cuisine)) add({ rule: "cuisine", message: `cuisine ${dish.cuisine} is unknown` });
  for (const e of dish.equipment) {
    if (!EQUIPMENT.includes(e)) add({ rule: "equipment", message: `equipment ${e} is unknown` });
  }
  for (const s of dish.staples) {
    const isFood = foodById(s)?.roles.includes("staple");
    if (!isFood && !opts.stapleDishIds?.has(s)) {
      add({ rule: "staples", message: `staple ${s} is neither a staple food nor a staple dish` });
    }
  }

  if (!(dish.activeMin > 0) || !(dish.totalMin >= dish.activeMin)) {
    add({
      rule: "times",
      message: `activeMin ${dish.activeMin} must be above 0 and totalMin ${dish.totalMin} at least that`,
    });
  }
  const activeLimit = dish.role === "breakfast" ? ACTIVE_MIN.breakfast : ACTIVE_MIN[dish.prep];
  if (dish.activeMin > activeLimit) {
    const what = dish.role === "breakfast" ? "a breakfast" : dish.prep === "batch" ? "a batch pot" : "a fresh dish";
    add({
      rule: "active_time",
      message: `hands-on ${dish.activeMin} min is over ${activeLimit} min for ${what}`,
      actual: dish.activeMin,
      limit: activeLimit,
    });
  }

  const serving = referenceServing(dish);
  if (!serving) {
    const by = dish.role === "staple" ? "kcal" : "protein";
    add({ rule: "scale", message: `the ingredients have no ${by} to scale the reference serving by` });
    return { ok: false, failures: fail, serving: null };
  }

  const lim = LIMITS[dish.role];
  const hasStaple = dish.ingredients.some((i) => i.role === "staple");
  const shareMin = hasStaple ? lim.proteinShareWithStaple : lim.proteinShare;
  const share = serving.kcal > 0 ? (serving.protein * 4) / serving.kcal : 0;
  if (shareMin != null && share < shareMin) {
    add({
      rule: "protein_share",
      message: `protein is ${r1(share * 100)}% of kcal, under ${Math.round(shareMin * 100)}%${hasStaple ? " (with a staple)" : ""}`,
      actual: share,
      limit: shareMin,
    });
  }
  if (serving.addedFat > lim.addedFatG) {
    add({
      rule: "added_fat",
      message: `added fat ${r1(serving.addedFat)} g is over ${lim.addedFatG} g`,
      actual: serving.addedFat,
      limit: lim.addedFatG,
    });
  }
  if (serving.sodium > lim.sodiumMg) {
    add({
      rule: "sodium",
      message: `sodium ${Math.round(serving.sodium)} mg is over ${lim.sodiumMg} mg`,
      actual: serving.sodium,
      limit: lim.sodiumMg,
    });
  }
  if (serving.addedSugar > lim.addedSugarG) {
    add({
      rule: "added_sugar",
      message: `added sugar ${r1(serving.addedSugar)} g is over ${lim.addedSugarG} g`,
      actual: serving.addedSugar,
      limit: lim.addedSugarG,
    });
  }
  if (lim.vegG != null && serving.vegG < lim.vegG) {
    add({
      rule: "vegetables",
      message: `vegetables ${Math.round(serving.vegG)} g are under ${lim.vegG} g`,
      actual: serving.vegG,
      limit: lim.vegG,
    });
  }
  for (const line of serving.ingredients) {
    if (line.role !== "protein") continue;
    const f = foodById(line.food);
    if (!f) continue;
    if (line.grams < f.minG || line.grams > f.maxG) {
      add({
        rule: "protein_grams",
        food: line.food,
        message: `${line.food} ${Math.round(line.grams)} g is outside ${f.minG}-${f.maxG} g`,
        actual: line.grams,
        limit: line.grams < f.minG ? f.minG : f.maxG,
      });
    }
  }

  return fail.length ? { ok: false, failures: fail, serving } : { ok: true, serving };
}
