// The eating-day steps of a meal that eats from a prepped box (docs/671 吃的那天):
// the reheat step written here from rules, the fresh parts' steps taken from
// the library (a side's or staple's `finish`, a way's add-ons and staple foods
// in dishes/food-finish.ts), a plating step when it adds something, and one
// line for the day card. No model call: every word is the program's.
//
// Dish text exists in Chinese and English only, so a meal reads in Chinese for
// zh-CN and in English for every other language, the fixed phrases included.

import { translate, type Locale } from "../../../i18n";
import { FOOD_FINISH, fallbackFinish } from "../dishes/food-finish";
import { houseOil } from "../dishes/house-oil";
import type { Dish, DishFinish, Equipment } from "../dishes/types";
import { foodById, type Food } from "../nutrition/foods";
import type { Profile } from "../nutrition/targets";
import type { PotPortion } from "../plan/pots";
import { kitchenOf, planLibrary, type PlanLibrary } from "../planner/library";
import { isRiceStaple } from "../planner/rice";
import type { MealView } from "../screen/view";
import type { Finishing } from "./types";

/** A box of meat on its own, or a braise or stew with its sauce. */
export type BoxKind = "meat" | "stew";

/**
 * Reheating minutes for one box from the fridge (about 750 ml): the box alone
 * by its kind, rice alone, or the box and its rice heated together. On the
 * stove the food goes in a covered pan with a splash of water.
 */
export const REHEAT_MIN = {
  microwave: { meat: 3, stew: 4, rice: 2, together: 4 },
  stove: { meat: 6, stew: 7, rice: 5, together: 7 },
} as const;

/** The most steps a meal shows. */
export const MAX_STEPS = 4;

const STEW_METHODS: readonly string[] = ["stew", "braise", "simmer"];
/** Staple foods the meal is wrapped in rather than served beside. */
const WRAPS: ReadonlySet<string> = new Set(["corn_tortilla", "whole_wheat_tortilla", "whole_wheat_pita"]);
/** Assumed at home (docs/671 目标用户), listed last on the need line. */
const SALT = "salt";
const PEPPER = "ground_black_pepper";

/** The language the steps are written in: Chinese for zh-CN, English for every other. */
export function finishLanguage(language: Locale): Locale {
  return language === "zh-CN" ? "zh-CN" : "en";
}

/**
 * A made meal of a planner plan that eats a share of a batch the prep session
 * cooked: a prepped box, or a share from the pot. A share of the old weekly
 * pots (no `eat`) keeps its written recipe: the program does not know its
 * fresh parts.
 */
export function eatsBox(view: Pick<MealView, "mode" | "pot">): boolean {
  return view.mode === "make" && !!view.pot && !view.pot.cooks && !!view.pot.eat;
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The quickest way of a part the kitchen fits (the first on a tie), else the
 * last way (check.ts makes sure one fits the default kitchen).
 */
export function pickFinish(finish: readonly DishFinish[], kitchen: ReadonlySet<Equipment>): DishFinish | null {
  const fits = finish.filter((f) => f.equipment.every((e) => kitchen.has(e)));
  const best = fits.reduce<DishFinish | null>((a, f) => (a && a.minutes <= f.minutes ? a : f), null);
  return best ?? finish[finish.length - 1] ?? null;
}

/** A food by name: the Chinese name without its bracket, or the English one (the id spelled out where the table has none). */
export function foodWord(food: Food, zh: boolean): string {
  if (zh) return food.zh.replace(/（[^）]*）$/, "");
  return food.en || food.aliases.find((a) => /^[\x20-\x7e]+$/.test(a)) || food.id.replace(/_/g, " ");
}

/** The reheat step and its card action, by the kitchen: the microwave when it has one, else a covered pan. */
export function reheatStep(opts: {
  what: string;
  kind: BoxKind | null;
  rice: boolean;
  kitchen: ReadonlySet<Equipment>;
  language: Locale;
}): { step: string; line: string; minutes: number } {
  const lang = finishLanguage(opts.language);
  const how = opts.kitchen.has("microwave") ? "microwave" : "stove";
  const table = REHEAT_MIN[how];
  const minutes = opts.kind ? (opts.rice ? table.together : table[opts.kind]) : table.rice;
  const water = opts.rice && how === "microwave" ? translate(lang, "meals.finish.riceWater") : "";
  const key = how === "microwave" ? "meals.finish.reheatMicrowave" : "meals.finish.reheatStove";
  const step = translate(lang, key, { what: opts.what, water, min: minutes });
  return { step: upper(step), line: translate(lang, "meals.finish.lineHeat", { what: opts.what, min: minutes }), minutes };
}

interface Part {
  finish: DishFinish;
  /** What to have out for it, by food or dish id. */
  foods: string[];
  /** Its salt and pepper lines: assumed at home, listed last. */
  home: string[];
  /** A cooking-oil line it carries, for "{oil}" when the household has none set. */
  oil: string | null;
}

interface Ctx {
  lang: Locale;
  zh: boolean;
  lib: PlanLibrary;
  kitchen: ReadonlySet<Equipment>;
}

const foodName = foodWord;

function dishOf(lib: PlanLibrary, id: string): Dish | undefined {
  return lib.dish(id) ?? lib.stored(id);
}

/** A food or dish id by its name in the language, lower case in English. */
function nameOf(ctx: Ctx, id: string): string {
  const d = dishOf(ctx.lib, id);
  if (d) return ctx.zh ? d.name : lower(d.nameEn);
  const f = foodById(id);
  return f ? foodName(f, ctx.zh) : id;
}

const isHome = (id: string) => id === SALT || id === PEPPER;

function foodPart(ctx: Ctx, id: string): Part | null {
  const food = foodById(id);
  if (!food) return null;
  const finish = pickFinish(FOOD_FINISH[id] ?? fallbackFinish(food, { zh: foodName(food, true), en: foodName(food, false) }), ctx.kitchen);
  return finish ? { finish, foods: [id], home: [], oil: null } : null;
}

/** A side or staple dish: its own steps, else the steps of its first vegetable or staple food. */
function dishPart(ctx: Ctx, id: string): Part | null {
  const d = dishOf(ctx.lib, id);
  if (!d) return foodPart(ctx, id);
  const main = d.ingredients.find((l) => l.role === "veg" || l.role === "staple");
  const own = d.finish ? pickFinish(d.finish, ctx.kitchen) : null;
  const finish = own ?? (main ? foodPart(ctx, main.food)?.finish : null);
  if (!finish) return null;
  const foods = d.ingredients.filter((l) => !l.cookingOil && !isHome(l.food)).map((l) => l.food);
  const home = d.ingredients.filter((l) => isHome(l.food)).map((l) => l.food);
  return { finish, foods, home, oil: d.ingredients.find((l) => l.cookingOil)?.food ?? null };
}

/** The clauses of a part as one sentence, the oil named. */
function sentence(ctx: Ctx, f: DishFinish, oil: string): string {
  const clauses = (ctx.zh ? f.steps : f.stepsEn).map((s) => s.replace(/\{oil\}/g, oil).replace(/[。.，,；;\s]+$/, ""));
  return ctx.zh ? `${clauses.join("，")}。` : `${upper(clauses.join(", "))}.`;
}

/** Two step sentences as one, when a meal has more steps than it shows. */
function merge(ctx: Ctx, a: string, b: string): string {
  const head = a.replace(/[。.]$/, "");
  return ctx.zh ? `${head}；${b}` : `${head}; ${lower(b)}`;
}

/**
 * The eating-day steps of a meal that eats from a prepped box, or null for a
 * meal that is not made or is cooked fresh (those keep the recipe page).
 */
export function finishingFor(view: MealView, profile: Profile, language: Locale): Finishing | null {
  if (!eatsBox(view) || !view.pot) return null;
  const portion: PotPortion = view.pot;
  const lang = finishLanguage(language);
  const zh = lang === "zh-CN";
  const tr = (key: string, params?: Record<string, string | number>) => translate(lang, `meals.finish.${key}`, params);
  const lib = planLibrary(profile);
  const ctx: Ctx = { lang, zh, lib, kitchen: kitchenOf(profile) };
  const eat = portion.eat;
  const count = Math.max(1, Math.round(profile.people ?? 1));

  const meatFood = foodById(portion.pot.foodId);
  const meat = meatFood ? foodName(meatFood, zh) : portion.pot.name;
  const potDish = eat ? lib.stored(eat.dish) : undefined;
  const kind: BoxKind = potDish && STEW_METHODS.includes(potDish.method) ? "stew" : "meat";

  // The rice that comes with the box: in it, from the rice container, or ladled from the cooker at the prep meal.
  const staple = eat?.staple ?? null;
  const hotRice = !!eat?.hot && !eat.rice && isRiceStaple(lib, staple);
  const riceName = staple && (eat?.rice || hotRice) ? nameOf(ctx, staple) : null;

  // The fresh parts: the staple when it is not that rice, the way's add-ons, the sides.
  const parts: Part[] = [];
  if (eat && staple && !riceName) {
    const p = dishOf(lib, staple) ? dishPart(ctx, staple) : foodPart(ctx, staple);
    if (p) parts.push(p);
  }
  const way = eat ? (dishOf(lib, eat.dish)?.ways ?? [])[eat.way - 1] : undefined;
  for (const a of way?.addOns ?? []) {
    const p = foodPart(ctx, a.food);
    if (p) parts.push(p);
  }
  for (const id of eat?.sides ?? []) {
    const p = dishPart(ctx, id);
    if (p) parts.push(p);
  }

  const oilId = houseOil(profile) ?? parts.find((p) => p.oil)?.oil ?? null;
  const oilFood = oilId ? foodById(oilId) : undefined;
  const oil = oilFood ? foodName(oilFood, zh) : tr("oil");

  // The box, the rice and the need line's first entries.
  const and = (a: string, b: string) => tr("and", { a, b });
  const need: string[] = [];
  let what: string;
  let heat: { step: string; line: string; minutes: number } | null = null;
  if (eat?.hot) {
    what = riceName ? and(tr("portion", { name: meat }), tr("portion", { name: riceName })) : tr("portion", { name: meat });
    need.push(tr("needPot", { name: meat }), ...(riceName ? [tr("needPot", { name: riceName })] : []));
  } else {
    const inBox = eat?.rice === "box" && riceName ? and(meat, riceName) : meat;
    const boxed = eat?.boxed !== false;
    const held = boxed ? tr("box", { name: inBox }) : tr("portion", { name: meat });
    what = eat?.rice === "container" && riceName ? and(held, tr("portion", { name: riceName })) : held;
    if (boxed) need.push(count > 1 ? tr("needBoxes", { name: inBox, count }) : tr("needBox", { name: inBox }));
    else need.push(tr("needContainer", { name: meat }));
    if (eat?.rice === "container" && riceName) need.push(tr("needRice", { name: riceName }));
    heat = reheatStep({ what, kind, rice: !!riceName, kitchen: ctx.kitchen, language: lang });
  }

  // Steps: the cooked parts, longest first; the raw ones as one step; the box; the plate.
  const cooked = parts.filter((p) => p.finish.equipment.length > 0).sort((a, b) => b.finish.minutes - a.finish.minutes);
  const raw = parts.filter((p) => p.finish.equipment.length === 0);
  const fresh = cooked.map((p) => sentence(ctx, p.finish, oil));
  if (raw.length) {
    const clauses = raw.flatMap((p) => (zh ? p.finish.steps : p.finish.stepsEn).map((s) => s.replace(/\{oil\}/g, oil)));
    fresh.push(sentence(ctx, { ...raw[0]!.finish, steps: clauses, stepsEn: clauses }, oil));
  }
  const box = heat ? heat.step : upper(tr("ladle", { what }));
  const wrap = staple && WRAPS.has(staple) ? upper(tr("wrap", { what: meat, staple: nameOf(ctx, staple) })) : null;
  const plate = wrap ?? (parts.length ? tr("plate") : null);
  // A plain "plate up" is the first to go when the steps are many; the wrap step stays.
  while (fresh.length + 1 + (wrap ? 1 : 0) > MAX_STEPS && fresh.length >= 2) {
    const last = fresh.pop()!;
    fresh.push(merge(ctx, fresh.pop()!, last));
  }
  const steps = [...fresh, box];
  if (plate && steps.length < MAX_STEPS) steps.push(plate);

  // The card's line: the box, then the two longest fresh parts.
  const act = (p: Part) => tr("lineAct", { act: zh ? p.finish.act : p.finish.actEn, min: p.finish.minutes });
  const lead = heat ? heat.line : tr("lineLadle", { what });
  const top = [...cooked, ...raw].slice(0, 2).map(act);
  const line = upper([lead, ...top].join(tr("lineJoin")));

  // What to have out: the fresh foods by name, then what is assumed at home.
  const freshFoods = [...new Set(parts.flatMap((p) => p.foods))].filter((id) => !isHome(id));
  for (const id of freshFoods) need.push(nameOf(ctx, id));
  const text = parts.map((p) => p.finish.steps.join(" ")).join(" ");
  const home: string[] = [];
  if (text.includes("{oil}")) home.push(oil);
  const carries = (id: string) => parts.some((p) => p.home.includes(id));
  if (text.includes("盐") || carries(SALT)) home.push(nameOf(ctx, SALT));
  if (text.includes("黑胡椒") || carries(PEPPER)) home.push(nameOf(ctx, PEPPER));
  const seen = new Set<string>();
  const needOut = [...need, ...home].map((n) => (zh ? n : upper(n))).filter((n) => !seen.has(n) && !!seen.add(n));

  return { line, need: needOut, steps };
}
