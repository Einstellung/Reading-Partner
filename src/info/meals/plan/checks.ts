// The rules a drafted week is held to before the reader sees it (docs/73 每顿
// 怎么搭). Every failure comes back as a sentence the model can act on, and
// only the meals that failed are sent back to be re-picked.
//
// Order: the template first (only foods in the table, the roles the solver
// needs), because nothing can be solved until it holds; then the grams are
// solved; then the rules that read the solved week — minutes, dislikes,
// protein reached, each day's kcal reached, flavour next to flavour, fish
// twice a week. The pots are held to theirs with the templates (docs/73 一锅).

import { FOODS, foodAllowed, foodById, type Food } from "../nutrition/foods";
import type { TemplateItem } from "../nutrition/solve";
import { minuteCap, type Profile, type Targets } from "../nutrition/targets";
import {
  FRIDGE_DAYS,
  MAX_POT_DAYS,
  MAX_POT_MEALS,
  MIN_POT_MEALS,
  compareRefs,
  potBoxing,
  potById,
  potMeals,
  potShareG,
} from "./pots";
import { dayTargetsOn, mealNumbers, solvePlan } from "./solve-week";
import { MAIN_MEAL_KEYS, MEAL_KEYS, type Meal, type MealKey, type MealRef, type Pot, type WeekPlan } from "./types";
import { daysBetween, dayIndexOf, mealsInOrder, sameMeal } from "./week";

export interface CheckInput {
  plan: WeekPlan;
  profile: Profile;
  targets: Targets;
  // The meals this draft wrote. Null checks every meal, which is a fresh week.
  changed?: readonly MealRef[] | null;
  // The week before an adjustment, so a weekly rule the reader's own deviation
  // already broke is not blamed on the meals being re-picked.
  previous?: WeekPlan | null;
  // The ids of the pots this draft sent. With `changed`, a pot is held to its
  // rules when the draft sent it or one of its meals, before or after.
  pots?: readonly string[] | null;
}

export interface CheckResult {
  // The week with its grams solved. Only meaningful when `problems` is empty.
  plan: WeekPlan;
  problems: string[];
  // The meals the problems name, in week order. A week-wide rule (fish twice)
  // names none: any meal the model changes can mend it.
  failing: MealRef[];
}

function where(plan: WeekPlan, ref: MealRef): string {
  return `Day ${dayIndexOf(plan, ref.date)} ${ref.meal}`;
}

const ROLE_FITS: Record<Exclude<TemplateItem["role"], "fixed">, (f: Food) => boolean> = {
  protein: (f) => f.roles.includes("protein"),
  staple: (f) => f.roles.includes("staple"),
  fat: (f) => f.roles.includes("fat"),
};

/** A day whose meals solve to less than this share of their kcal goes back to the model. */
export const DAY_KCAL_FLOOR = 0.9;

/**
 * What is wrong with one made meal's template, before anything is solved.
 * Breakfast, lunch and dinner need one staple; the snack may have none.
 */
export function templateProblems(at: string, meal: Meal, key: MealKey): string[] {
  const out: string[] = [];
  if (!meal.name) out.push(`${at} needs a name.`);
  if (!meal.searchName) out.push(`${at} needs a searchName.`);
  if (!meal.flavour) out.push(`${at} needs a flavour from the list.`);
  if (!meal.method) out.push(`${at} needs its one-line method.`);
  if (!(typeof meal.minutes === "number" && meal.minutes > 0)) out.push(`${at} needs its hands-on minutes.`);
  const items = meal.items ?? [];
  if (!items.length) return [...out, `${at} names no foods.`];
  for (const item of items) {
    const food = foodById(item.foodId);
    if (!food) {
      out.push(`${at}: "${item.foodId}" is not in the food table. Use ids from the list only.`);
      continue;
    }
    if (item.role === "fixed") {
      const g = item.grams;
      if (!(typeof g === "number" && g > 0)) out.push(`${at}: ${food.id} is fixed but has no grams.`);
      else if (g < food.minG || g > food.maxG) {
        out.push(`${at}: ${g} g of ${food.id} is outside its ${food.minG}–${food.maxG} g range.`);
      }
    } else if (!ROLE_FITS[item.role](food)) {
      out.push(
        item.role === "staple" && food.roles.includes("fruit")
          ? `${at}: ${food.id} is a fruit and never the staple; make it a fixed item of 150–200 g.`
          : `${at}: ${food.id} cannot be the ${item.role}; its roles are ${food.roles.join(", ")}.`,
      );
    }
  }
  const count = (role: TemplateItem["role"]) => items.filter((i) => i.role === role).length;
  if (count("protein") !== 1) out.push(`${at} needs exactly one protein item; it has ${count("protein")}.`);
  if (key === "snack") {
    if (count("staple") > 1) out.push(`${at} has ${count("staple")} staple items; at most one.`);
  } else if (count("staple") !== 1) {
    out.push(`${at} needs exactly one staple item; it has ${count("staple")}.`);
  }
  if (count("fat") > 1) out.push(`${at} has ${count("fat")} fat items; at most one.`);
  return out;
}

/**
 * What is wrong with one pot, before anything is solved: a food that is cooked
 * as a pot, two to four meals, cooked at a meal that eats from it, no meal
 * before it or more than MAX_POT_DAYS after, and a share one meal can take.
 * A packed pot keeps the split it was packed with: instead of the count and
 * the share, every meal needs a box, and a fridge box keeps FRIDGE_DAYS.
 * Each problem comes with the meals it names: the pot's meals and its cook meal.
 */
export function potProblems(plan: WeekPlan, pot: Pot): { text: string; refs: MealRef[] }[] {
  const out: { text: string; refs: MealRef[] }[] = [];
  const meals = potMeals(plan, pot.id);
  const cookIsMeal = plan.days.some((d) => d.date === pot.cook.date);
  const all = cookIsMeal && !meals.some((r) => sameMeal(r, pot.cook)) ? [pot.cook, ...meals] : meals;
  const add = (text: string, refs: MealRef[] = all) => out.push({ text, refs });
  const at = (ref: MealRef) => where(plan, ref);
  if (!pot.name || !pot.method) add(`Pot ${pot.id} needs its name and its one-line method.`);
  const food = foodById(pot.foodId);
  if (!food) {
    add(`Pot ${pot.id}: "${pot.foodId}" is not in the food table.`);
    return out;
  }
  if (!food.potG) {
    const potFoods = FOODS.filter((f) => f.potG).map((f) => f.id);
    add(`Pot ${pot.id}: ${food.id} is not cooked as a pot; only ${potFoods.join(", ")} are. Give each of its meals its own protein.`);
    return out;
  }
  const boxing = potBoxing(plan, pot);
  if (!boxing && (meals.length < MIN_POT_MEALS || meals.length > MAX_POT_MEALS)) {
    add(`Pot ${pot.id} feeds ${meals.length} meal${meals.length === 1 ? "" : "s"}; a pot feeds ${MIN_POT_MEALS} to ${MAX_POT_MEALS}.`);
  }
  if (!meals.some((r) => sameMeal(r, pot.cook))) {
    add(`Pot ${pot.id} is cooked at ${at(pot.cook)}, which does not eat from it; the meal it is cooked at eats the first share.`);
  }
  for (const ref of meals) {
    if (compareRefs(ref, pot.cook) < 0) {
      add(`${at(ref)} eats from pot ${pot.id} before it is cooked at ${at(pot.cook)}.`, [ref, pot.cook]);
      continue;
    }
    const days = daysBetween(pot.cook.date, ref.date) ?? 0;
    if (days > MAX_POT_DAYS) add(`${at(ref)} is ${days} days after pot ${pot.id} is cooked; at most ${MAX_POT_DAYS}.`, [ref]);
  }
  for (const ref of boxing?.unboxed ?? []) {
    add(`${at(ref)} eats from pot ${pot.id}, which is already packed and has no spare box left.`, [ref]);
  }
  for (const { ref, box } of boxing?.taken ?? []) {
    const days = daysBetween(pot.cook.date, ref.date) ?? 0;
    if (box.storage !== "fridge" || days <= FRIDGE_DAYS) continue;
    add(
      `${at(ref)} is ${days} days after pot ${pot.id} is cooked; its spare box from ${at(box.for)} is in the ` +
        `fridge, which keeps ${FRIDGE_DAYS} days. Give it its own protein.`,
      [ref],
    );
  }
  if (!boxing && meals.length >= MIN_POT_MEALS) {
    const share = potShareG(pot.rawG, meals.length);
    if (share < food.minG || share > food.maxG) {
      add(
        `Pot ${pot.id}: ${pot.rawG} g over ${meals.length} meals is ${share} g a meal, outside the ` +
          `${food.minG}–${food.maxG} g one meal takes. ` +
          (share > food.maxG ? "Feed more meals from it or make it smaller." : "Feed fewer meals from it or make it bigger."),
      );
    }
  }
  return out;
}

function isFishy(meal: Meal): boolean {
  return (meal.items ?? []).some((i) => {
    const tags = foodById(i.foodId)?.tags ?? [];
    return tags.includes("fish") || tags.includes("seafood");
  });
}

/** Made meals with fish or seafood in a week. */
export function fishMeals(plan: WeekPlan): number {
  let n = 0;
  for (const day of plan.days) for (const key of MEAL_KEYS) if (day[key].mode === "make" && isFishy(day[key])) n++;
  return n;
}

/**
 * Hold a drafted week to the rules, solving its grams on the way.
 *
 * With `changed`, the per-meal rules read only those meals and the flavour
 * rule only the pairs that touch one of them: an adjustment answers for what
 * it wrote, not for the week around it.
 */
export function checkPlan(input: CheckInput): CheckResult {
  const { profile, targets } = input;
  const changed = input.changed ?? null;
  const inScope = (ref: MealRef) => !changed || changed.some((c) => sameMeal(c, ref));

  const problems: string[] = [];
  const named: MealRef[] = [];
  const fail = (text: string, ...refs: MealRef[]) => {
    problems.push(text);
    for (const ref of refs) if (!named.some((n) => sameMeal(n, ref))) named.push(ref);
  };
  const failing = (plan: WeekPlan) =>
    mealsInOrder(plan)
      .map((m) => m.ref)
      .filter((ref) => named.some((n) => sameMeal(n, ref)));

  for (const day of input.plan.days) {
    for (const key of MEAL_KEYS) {
      const ref = { date: day.date, meal: key };
      const meal = day[key];
      if (meal.mode !== "make" || !inScope(ref)) continue;
      if (meal.pot && !potById(input.plan, meal.pot)) {
        fail(`${where(input.plan, ref)} eats from pot ${meal.pot}, which pots does not define.`, ref);
        continue;
      }
      for (const text of templateProblems(where(input.plan, ref), meal, key)) fail(text, ref);
    }
  }
  // A pot answers for itself in a fresh week; in an adjustment, when the draft
  // sent it or touched one of its meals.
  const sent = input.pots ?? [];
  const potInScope = (pot: Pot) =>
    !changed ||
    sent.includes(pot.id) ||
    potMeals(input.plan, pot.id).some(inScope) ||
    (input.previous ? potMeals(input.previous, pot.id).some(inScope) : false);
  for (const pot of input.plan.pots ?? []) {
    if (!potInScope(pot)) continue;
    for (const p of potProblems(input.plan, pot)) fail(p.text, ...p.refs);
  }
  if (problems.length) return { plan: input.plan, problems, failing: failing(input.plan) };

  const plan = solvePlan(input.plan, targets, profile);
  // A proper meal the reader asked for is exempt; every other made meal is
  // held to what their effort level allows.
  const cap = minuteCap(profile);
  for (const day of plan.days) {
    const dayT = dayTargetsOn(targets, profile, day.date);
    for (const key of MEAL_KEYS) {
      const meal = day[key];
      const ref = { date: day.date, meal: key };
      if (meal.mode !== "make" || !inScope(ref)) continue;
      const at = where(plan, ref);
      if (!meal.proper && (meal.minutes ?? 0) > cap) {
        fail(`${at} takes ${meal.minutes} minutes; they allow ${cap}.`, ref);
      }
      for (const item of meal.items ?? []) {
        const food = foodById(item.foodId);
        if (food && !foodAllowed(food, profile.dislikes)) fail(`${at} uses ${food.id}, which they do not eat.`, ref);
      }
      const numbers = mealNumbers(meal, key, dayT);
      if (numbers && !numbers.cells.protein) {
        const p = numbers.rows.find((r) => r.role === "protein");
        fail(
          `${at}: protein reaches only ${Math.round(numbers.totals.protein)} g of the ` +
            `${Math.round(numbers.target.protein)} g this meal needs` +
            (p ? ` with ${p.grams} g of ${p.food.id}` : "") +
            ". Add a second protein food as a fixed item: an egg, tofu, a cup of soy milk.",
          ref,
        );
      }
    }
  }

  // Calories: the portions are normal ones and every staple has a cap, so a
  // day of light foods can fall well short. Any meal of the day can mend it,
  // so the text names the day and no meal.
  for (const day of plan.days) {
    if (!MEAL_KEYS.some((key) => inScope({ date: day.date, meal: key }))) continue;
    const dayT = dayTargetsOn(targets, profile, day.date);
    let got = 0;
    let want = 0;
    for (const key of MEAL_KEYS) {
      const numbers = mealNumbers(day[key], key, dayT);
      if (!numbers) continue;
      got += numbers.totals.kcal;
      want += numbers.target.kcal;
    }
    if (want > 0 && got < DAY_KCAL_FLOOR * want) {
      problems.push(
        `Day ${dayIndexOf(plan, day.date)} comes to ${Math.round(got)} kcal of the ${Math.round(want)} its meals are ` +
          "for, under 90%. Add a fixed item to one of its meals: milk, a second serving of a staple, or nuts.",
      );
    }
  }

  // Flavour: two main meals in a row, across the night, never taste the same.
  const mains: { ref: MealRef; meal: Meal }[] = [];
  for (const day of plan.days) for (const key of MAIN_MEAL_KEYS) mains.push({ ref: { date: day.date, meal: key }, meal: day[key] });
  for (let i = 1; i < mains.length; i++) {
    const a = mains[i - 1];
    const b = mains[i];
    if (!a || !b || a.meal.mode !== "make" || b.meal.mode !== "make") continue;
    if (!a.meal.flavour || a.meal.flavour !== b.meal.flavour) continue;
    if (!inScope(a.ref) && !inScope(b.ref)) continue;
    fail(`${where(plan, a.ref)} and ${where(plan, b.ref)} are both ${a.meal.flavour}; change one.`, a.ref, b.ref);
  }

  const noFish = profile.dislikes.some((d) => d.trim() === "fish" || d.trim() === "seafood");
  const fish = fishMeals(plan);
  const before = input.previous ? fishMeals(input.previous) : Infinity;
  if (!noFish && fish < 2 && fish < before) {
    problems.push(`The week has ${fish} fish or seafood meal${fish === 1 ? "" : "s"}; it needs at least two.`);
  }

  return { plan, problems, failing: failing(plan) };
}
