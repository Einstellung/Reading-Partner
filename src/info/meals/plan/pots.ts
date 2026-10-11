// The week's pots (docs/73 一锅): one protein food cooked once and eaten over
// two to four meals. The model says what is cooked at which meal and which
// meals eat from it; everything here is the program's — each meal's share,
// where it waits until it is eaten, the night a frozen one comes out, and what
// a deviation leaves of a pot. Pure, unit-tested.

import { daysBetween } from "../../../platform/std/day";
import { MEAL_KEYS, type MealRef, type Pot, type PotBox, type WeekPlan } from "./types";

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

/**
 * Which meal eats which box of a packed pot (Pot.packed). A meal eats the box
 * written for it; a meal the plan later put on the pot takes a spare, a fridge
 * one when it is within FRIDGE_DAYS of the cook day and a frozen one otherwise.
 * Boxes no meal eats are the spares; a meal no box is left for is unboxed.
 * Null for a pot not packed.
 */
export function potBoxing(
  plan: WeekPlan,
  pot: Pot,
): { taken: { ref: MealRef; box: PotBox }[]; spares: PotBox[]; unboxed: MealRef[] } | null {
  if (!Array.isArray(pot.packed)) return null;
  const free = [...pot.packed].sort((a, b) => compareRefs(a.for, b.for));
  const take = (i: number) => free.splice(i, 1)[0] as PotBox;
  const taken: { ref: MealRef; box: PotBox }[] = [];
  const rest: MealRef[] = [];
  for (const ref of potMeals(plan, pot.id)) {
    if (same(ref, pot.cook)) continue;
    const i = free.findIndex((b) => same(b.for, ref));
    if (i >= 0) taken.push({ ref, box: take(i) });
    else rest.push(ref);
  }
  const unboxed: MealRef[] = [];
  for (const ref of rest) {
    const wants = (daysBetween(pot.cook.date, ref.date) ?? 0) <= FRIDGE_DAYS ? "fridge" : "freezer";
    const i = free.findIndex((b) => b.storage === wants);
    const j = i >= 0 ? i : free.length ? 0 : -1;
    if (j >= 0) taken.push({ ref, box: take(j) });
    else unboxed.push(ref);
  }
  return { taken, spares: free, unboxed };
}

/** One meal's share of a pot, and the pot around it. */
export interface PotPortion {
  pot: Pot;
  ref: MealRef;
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
 * A packed pot keeps the split and the labels it was packed with; a meal with
 * no box left has no share.
 */
export function potPortions(plan: WeekPlan): Map<string, PotPortion> {
  const out = new Map<string, PotPortion>();
  for (const pot of plan.pots ?? []) {
    const boxing = potBoxing(plan, pot);
    if (boxing) {
      const packed = [...(pot.packed ?? [])].sort((a, b) => compareRefs(a.for, b.for));
      const count = packed.length + 1;
      const boxes = packed.map((b) => ({ ref: b.for, storage: b.storage }));
      const base = { pot, count, shareG: potShareG(pot.rawG, count), boxes };
      if (potMeals(plan, pot.id).some((r) => same(r, pot.cook))) {
        out.set(refKey(pot.cook), { ...base, ref: pot.cook, index: 1, storage: "fresh", cooks: true });
      }
      for (const { ref, box } of boxing.taken) {
        out.set(refKey(ref), { ...base, ref, index: packed.indexOf(box) + 2, storage: box.storage, cooks: false });
      }
      continue;
    }
    const meals = potMeals(plan, pot.id);
    if (meals.length < MIN_POT_MEALS) continue;
    const shareG = potShareG(pot.rawG, meals.length);
    const boxes = meals.filter((r) => !same(r, pot.cook)).map((ref) => ({ ref, storage: potStorage(pot.cook, ref) }));
    meals.forEach((ref, i) => {
      out.set(refKey(ref), {
        pot,
        ref,
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
  for (const portion of potPortions(plan).values()) {
    if (portion.storage !== "freezer" || daysBetween(date, portion.ref.date) !== 1) continue;
    out.push({ pot: portion.pot, ref: portion.ref });
  }
  return out.sort((a, b) => compareRefs(a.ref, b.ref));
}

/** The meal that went differently, the plan before it did, and today's local date. */
export interface PotLeft {
  ref: MealRef;
  before: WeekPlan;
  today: string | null;
}

/**
 * The pots as a deviation leaves them: one no meal eats from any more is
 * dropped, and one whose cook meal stopped eating from it is cooked at the
 * first meal that still does and split again. A pot cooked today or earlier
 * whose cook meal still eats from it is already in boxes: the meal that went
 * differently packs it as it was, and its box becomes a spare.
 */
export function settlePots(plan: WeekPlan, left?: PotLeft): WeekPlan {
  if (!plan.pots) return plan;
  const was = left ? potPortions(left.before).get(refKey(left.ref)) : undefined;
  const today = left?.today ?? null;
  const pots: Pot[] = [];
  for (const pot of plan.pots) {
    const meals = potMeals(plan, pot.id);
    const first = meals[0];
    if (!first) continue;
    if (!meals.some((r) => same(r, pot.cook))) {
      const { packed: _, ...rest } = pot;
      pots.push({ ...rest, cook: first });
      continue;
    }
    const cooked = today !== null && pot.cook.date <= today;
    if (cooked && !pot.packed && was && was.pot.id === pot.id && !was.cooks) {
      const packed: PotBox[] = was.boxes.map((b) => ({ for: b.ref, storage: b.storage === "freezer" ? "freezer" : "fridge" }));
      pots.push({ ...pot, packed });
    } else {
      pots.push(pot);
    }
  }
  const { pots: _, ...rest } = plan;
  return pots.length ? { ...rest, pots } : rest;
}
