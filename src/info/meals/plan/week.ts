// The week read as a week (docs/73): which day is today, which weekday a date
// is, whether the plan has run out, what one deviation does to the meals
// around it, and the plan a model's draft becomes. Pure, unit-tested.
//
// Every one of these is a fact the program owns. None of it is ever asked of
// the model: a model that is told today's date still counts days wrong.

import { addDays, daysBetween, isoWeekday } from "../../../platform/std/day";
import type { TemplateItem } from "../nutrition/solve";
import { dayPlan, isTrainingDay, type Profile } from "../nutrition/targets";
import {
  MAIN_MEAL_KEYS,
  MEAL_KEYS,
  type DayPlan,
  type Deviation,
  type Flavour,
  type Meal,
  type MealKey,
  type MealMode,
  type MealRef,
  type WeekPlan,
} from "./types";

export const WEEK_DAYS = 7;

// What decides the order a day's meals are eaten in.
type DayOrderProfile = Pick<Profile, "trainingDays" | "trainTime">;

// The calendar arithmetic is platform/std/day's; re-exported because the rest
// of meals reads it from here.
export { addDays, daysBetween, isoWeekday };

/** The seven local dates a week starting on `startDate` covers. */
export function weekDates(startDate: string): string[] {
  return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(startDate, i));
}

/** The plan's last day, or "" when it has none. */
export function lastDate(plan: WeekPlan): string {
  return plan.days.length ? (plan.days[plan.days.length - 1]?.date ?? "") : "";
}

/** The day the plan has for this date, or null. */
export function dayOn(plan: WeekPlan | null, date: string): DayPlan | null {
  return plan?.days.find((d) => d.date === date) ?? null;
}

/** One meal of one day, or null when the plan does not cover that date. */
export function mealOn(plan: WeekPlan | null, date: string, meal: MealKey): Meal | null {
  return dayOn(plan, date)?.[meal] ?? null;
}

/** Two refs pointing at the same meal. */
export function sameMeal(a: MealRef | undefined, b: MealRef | undefined): boolean {
  return Boolean(a && b && a.date === b.date && a.meal === b.meal);
}

/** The day number (1..7) a date has in the plan, or 0 when it has none. */
export function dayIndexOf(plan: WeekPlan, date: string): number {
  const d = daysBetween(plan.startDate, date);
  return d === null || d < 0 || d >= WEEK_DAYS ? 0 : d + 1;
}

/** Every meal of the week, day by day in canonical order, each with its ref. */
export function mealsInOrder(plan: WeekPlan): { ref: MealRef; meal: Meal }[] {
  const out: { ref: MealRef; meal: Meal }[] = [];
  for (const day of plan.days) {
    for (const key of MEAL_KEYS) out.push({ ref: { date: day.date, meal: key }, meal: day[key] });
  }
  return out;
}

/** Today and tomorrow — the two days the screen leads with. */
export function todayAndTomorrow(
  plan: WeekPlan | null,
  localDate: string,
): { today: DayPlan | null; tomorrow: DayPlan | null } {
  return { today: dayOn(plan, localDate), tomorrow: dayOn(plan, addDays(localDate, 1)) };
}

/**
 * Whether the week has been eaten through: there is no plan at all, or the date
 * is past its last day. Nothing re-plans on its own.
 */
export function planExhausted(plan: WeekPlan | null, localDate: string): boolean {
  if (!plan || plan.days.length === 0) return true;
  const diff = daysBetween(lastDate(plan), localDate);
  return diff === null ? true : diff > 0;
}

/** A week's id. One week per start date, so the date is the id. */
export function weekId(startDate: string): string {
  return `week-${startDate}`;
}

// What a meal keeps when it becomes something else. Only a made meal carries a
// template; the other modes carry a place.
function settle(meal: Meal, became: MealMode, place: string | undefined): Meal {
  if (became === "make") return meal.mode === "make" ? meal : { mode: "make" };
  const next: Meal = { mode: became };
  if (place) next.place = place;
  if (meal.note) next.note = meal.note;
  return next;
}

/**
 * What one deviation does to the plan (docs/73 偏离).
 *
 * It moves the meal it is about and names at most two meals for the model to
 * re-pick the foods of: the meal itself when it became a made meal with no
 * foods yet, or the next made main meal today or tomorrow when a made meal was
 * not eaten, since its foods are now in the fridge. Nothing else moves and
 * nothing is re-planned. A deviation about a date the plan does not cover
 * changes nothing.
 */
export function applyDeviation(
  plan: WeekPlan,
  deviation: Deviation,
  profile: DayOrderProfile | null = null,
): { plan: WeekPlan; attention: MealRef[] } {
  const target = dayOn(plan, deviation.date);
  const before = target?.[deviation.meal];
  if (!target || !before) return { plan, attention: [] };

  const ref: MealRef = { date: deviation.date, meal: deviation.meal };
  const settled = settle(before, deviation.became, deviation.place);
  const days = plan.days.map((d) => (d.date === ref.date ? { ...d, [ref.meal]: settled } : d));
  const next: WeekPlan = { ...plan, days, revision: plan.revision + 1 };

  const attention: MealRef[] = [];
  if (settled.mode === "make" && !settled.items?.length) attention.push(ref);
  if (before.mode === "make" && settled.mode !== "make") {
    const after = nextMadeMainMeal(next, ref, profile);
    if (after) attention.push(after);
  }
  return { plan: next, attention: attention.slice(0, 2) };
}

// The first made main meal after `ref`, within that day and the next. "After"
// is the order the day is eaten in, which puts the snack after training on a
// training day (nutrition/targets.ts dayPlan); without a profile it is a rest
// day's order.
function nextMadeMainMeal(plan: WeekPlan, ref: MealRef, profile: DayOrderProfile | null): MealRef | null {
  const limit = addDays(ref.date, 1);
  const training = profile ? isTrainingDay(profile, isoWeekday(ref.date)) : false;
  const eaten = dayPlan(training, profile?.trainTime ?? "evening").order;
  const order = (key: MealKey) => eaten.indexOf(key);
  for (const day of plan.days) {
    if (day.date < ref.date || day.date > limit) continue;
    for (const key of MAIN_MEAL_KEYS) {
      if (day.date === ref.date && order(key) <= order(ref.meal)) continue;
      if (day[key].mode === "make") return { date: day.date, meal: key };
    }
  }
  return null;
}

// --- assembling a week out of what the model drafted -------------------------

// One meal as the model hands it over. It never writes a date or a number the
// program computes; the fixed items' grams are the only amounts it gives.
export interface MealDraft {
  mode: MealMode;
  name?: string;
  searchName?: string;
  flavour?: Flavour;
  method?: string;
  minutes?: number;
  items?: TemplateItem[];
  place?: string;
  note?: string;
}

// One day as the model hands it over. `day` is 1..7, the position in the week
// exactly as the model was shown it.
export interface DayDraft {
  day: number;
  breakfast?: MealDraft;
  lunch?: MealDraft;
  dinner?: MealDraft;
  snack?: MealDraft;
}

export interface WeekDraft {
  days: DayDraft[];
}

export interface AssembleOptions {
  // Day one of the week. The host's, not the model's.
  startDate: string;
  createdAt: number;
  // The week already on disk, when this draft adjusts it rather than replacing
  // it. Its dates and its untouched meals are kept.
  previous?: WeekPlan | null;
}

export interface AssembledWeek {
  plan: WeekPlan;
  // The meals this draft writes. Every meal of a fresh week; only the meals
  // supplied, for an adjustment.
  changed: MealRef[];
  // The dates those meals fall on, for the card to highlight.
  changedDates: string[];
  // Day numbers outside the week, in sentences the model can act on.
  problems: string[];
}

function emptyDay(date: string): DayPlan {
  return { date, breakfast: { mode: "skip" }, lunch: { mode: "skip" }, dinner: { mode: "skip" }, snack: { mode: "skip" } };
}

function mealFromDraft(d: MealDraft): Meal {
  if (d.mode !== "make") {
    const meal: Meal = { mode: d.mode };
    if (d.place) meal.place = d.place;
    if (d.note) meal.note = d.note;
    return meal;
  }
  const meal: Meal = { mode: "make", items: d.items ?? [] };
  if (d.name) meal.name = d.name;
  if (d.searchName) meal.searchName = d.searchName;
  if (d.flavour) meal.flavour = d.flavour;
  if (d.method) meal.method = d.method;
  if (d.minutes !== undefined) meal.minutes = d.minutes;
  if (d.note) meal.note = d.note;
  return meal;
}

/**
 * The plan a draft becomes: dates counted from day one, every meal placed. The
 * grams are not here — solve-week.ts solves them against the reader's targets
 * and checks.ts holds the plan to the rules.
 *
 * An adjustment keeps every meal it does not mention.
 */
export function assembleWeekPlan(draft: WeekDraft, opts: AssembleOptions): AssembledWeek {
  const previous = opts.previous ?? null;
  const startDate = previous?.startDate ?? opts.startDate;
  const problems: string[] = [];

  const days: DayPlan[] = weekDates(startDate).map((date) => {
    const kept = previous?.days.find((d) => d.date === date);
    return kept ? { ...kept } : emptyDay(date);
  });

  const changed: MealRef[] = [];
  for (const entry of draft.days) {
    const index = Math.round(entry.day) - 1;
    if (index < 0 || index >= WEEK_DAYS) {
      problems.push(`Day ${entry.day} is not one of the seven days of the week.`);
      continue;
    }
    const day = days[index];
    if (!day) continue;
    for (const key of MEAL_KEYS) {
      const drafted = entry[key];
      if (!drafted) continue;
      day[key] = mealFromDraft(drafted);
      changed.push({ date: day.date, meal: key });
    }
  }

  return {
    plan: {
      id: weekId(startDate),
      startDate,
      days,
      createdAt: previous?.createdAt ?? opts.createdAt,
      revision: (previous?.revision ?? 0) + 1,
    },
    changed,
    changedDates: [...new Set(changed.map((c) => c.date))].sort(),
    problems,
  };
}
