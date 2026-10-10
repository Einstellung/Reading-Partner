// The week's pots (docs/73 一锅): one protein food cooked once and eaten over
// two to four meals. The model says what is cooked at which meal and which
// meals eat from it; everything here is the program's — each meal's share,
// where it waits until it is eaten, the night a frozen one comes out, and what
// a deviation leaves of a pot. Pure, unit-tested.

import { daysBetween } from "../../../platform/std/day";
import { MEAL_KEYS, type MealRef, type Pot, type WeekPlan } from "./types";

/** Where a share waits until its meal: eaten as cooked, in the fridge, or in the freezer. */
export type PotStorage = "fresh" | "fridge" | "freezer";

// Cooked meat keeps three days in the fridge: a share eaten up to two days
// after the cook day waits there, a later one is frozen the day it is cooked.
export const FRIDGE_DAYS = 2;
// The latest a share is eaten, in days after the cook day. Frozen it would keep
// for months; this keeps a pot inside one week's plan and one trip's shopping.
export const MAX_POT_DAYS = 6;
export const MIN_POT_MEALS = 2;
export const MAX_POT_MEALS = 4;

/** Week order: by date, then breakfast, lunch, dinner, snack. */
export function compareRefs(a: MealRef, b: MealRef): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return MEAL_KEYS.indexOf(a.meal) - MEAL_KEYS.indexOf(b.meal);
}

export function refKey(ref: MealRef): string {
  return `${ref.date}|${ref.meal}`;
}

const same = (a: MealRef, b: MealRef) => a.date === b.date && a.meal === b.meal;

export function potById(plan: Pick<WeekPlan, "pots">, id: string): Pot | undefined {
  return plan.pots?.find((p) => p.id === id);
}

/** The made meals that eat from a pot, in week order. */
export function potMeals(plan: WeekPlan, id: string): MealRef[] {
  const out: MealRef[] = [];
  for (const day of plan.days) {
    for (const key of MEAL_KEYS) {
      const meal = day[key];
      if (meal.mode === "make" && meal.pot === id) out.push({ date: day.date, meal: key });
    }
  }
  return out;
}

/** One meal's share: the raw grams over the meals, to 5 g. */
export function potShareG(rawG: number, meals: number): number {
  return meals > 0 ? Math.round(rawG / meals / 5) * 5 : 0;
}

/** Where a share waits: the cook meal eats it fresh, the next two days keep it cold, later ones freeze. */
export function potStorage(cook: MealRef, ref: MealRef): PotStorage {
  if (same(cook, ref)) return "fresh";
  const days = daysBetween(cook.date, ref.date) ?? 0;
  return days <= FRIDGE_DAYS ? "fridge" : "freezer";
}

/** One meal's share of a pot, and the pot around it. */
export interface PotPortion {
  pot: Pot;
  // This meal's place among the pot's meals, from 1.
  index: number;
  count: number;
  shareG: number;
  storage: PotStorage;
  // This is the meal the pot is cooked at.
  cooks: boolean;
  // The shares after the cook meal's, in week order, with where each waits:
  // the boxes the packing step fills.
  boxes: { ref: MealRef; storage: PotStorage }[];
}

/**
 * Every meal's share of a pot, by refKey. A pot left with fewer than two meals
 * (a deviation took the others) is no pot: its meal is solved like any other.
 */
export function potPortions(plan: WeekPlan): Map<string, PotPortion> {
  const out = new Map<string, PotPortion>();
  for (const pot of plan.pots ?? []) {
    const meals = potMeals(plan, pot.id);
    if (meals.length < MIN_POT_MEALS) continue;
    const shareG = potShareG(pot.rawG, meals.length);
    const boxes = meals.filter((r) => !same(r, pot.cook)).map((ref) => ({ ref, storage: potStorage(pot.cook, ref) }));
    meals.forEach((ref, i) => {
      out.set(refKey(ref), {
        pot,
        index: i + 1,
        count: meals.length,
        shareG,
        storage: potStorage(pot.cook, ref),
        cooks: same(ref, pot.cook),
        boxes,
      });
    });
  }
  return out;
}

/** The frozen shares eaten the day after `date`: what moves from the freezer to the fridge tonight. */
export function thawTonight(plan: WeekPlan, date: string): { pot: Pot; ref: MealRef }[] {
  const out: { pot: Pot; ref: MealRef }[] = [];
  for (const [, portion] of potPortions(plan)) {
    for (const box of portion.boxes) {
      if (box.storage !== "freezer" || daysBetween(date, box.ref.date) !== 1) continue;
      if (out.some((o) => same(o.ref, box.ref))) continue;
      out.push({ pot: portion.pot, ref: box.ref });
    }
  }
  return out.sort((a, b) => compareRefs(a.ref, b.ref));
}

/**
 * The pots as a deviation leaves them: one no meal eats from any more is
 * dropped, and one whose cook meal stopped eating from it is cooked at the
 * first meal that still does.
 */
export function settlePots(plan: WeekPlan): WeekPlan {
  if (!plan.pots) return plan;
  const pots: Pot[] = [];
  for (const pot of plan.pots) {
    const meals = potMeals(plan, pot.id);
    const first = meals[0];
    if (!first) continue;
    pots.push(meals.some((r) => same(r, pot.cook)) ? pot : { ...pot, cook: first });
  }
  const { pots: _, ...rest } = plan;
  return pots.length ? { ...rest, pots } : rest;
}
