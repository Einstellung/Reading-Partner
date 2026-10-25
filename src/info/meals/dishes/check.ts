// The entry check (docs/671 入库检查): a dish enters the library, seed or
// user, only when its reference serving passes every rule. A batch main is
// checked once per way to eat it (the reference serving plus that way's
// add-ons) and every way must pass. Every number is computed here from the
// ingredients and the food table.

import { foodById, type Food, type FoodRole } from "../nutrition/foods";
import { BREAKFAST_METHODS, methodById } from "./methods";
import { referenceServing, wayServing, type Serving } from "./serving";
import {
  ADD_ON_ROLES,
  CUISINES,
  EQUIPMENT,
  INGREDIENT_ROLES,
  type Dish,
  type DishIngredient,
  type DishRole,
  type IngredientRole,
} from "./types";

export type CheckRule =
  | "unknown_food"
  | "minced_meat"
  | "ground"
  | "line"
  | "method"
  | "batch_method"
  | "fresh_fish"
  | "prep"
  | "breakfast_method"
  | "breakfast_items"
  | "breakfast_protein"
  | "summary"
  | "cuisine"
  | "equipment"
  | "staples"
  | "ways"
  | "times"
  | "active_time"
  | "scale"
  | "protein_share"
  | "added_fat"
  | "sodium"
  | "added_sugar"
  | "vegetables"
  | "real_veg"
  | "deep_veg"
  | "protein_grams";

export interface CheckFailure {
  rule: CheckRule;
  /** One English line naming the rule and the numbers, for the model to fix the dish. */
  message: string;
  /** The ingredient line it is about, when it is about one. */
  food?: string;
  /** Index into `ways` when the failure is about one way. */
  way?: number;
  actual?: number;
  limit?: number;
}

export type DishCheck =
  | { ok: true; serving: Serving; ways: Serving[] }
  | { ok: false; failures: CheckFailure[]; serving: Serving | null; ways: Serving[] };

interface Limits {
  /** Protein kcal share of the serving's kcal; null: not checked. */
  proteinShare: number | null;
  /** The share when a line is a staple (自带主食). */
  proteinShareWithStaple: number | null;
  addedFatG: number;
  /** null: not checked (breakfast; its sodium still counts in the day total). */
  sodiumMg: number | null;
  addedSugarG: number;
  /** Grams of all veg lines (aromatics included); null: not checked. */
  vegG: number | null;
  /** Grams of real vegetables, aromatics and sauce bases left out; null: not checked. */
  realVegG: number | null;
  /** Least share of the real vegetables that are deep-coloured; null: not checked. */
  deepVegShare: number | null;
}

export const LIMITS: Readonly<Record<DishRole, Limits>> = {
  main: { proteinShare: 0.3, proteinShareWithStaple: 0.2, addedFatG: 10, sodiumMg: 600, addedSugarG: 10, vegG: null, realVegG: 150, deepVegShare: 0.5 },
  breakfast: { proteinShare: 0.2, proteinShareWithStaple: 0.2, addedFatG: 10, sodiumMg: null, addedSugarG: 10, vegG: null, realVegG: null, deepVegShare: null },
  staple: { proteinShare: null, proteinShareWithStaple: null, addedFatG: 5, sodiumMg: 200, addedSugarG: 5, vegG: null, realVegG: null, deepVegShare: null },
  side: { proteinShare: null, proteinShareWithStaple: null, addedFatG: 5, sodiumMg: 200, addedSugarG: 5, vegG: 150, realVegG: null, deepVegShare: null },
};

/** Hands-on minutes: a batch pot (waiting unlimited), a fresh meal, a breakfast, putting one way together. */
export const ACTIVE_MIN = { batch: 20, fresh: 15, breakfast: 5, way: 5 } as const;

/** A breakfast, as written, has at least this much protein (grams). */
export const BREAKFAST_PROTEIN_MIN_G = 15;

/** The Chinese summary of how a dish is cooked is one short sentence. */
export const SUMMARY_MAX_CHARS = 40;

/** A batch main has this many ways to eat it. */
export const WAYS = { min: 2, max: 3 } as const;

/** The food roles that can stand in an ingredient line of each role. */
const LINE_FOOD_ROLES: Readonly<Record<IngredientRole, readonly FoodRole[]>> = {
  protein: ["protein", "dairy"],
  veg: ["veg"],
  staple: ["staple"],
  oil: ["fat"],
  seasoning: ["sauce"],
  fruit: ["fruit"],
  topping: ["fat", "dairy", "sauce"],
};

const MINCE_ZH = /肉末|肉馅|肉糜|绞肉|碎肉/;
const MINCE_EN = /\b(minced?|ground (pork|beef|turkey|chicken|lamb|meat))\b/i;

/**
 * Pre-packaged minced or ground meat: its cuts and fat are unknown and it
 * spoils in a day or two, too short for a pot eaten over up to three meals.
 * Grinding a named whole cut fresh is allowed (the `ground` flag on a line).
 */
export function isMincedMeat(food: Food): boolean {
  if (!food.roles.includes("protein")) return false;
  return [food.zh, ...food.aliases].some((n) => MINCE_ZH.test(n)) || MINCE_EN.test(food.en) || /(^|_)(mince|minced|ground_(pork|beef|turkey|chicken|lamb|meat))/.test(food.id);
}

/** Protein categories of whole cuts that may be ground fresh. */
const GROUNDABLE: readonly string[] = ["meat", "poultry"];

/**
 * Fish and shellfish: reheated, they turn dry and fishy, and fish cooks in
 * about 10 minutes anyway, so a main with one as a protein line is always made
 * at the meal (docs/671 能备).
 */
export function isFishOrSeafood(food: Food): boolean {
  return food.proteinCategory === "seafood" || food.tags.includes("fish") || food.tags.includes("seafood");
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface CheckOptions {
  /** Staple dish ids a dish may name in `staples` or on a way besides staple foods. */
  stapleDishIds?: ReadonlySet<string>;
}

export function checkDish(dish: Dish, opts: CheckOptions = {}): DishCheck {
  const fail: CheckFailure[] = [];
  const add = (f: CheckFailure) => fail.push(f);
  const ways = dish.ways ?? [];
  const isBatchMain = dish.role === "main" && dish.prep === "batch";
  const isStaple = (id: string) => foodById(id)?.roles.includes("staple") || opts.stapleDishIds?.has(id) === true;

  const checkLines = (lines: readonly DishIngredient[], allowed: readonly IngredientRole[], way?: number) => {
    const at = way == null ? "" : `way ${way + 1}: `;
    for (const line of lines) {
      const food = foodById(line.food);
      const tag = way == null ? {} : { way };
      if (!food) {
        add({ rule: "unknown_food", food: line.food, ...tag, message: `${at}${line.food} is not in the food table` });
        continue;
      }
      if (isMincedMeat(food)) {
        add({
          rule: "minced_meat",
          food: line.food,
          ...tag,
          message: `${at}${line.food} is pre-packaged mince; use a whole cut (cubes, slices, shreds), or a named lean cut with ground: true to be ground fresh`,
        });
      }
      if (line.ground && (way != null || line.role !== "protein" || !GROUNDABLE.includes(food.proteinCategory as never))) {
        add({
          rule: "ground",
          food: line.food,
          ...tag,
          message: `${at}${line.food}: only a protein line of a whole meat or poultry cut can be ground fresh`,
        });
      }
      if (!allowed.includes(line.role)) {
        add({ rule: "line", food: line.food, ...tag, message: `${at}${line.food}: line role ${line.role} is not allowed here` });
      } else if (!LINE_FOOD_ROLES[line.role].some((r) => food.roles.includes(r))) {
        add({ rule: "line", food: line.food, ...tag, message: `${at}${line.food} cannot be a ${line.role} line` });
      }
      if (!(line.grams > 0)) add({ rule: "line", food: line.food, ...tag, message: `${at}${line.food}: grams must be above 0` });
    }
  };

  if (!dish.summary.trim() || !dish.summaryEn.trim()) {
    add({ rule: "summary", message: "the dish needs a one-sentence summary of how it is cooked, in Chinese and in English" });
  } else if ([...dish.summary].length > SUMMARY_MAX_CHARS) {
    add({
      rule: "summary",
      message: `the Chinese summary is ${[...dish.summary].length} characters; it must be at most ${SUMMARY_MAX_CHARS}`,
      actual: [...dish.summary].length,
      limit: SUMMARY_MAX_CHARS,
    });
  }

  checkLines(dish.ingredients, INGREDIENT_ROLES);
  if (dish.ingredients.some((i) => i.ground) && !(dish.summary.includes("现绞") && /ground fresh|freshly ground/i.test(dish.summaryEn))) {
    add({
      rule: "ground",
      message: "a dish with a freshly ground cut says so in both summaries (现绞 / ground fresh), so the shopping list asks for it ground that day",
    });
  }
  if (dish.ingredients.length === 0) add({ rule: "line", message: "the dish has no ingredients" });

  const method = methodById(dish.method);
  if (!method) add({ rule: "method", message: `method ${dish.method} is not in the method table` });
  else if (dish.prep === "batch" && !method.storage && dish.role !== "breakfast") {
    add({
      rule: "batch_method",
      message: `${method.id} (${method.zh}) is made at the meal; only hands-off methods (stew, braise, pressure cook, slow cook, roast, bake, steam, simmer, grain) can be batched`,
    });
  }

  if (isBatchMain) {
    for (const line of dish.ingredients) {
      const food = foodById(line.food);
      if (line.role === "protein" && food && isFishOrSeafood(food)) {
        add({
          rule: "fresh_fish",
          food: line.food,
          message: `${line.food} is fish or seafood; reheated it turns dry and fishy, so the main is made fresh at the meal, never batch`,
        });
      }
    }
  }

  if (dish.role === "breakfast") {
    if (dish.prep !== "fresh") add({ rule: "prep", message: "a breakfast is put together at the meal and is never batch" });
    if (method && !BREAKFAST_METHODS.includes(method.id)) {
      add({ rule: "breakfast_method", message: `a breakfast is made by ${BREAKFAST_METHODS.join(", ")}, not ${method.id}` });
    }
    const count = (role: IngredientRole) => dish.ingredients.filter((i) => i.role === role).length;
    const protein = count("protein");
    const staple = count("staple");
    if (protein < 1 || staple < 1) {
      add({
        rule: "breakfast_items",
        message: `a breakfast needs at least one protein item and one staple item; this has ${protein} protein, ${staple} staple`,
      });
    }
  }

  if (!CUISINES.includes(dish.cuisine)) add({ rule: "cuisine", message: `cuisine ${dish.cuisine} is unknown` });
  for (const e of dish.equipment) {
    if (!EQUIPMENT.includes(e)) add({ rule: "equipment", message: `equipment ${e} is unknown` });
  }
  if (dish.staples.length && !(dish.role === "main" && dish.prep === "fresh")) {
    add({
      rule: "staples",
      message: isBatchMain
        ? "a batch main names its staple on each way, not in staples"
        : `only a fresh main lists staples; a ${dish.role} has none`,
    });
  }
  for (const s of dish.staples) {
    if (!isStaple(s)) add({ rule: "staples", message: `staple ${s} is neither a staple food nor a staple dish` });
  }

  if (isBatchMain) {
    if (ways.length < WAYS.min || ways.length > WAYS.max) {
      add({
        rule: "ways",
        message: `a batch main needs ${WAYS.min} to ${WAYS.max} ways to eat it; this has ${ways.length}`,
        actual: ways.length,
        limit: ways.length < WAYS.min ? WAYS.min : WAYS.max,
      });
    }
  } else if (ways.length) {
    add({ rule: "ways", message: "only a batch main has ways to eat it" });
  }
  ways.forEach((w, n) => {
    if (!w.name.trim() || !w.nameEn.trim()) add({ rule: "ways", way: n, message: `way ${n + 1}: needs a Chinese and an English name` });
    if (w.staple != null && !isStaple(w.staple)) {
      add({ rule: "staples", way: n, message: `way ${n + 1}: staple ${w.staple} is neither a staple food nor a staple dish` });
    }
    checkLines(w.addOns, ADD_ON_ROLES, n);
    if (!(w.activeMin >= 0) || w.activeMin > ACTIVE_MIN.way) {
      add({
        rule: "active_time",
        way: n,
        message: `way ${n + 1}: putting it together takes ${w.activeMin} min; it must be 0 to ${ACTIVE_MIN.way}`,
        actual: w.activeMin,
        limit: ACTIVE_MIN.way,
      });
    }
  });

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
    const by = dish.role === "staple" ? "kcal" : dish.role === "side" ? "vegetables" : "protein";
    add({ rule: "scale", message: `the ingredients have no ${by} to scale the reference serving by` });
    return { ok: false, failures: fail, serving: null, ways: [] };
  }

  if (dish.role === "breakfast" && serving.protein < BREAKFAST_PROTEIN_MIN_G) {
    add({
      rule: "breakfast_protein",
      message: `a breakfast has ${r1(serving.protein)} g protein, under ${BREAKFAST_PROTEIN_MIN_G} g`,
      actual: serving.protein,
      limit: BREAKFAST_PROTEIN_MIN_G,
    });
  }

  const lim = LIMITS[dish.role];
  const hasStaple = dish.ingredients.some((i) => i.role === "staple");
  const wayServings = isBatchMain ? ways.map((w) => wayServing(serving, w)) : [];
  const plates: { s: Serving; way?: number }[] = wayServings.length
    ? wayServings.map((s, way) => ({ s, way }))
    : [{ s: serving }];

  for (const { s, way } of plates) {
    const at = way == null ? "" : `way ${way + 1}: `;
    const tag = way == null ? {} : { way };
    const shareMin = hasStaple ? lim.proteinShareWithStaple : lim.proteinShare;
    const share = s.kcal > 0 ? (s.protein * 4) / s.kcal : 0;
    if (shareMin != null && share < shareMin) {
      add({
        rule: "protein_share",
        ...tag,
        message: `${at}protein is ${r1(share * 100)}% of kcal, under ${Math.round(shareMin * 100)}%${hasStaple ? " (with a staple)" : ""}`,
        actual: share,
        limit: shareMin,
      });
    }
    if (s.addedFat > lim.addedFatG) {
      add({
        rule: "added_fat",
        ...tag,
        message: `${at}added fat ${r1(s.addedFat)} g is over ${lim.addedFatG} g`,
        actual: s.addedFat,
        limit: lim.addedFatG,
      });
    }
    if (lim.sodiumMg != null && s.sodium > lim.sodiumMg) {
      add({
        rule: "sodium",
        ...tag,
        message: `${at}sodium ${Math.round(s.sodium)} mg is over ${lim.sodiumMg} mg`,
        actual: s.sodium,
        limit: lim.sodiumMg,
      });
    }
    if (s.addedSugar > lim.addedSugarG) {
      add({
        rule: "added_sugar",
        ...tag,
        message: `${at}added sugar ${r1(s.addedSugar)} g is over ${lim.addedSugarG} g`,
        actual: s.addedSugar,
        limit: lim.addedSugarG,
      });
    }
    if (lim.vegG != null && s.vegG < lim.vegG) {
      add({
        rule: "vegetables",
        ...tag,
        message: `${at}vegetables ${Math.round(s.vegG)} g are under ${lim.vegG} g`,
        actual: s.vegG,
        limit: lim.vegG,
      });
    }
    if (lim.realVegG != null && s.realVegG < lim.realVegG) {
      add({
        rule: "real_veg",
        ...tag,
        message: `${at}real vegetables ${Math.round(s.realVegG)} g are under ${lim.realVegG} g (onion, garlic, ginger, scallion and tinned tomatoes do not count)`,
        actual: s.realVegG,
        limit: lim.realVegG,
      });
    }
    if (lim.deepVegShare != null && s.realVegG > 0 && s.deepVegG < s.realVegG * lim.deepVegShare) {
      add({
        rule: "deep_veg",
        ...tag,
        message: `${at}deep-coloured vegetables are ${Math.round(s.deepVegG)} g of ${Math.round(s.realVegG)} g real vegetables, under ${Math.round(lim.deepVegShare * 100)}%`,
        actual: s.deepVegG / s.realVegG,
        limit: lim.deepVegShare,
      });
    }
  }

  // Only protein lines carry a gram range; toppings are small by nature.
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

  return fail.length
    ? { ok: false, failures: fail, serving, ways: wayServings }
    : { ok: true, serving, ways: wayServings };
}
