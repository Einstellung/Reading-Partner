// The meals data as plain records, for the read tools (read-tools.ts) and the
// scripts that call them. Pure: the state, the date and the region in, JSON-able
// objects out. Every number is the program's — the saved grams, the food
// table's nutrition, the planner's solve the prep page draws — and nothing is
// worded: names stay names, ids stay ids, grams stay numbers.

import type { Locale } from "../../i18n/locale";
import { FOODS, dislikeTag, foodById, foodsNamed, type Food } from "./nutrition/foods";
import { rowNutrition, type Nutrition } from "./nutrition/solve";
import type { DayTargets, MealTarget, Profile, Region } from "./nutrition/targets";
import { refKey, type PotPortion } from "./plan/pots";
import { isChecked, shoppingItemKey } from "./plan/shopping";
import { dayTargetsOn, targetsOf } from "./plan/solve-week";
import {
  MEAL_KEYS,
  type Deviation,
  type Meal,
  type MealKey,
  type MealsState,
  type ShoppingItem,
  type WeekPlan,
} from "./plan/types";
import { addDays, isoWeekday } from "./plan/week";
import { parseDraft, type MealAt, type PlanDraft } from "./planner/draft";
import type { StoragePlan } from "./planner/storage";
import { checkPlannerRecord } from "./planner/to-week";
import { recipeRequest } from "./recipe/recipe";
import type { MealsRecipes } from "./recipe/recipe-store";
import { prepStepsRequest } from "./recipe/prep-steps";
import { planPrep } from "./screen/batch-cook";
import { dayView, mealPortions } from "./screen/view";
import type { PrepStep } from "./timeline/steps";

/** Kilocalories, grams and milligrams of what was eaten, to one decimal. */
export interface NutritionRead {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  sodiumMg: number;
}

/** One food of a made meal at its saved weight. */
export interface FoodLineRead {
  foodId: string;
  name: string;
  nameEn: string;
  role: string;
  grams: number;
  /** "2 个" for a food counted in units, else null. */
  units: string | null;
  nutrition: NutritionRead;
}

export interface MealRead {
  meal: MealKey;
  mode: Meal["mode"];
  /** The dish for a made meal, the place for out/delivery/bought, "" for a skip. */
  name: string;
  method: string;
  minutes: number | null;
  flavour: string | null;
  note: string;
  /** The pot (planner batch or week pot) this meal eats a share of, or null. */
  pot: string | null;
  foods: FoodLineRead[];
  /** The foods added up; null when the meal has no saved grams. */
  totals: NutritionRead | null;
  target: MealTarget | null;
}

export interface DayRead {
  date: string;
  /** ISO weekday, Monday 1 to Sunday 7. */
  weekday: number;
  /** Null without a profile. */
  training: boolean | null;
  /** The meals the plan covers on this day (the prep day covers only its dinner). */
  planned: MealKey[];
  meals: MealRead[];
  totals: NutritionRead;
  /** The day's targets; null on a day the plan covers only part of, or without targets. */
  targets: Pick<DayTargets, "kcal" | "protein" | "fat" | "carbs"> | null;
}

export interface PlanRead {
  today: string;
  /** False when nothing is planned. */
  planned: boolean;
  planId: string | null;
  startDate: string | null;
  lastDate: string | null;
  revision: number | null;
  /** Day 1 of the planner draft; plan day N is this date plus N-1, day 0 the prep day before it. */
  plannerStart: string | null;
  people: number;
  days: DayRead[];
  deviations: Deviation[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function nutritionOf(food: Food, grams: number): NutritionRead {
  const n = rowNutrition(food, grams);
  return {
    kcal: round1(n.kcal),
    protein: round1(n.protein),
    fat: round1(n.fat),
    carbs: round1(n.carbs),
    sodiumMg: round1(((food.sodium ?? 0) * grams) / 100),
  };
}

function sum(list: readonly NutritionRead[]): NutritionRead {
  const out: NutritionRead = { kcal: 0, protein: 0, fat: 0, carbs: 0, sodiumMg: 0 };
  for (const n of list) {
    out.kcal += n.kcal;
    out.protein += n.protein;
    out.fat += n.fat;
    out.carbs += n.carbs;
    out.sodiumMg += n.sodiumMg;
  }
  return { kcal: round1(out.kcal), protein: round1(out.protein), fat: round1(out.fat), carbs: round1(out.carbs), sodiumMg: round1(out.sodiumMg) };
}

function draftOf(plan: WeekPlan | null): PlanDraft | null {
  if (!plan?.planner) return null;
  try {
    return parseDraft(plan.planner.draft);
  } catch {
    return null;
  }
}

/** The date of a planner day: day N is start + N-1, the prep day (0) the day before Day 1. */
function dateOfDay(start: string, day: number): string {
  return addDays(start, day - 1);
}

/** Which pot each lunch and dinner eats from, by refKey: the planner's batches, then the week's own pots. */
function potMembership(plan: WeekPlan, draft: PlanDraft | null): Map<string, string> {
  const out = new Map<string, string>();
  if (draft && plan.planner) {
    for (const b of draft.batches) for (const m of b.meals) out.set(refKey({ date: dateOfDay(plan.planner.start, m.day), meal: m.slot }), b.id);
  }
  for (const day of plan.days) {
    for (const key of MEAL_KEYS) {
      const pot = day[key].pot;
      const k = refKey({ date: day.date, meal: key });
      if (pot && !out.has(k)) out.set(k, pot);
    }
  }
  return out;
}

function foodLines(meal: Meal): FoodLineRead[] {
  if (meal.mode !== "make") return [];
  return (meal.solved ?? []).flatMap((s) => {
    const food = foodById(s.foodId);
    if (!food) return [];
    return [
      {
        foodId: s.foodId,
        name: food.zh,
        nameEn: food.en,
        role: s.role,
        grams: s.grams,
        units: food.unit ? `${Math.round(s.grams / food.unit.grams)} ${food.unit.label}` : null,
        nutrition: nutritionOf(food, s.grams),
      },
    ];
  });
}

const inRange = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);

/** The saved plan, every meal at its saved grams, with the program's targets beside it. */
export function readPlan(state: MealsState, opts: { today: string; region: Region; from?: string; to?: string }): PlanRead {
  const plan = state.plan;
  const profile = state.charter?.profile ?? null;
  const targets = targetsOf(state.charter, opts.region);
  const deviations = state.deviations.filter((d) => inRange(d.date, opts.from, opts.to));
  if (!plan) {
    return {
      today: opts.today,
      planned: false,
      planId: null,
      startDate: null,
      lastDate: null,
      revision: null,
      plannerStart: null,
      people: profile?.people ?? 1,
      days: [],
      deviations,
    };
  }
  const membership = potMembership(plan, draftOf(plan));
  const days = plan.days
    .filter((d) => inRange(d.date, opts.from, opts.to))
    .map((day): DayRead => {
      const dayT = targets && profile ? dayTargetsOn(targets, profile, day.date) : null;
      const planned = day.planned ?? [...MEAL_KEYS];
      const meals = planned.map((key): MealRead => {
        const meal = day[key];
        const made = meal.mode === "make";
        const foods = foodLines(meal);
        return {
          meal: key,
          mode: meal.mode,
          name: (made ? meal.name : meal.place) ?? "",
          method: made ? (meal.method ?? "") : "",
          minutes: made ? (meal.minutes ?? null) : null,
          flavour: made ? (meal.flavour ?? null) : null,
          note: meal.note ?? "",
          pot: membership.get(refKey({ date: day.date, meal: key })) ?? null,
          foods,
          totals: foods.length ? sum(foods.map((f) => f.nutrition)) : null,
          target: dayT ? dayT.meals[key] : null,
        };
      });
      return {
        date: day.date,
        weekday: isoWeekday(day.date),
        training: profile ? profile.trainingDays.includes(isoWeekday(day.date)) : null,
        planned,
        meals,
        totals: sum(meals.flatMap((m) => (m.totals ? [m.totals] : []))),
        targets: dayT && !day.planned ? { kcal: dayT.kcal, protein: dayT.protein, fat: dayT.fat, carbs: dayT.carbs } : null,
      };
    });
  return {
    today: opts.today,
    planned: true,
    planId: plan.id,
    startDate: plan.startDate,
    lastDate: plan.days[plan.days.length - 1]?.date ?? plan.startDate,
    revision: plan.revision,
    plannerStart: plan.planner?.start ?? null,
    people: profile?.people ?? 1,
    days,
    deviations,
  };
}

// --- the prep session ----------------------------------------------------------

export interface GramsRead {
  foodId: string;
  name: string;
  grams: number;
}

export interface PotRead {
  id: string;
  dish: string;
  name: string;
  nameEn: string;
  method: string;
  session: string;
  /** The meals that eat from it, with their dates. Day 0 is the prep day. */
  meals: { day: number; date: string; meal: "lunch" | "dinner" }[];
  /** The whole pot for everyone eating, raw as bought: the foods the session cooks. */
  foods: GramsRead[];
}

export interface PrepRead {
  /** False when the saved plan has no prep session. `reason` says why. */
  found: boolean;
  reason?: string;
  plannerStart?: string;
  people?: number;
  session?: { id: string; day: number; date: string; part: string; activeMin: number; totalMin: number; done: boolean };
  pots?: PotRead[];
  /** Every pot's foods added up, per food. */
  potTotals?: GramsRead[];
  /** The rice cooked in one batch, with its date and the meals it feeds; null when none. */
  rice?: (StoragePlan["rice"] & { foodName: string }) | null;
  /** Containers, boxes, what goes in the fridge, freezer and cupboard, and the evenings' jobs, by plan day. */
  storage?: Omit<StoragePlan, "rice">;
  /** Plan day number to date, for `storage` and `rice`. */
  dayDates?: Record<string, string>;
  /** The session's written steps in order, or null while none are written. */
  steps?: PrepStep[] | null;
  /**
   * False when `steps` were written for an earlier version of this session (the
   * pots' grams or the kitchen changed since); the prep page writes new ones
   * when it is opened.
   */
  stepsCurrent?: boolean;
}

/** The stored steps for this session: the ones written for it as it is now, else the newest written under its name. */
function storedSteps(recipes: MealsRecipes | null | undefined, key: string | null, name: string | null): { steps: PrepStep[]; current: boolean } | null {
  const preps = recipes?.preps ?? {};
  const exact = key ? preps[key] : undefined;
  if (exact) return { steps: exact.steps, current: true };
  const older = Object.values(preps)
    .filter((p) => name !== null && p.name === name)
    .sort((a, b) => b.at - a.at)[0];
  return older ? { steps: older.steps, current: false } : null;
}

function gramsRow(foodId: string, grams: number): GramsRead {
  return { foodId, name: foodById(foodId)?.zh ?? foodId, grams: Math.round(grams) };
}

function addUp(lists: readonly (readonly GramsRead[])[]): GramsRead[] {
  const out = new Map<string, number>();
  for (const list of lists) for (const r of list) out.set(r.foodId, (out.get(r.foodId) ?? 0) + r.grams);
  return [...out].map(([id, g]) => gramsRow(id, g));
}

/**
 * The prep session as the prep page builds it: the planner draft solved for the
 * profile as it is now (planner/to-week.ts), each pot's foods times the people
 * eating, the storage plan, and the stored steps when `recipes` holds them.
 */
export function readPrep(
  state: MealsState,
  opts: { today: string; region: Region; language: Locale; recipes?: MealsRecipes | null },
): PrepRead {
  const plan = state.plan;
  const charter = state.charter;
  const targets = targetsOf(charter, opts.region);
  if (!plan) return { found: false, reason: "Nothing is planned." };
  if (!plan.planner) return { found: false, reason: "The saved plan was not made by the planner and has no prep session." };
  if (!charter || !targets) return { found: false, reason: "There are no targets (no profile, or body data withheld), so the plan cannot be solved." };
  const check = checkPlannerRecord(plan, charter.profile, targets);
  const solved = check?.result.plan;
  const storage = check?.result.storage;
  if (!check || !solved || !storage) return { found: false, reason: "The saved plan's draft no longer solves for the profile as it is now." };
  const start = plan.planner.start;
  const people = charter.profile.people ?? 1;
  const prep = planPrep(state, opts.today);
  const draftSession = check.draft.sessions[0];
  const pots: PotRead[] = solved.batches.map((b) => {
    const dish = check.lib.dish(b.dish);
    const meals = [...b.meals]
      .sort((x, y) => x.day - y.day || (x.slot === y.slot ? 0 : x.slot === "lunch" ? -1 : 1))
      .map((m: MealAt) => ({ day: m.day, date: dateOfDay(start, m.day), meal: m.slot }));
    return {
      id: b.id,
      dish: b.dish,
      name: dish?.name ?? b.dish,
      nameEn: dish?.nameEn ?? b.dish,
      method: dish?.summary ?? "",
      session: b.session,
      meals,
      foods: addUp([b.lines.map((l) => gramsRow(l.food, l.grams * people))]),
    };
  });
  const days = new Set<number>([0, ...check.draft.days.map((_, i) => i + 1)]);
  const dayDates: Record<string, string> = {};
  for (const d of [...days].sort((a, b) => a - b)) dayDates[String(d)] = dateOfDay(start, d);
  const { rice, ...rest } = storage;
  const request = prepStepsRequest(state, { today: opts.today, region: opts.region, language: opts.language });
  const stored = storedSteps(opts.recipes, request?.key ?? null, request?.name ?? null);
  return {
    found: true,
    plannerStart: start,
    people,
    ...(draftSession
      ? {
          session: {
            id: draftSession.id,
            day: draftSession.day,
            date: dateOfDay(start, draftSession.day),
            part: draftSession.part,
            activeMin: prep?.activeMin ?? 0,
            totalMin: prep?.totalMin ?? 0,
            done: prep?.done ?? false,
          },
        }
      : {}),
    pots,
    potTotals: addUp(pots.map((p) => p.foods)),
    rice: rice ? { ...rice, foodName: foodById(rice.food)?.zh ?? rice.food } : null,
    storage: rest,
    dayDates,
    steps: stored ? stored.steps : null,
    stepsCurrent: stored?.current ?? false,
  };
}

// --- the shopping list ---------------------------------------------------------

export interface ShoppingLineRead {
  name: string;
  /** The food it totals; null on a line the reader added. */
  foodId: string | null;
  /** What the plan needs, times the people eating; null on a line the reader added. */
  neededG: number | null;
  /** What is bought, as the list shows it: "1 盒（约 600 g）", "家里常备", or the reader's own words. */
  qty: string;
  category: string;
  keeps: string;
  /** The earliest day a meal needs it; null on a line the reader added. */
  neededBy: string | null;
  /** "plan" for a line derived from the plan, "reader" for one they asked for. */
  source: "plan" | "reader";
  /** Kept at home rather than bought (a seasoning, an oil, dry rice). */
  onHand: boolean;
  /** Bought frozen and kept frozen. */
  boughtFrozen: boolean;
  /** Raw protein to freeze the day it is bought. */
  freezeOnArrival: boolean;
  /** What a perishable pack leaves over, and the day an opened pack of it spoils. */
  leftover: { grams: number; useBy: string } | null;
  /** Taken off the list by the reader; still here so a script sees it. */
  dropped: boolean;
  /** What the reader swapped this derived line for, or null. */
  replacedBy: { name: string; qty: string } | null;
  checked: boolean;
  /** Added after the shop was called done. */
  afterDone: boolean;
}

export interface ShoppingRead {
  /** The date the shop was called done, or null while it is still a list. */
  doneOn: string | null;
  lines: ShoppingLineRead[];
}

function lineRead(item: ShoppingItem, source: "plan" | "reader", flags: Pick<ShoppingLineRead, "dropped" | "replacedBy" | "checked">): ShoppingLineRead {
  return {
    name: item.name,
    foodId: item.foodId ?? null,
    neededG: typeof item.grams === "number" ? item.grams : null,
    qty: item.qty,
    category: item.category,
    keeps: item.keeps,
    neededBy: item.neededBy || null,
    source,
    onHand: item.pack?.onHand === true,
    boughtFrozen: item.pack?.frozen === true,
    freezeOnArrival: item.freezeOnArrival,
    leftover: item.pack?.leftover ?? null,
    ...flags,
    afterDone: item.afterDone === true,
  };
}

/** Every line of the list, derived and the reader's, with the needed grams apart from what is bought. */
export function readShopping(state: MealsState): ShoppingRead {
  const s = state.shopping;
  const lines: ShoppingLineRead[] = s.items.map((item) => {
    const key = shoppingItemKey(item);
    const swap = s.replaced[key];
    const asShown = swap ? { ...item, ...swap } : item;
    return lineRead(item, "plan", {
      dropped: s.dropped[key] === true,
      replacedBy: swap ? { name: swap.name, qty: swap.qty } : null,
      checked: isChecked(s, asShown),
    });
  });
  for (const item of s.reader) lines.push(lineRead(item, "reader", { dropped: false, replacedBy: null, checked: isChecked(s, item) }));
  return { doneOn: s.doneOn, lines };
}

// --- the recipes ---------------------------------------------------------------

export interface RecipeRead {
  date: string;
  meal: MealKey;
  name: string;
  /** The pot it eats a share of, or null. */
  pot: string | null;
  /** The recipe's key in the recipe file: it changes when the dish, its grams or the kitchen change. Null when the meal has no grams. */
  key: string | null;
  /** The written steps, or null while the recipe is not written yet. */
  steps: string[] | null;
}

/** The step-by-step recipe of every made meal in the range, as the recipe page finds it. */
export function readRecipes(
  state: MealsState,
  opts: { today: string; region: Region; language: Locale; recipes: MealsRecipes | null; from?: string; to?: string; meal?: MealKey },
): RecipeRead[] {
  const plan = state.plan;
  const profile = state.charter?.profile ?? null;
  if (!plan || !profile) return [];
  const targets = targetsOf(state.charter, opts.region);
  const portions: Map<string, PotPortion> = mealPortions(plan, profile, targets);
  const membership = potMembership(plan, draftOf(plan));
  const out: RecipeRead[] = [];
  for (const day of plan.days) {
    if (!inRange(day.date, opts.from, opts.to)) continue;
    const view = dayView(day, opts.today, targets, profile, plan, portions);
    for (const m of view.meals) {
      if (m.mode !== "make" || (opts.meal && m.key !== opts.meal)) continue;
      const request = recipeRequest(m, profile, opts.language);
      const stored = request ? opts.recipes?.recipes[request.key] : undefined;
      out.push({
        date: day.date,
        meal: m.key,
        name: m.name,
        pot: membership.get(refKey({ date: day.date, meal: m.key })) ?? null,
        key: request?.key ?? null,
        steps: stored ? [...stored.steps] : null,
      });
    }
  }
  return out;
}

// --- the charter ---------------------------------------------------------------

export interface CharterRead {
  /** False before the opening questions are answered. */
  found: boolean;
  profile: Profile | null;
  /** What they have said about their meals in their own words. */
  text: string;
  updatedAt: number | null;
  /** Each dislike with the foods it keeps out. */
  dislikes: { word: string; tag: string | null; foods: string[] }[];
  /** Foods they cannot get, by id and name. */
  unavailable: { foodId: string; name: string }[];
  /** The program's daily targets; null without body data. */
  targets: { training: Nutrition; rest: Nutrition } | null;
}

export function readCharter(state: MealsState, region: Region): CharterRead {
  const charter = state.charter;
  if (!charter) return { found: false, profile: null, text: "", updatedAt: null, dislikes: [], unavailable: [], targets: null };
  const profile = charter.profile;
  const targets = targetsOf(charter, region);
  const macros = (t: Nutrition): Nutrition => ({ kcal: t.kcal, protein: t.protein, fat: t.fat, carbs: t.carbs });
  return {
    found: true,
    profile,
    text: charter.text,
    updatedAt: charter.updatedAt,
    dislikes: profile.dislikes.map((word) => ({ word, tag: dislikeTag(word), foods: foodsNamed(word).map((f) => f.id) })),
    unavailable: (profile.unavailable ?? []).map((id) => ({ foodId: id, name: foodById(id)?.zh ?? id })),
    targets: targets ? { training: macros(targets.training), rest: macros(targets.rest) } : null,
  };
}

// --- the food table ------------------------------------------------------------

export interface FoodRead {
  id: string;
  name: string;
  nameEn: string;
  aliases: string[];
  category: string;
  keeps: string;
  roles: string[];
  tags: string[];
  proteinCategory: string | null;
  /** Per 100 g edible portion. */
  per100g: { kcal: number; protein: number; fat: number; carbs: number; sodiumMg: number | null; addedSugarG: number | null };
  /** Counted in whole units when solved (an egg is 50 g). */
  unit: { grams: number; label: string } | null;
  /** Edible grams of one piece of countable produce. */
  piece: { grams: number; label: string } | null;
  /** The usual retail pack. */
  pack: { grams: number; kind: string; openDays: number; labelG?: number } | null;
  /** Bought dry and cooked at home (rice): the dry food's name. */
  boughtDry: string | null;
}

export function foodRead(f: Food): FoodRead {
  return {
    id: f.id,
    name: f.zh,
    nameEn: f.en,
    aliases: [...f.aliases],
    category: f.category,
    keeps: f.keeps,
    roles: [...f.roles],
    tags: [...f.tags],
    proteinCategory: f.proteinCategory ?? null,
    per100g: { kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs, sodiumMg: f.sodium ?? null, addedSugarG: f.addedSugar ?? null },
    unit: f.unit ? { ...f.unit } : null,
    piece: f.piece ? { ...f.piece } : null,
    pack: f.pack ? { ...f.pack } : null,
    boughtDry: f.boughtDry?.zh ?? null,
  };
}

/** The food ids the saved plan and the shopping list use. */
export function foodsInUse(state: MealsState): string[] {
  const ids = new Set<string>();
  for (const day of state.plan?.days ?? []) for (const k of MEAL_KEYS) for (const s of day[k].solved ?? []) ids.add(s.foodId);
  for (const item of state.shopping.items) if (item.foodId) ids.add(item.foodId);
  return [...ids];
}

/**
 * Foods from the table: those named by `ids`, those whose id, name, English name
 * or alias contains `query`, every food with `all`, and otherwise the foods the
 * saved plan and list use.
 */
export function readFoods(state: MealsState, opts: { ids?: readonly string[]; query?: string; all?: boolean } = {}): FoodRead[] {
  if (opts.all) return FOODS.map(foodRead);
  const q = opts.query?.trim().toLowerCase();
  if (opts.ids?.length || q) {
    const want = new Set(opts.ids ?? []);
    return FOODS.filter(
      (f) =>
        want.has(f.id) ||
        (!!q && [f.id, f.zh, f.en, ...f.aliases].some((n) => n.toLowerCase().includes(q))),
    ).map(foodRead);
  }
  return foodsInUse(state).flatMap((id) => {
    const f = foodById(id);
    return f ? [foodRead(f)] : [];
  });
}
