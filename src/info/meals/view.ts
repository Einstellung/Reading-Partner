// What the meals screen reads off the state (docs/73 屏幕): the targets card,
// each day with its meals in eating order and every food at its solved grams,
// the week in one line, and the shopping list in aisle order.
//
// All of it here rather than in the .tsx, so the screen's decisions are tested
// without React (CLAUDE.md). Every number is computed by the program from the
// profile and the stored grams; the .tsx formats nothing but what it is given.

import { fishMeals } from "./checks";
import { photoForDish, photoForIngredient, type PhotoCache } from "./dish-photos";
import { ingredientImageUrl } from "./images";
import { foodById, isProduce } from "./nutrition/foods";
import type { MealCells, Nutrition, TemplateItem, TemplateRole } from "./nutrition/solve";
import type { DayTargets, Goal, MealTarget, Profile, Region, Targets } from "./nutrition/targets";
import { dayTargetsOn, mealNumbers, sumNutrition, targetsOf } from "./solve-week";
import {
  FLAVOURS,
  MEAL_KEYS,
  type DayPlan,
  type Flavour,
  type IngredientCategory,
  type KeepsClass,
  type Meal,
  type MealKey,
  type MealMode,
  type MealsState,
  type ShoppingItem,
  type WeekPlan,
} from "./types";
import { addDays, isoWeekday, planExhausted } from "./week";

/** The mode as a plain word. None of them apologetic. */
export function modeWord(mode: MealMode): string {
  switch (mode) {
    case "make":
      return "Make";
    case "out":
      return "Eat out";
    case "delivery":
      return "Delivery";
    case "bought":
      return "Bought";
    case "skip":
      return "Skip";
  }
}

/** Which meal, as its heading. */
export function mealLabel(meal: MealKey): string {
  switch (meal) {
    case "breakfast":
      return "Breakfast";
    case "lunch":
      return "Lunch";
    case "dinner":
      return "Dinner";
    case "snack":
      return "Snack";
  }
}

/** A flavour's label in Chinese, the language the meal names are in. */
export function flavourLabel(flavour: Flavour | null | undefined): string {
  return FLAVOURS.find((f) => f.id === flavour)?.zh ?? "";
}

export function goalLabel(goal: Goal): string {
  return goal === "cut" ? "Lose fat" : goal === "gain" ? "Build muscle" : "Steady energy";
}

/** How long a thing keeps, in words. */
export function keepsLabel(keeps: KeepsClass): string {
  switch (keeps) {
    case "d1-2":
      return "1–2 days";
    case "d3-5":
      return "3–5 days";
    case "w1":
      return "1 week";
    case "w2plus":
      return "2+ weeks";
    case "pantry":
      return "pantry";
  }
}

/** The aisle's heading. */
export function categoryLabel(category: IngredientCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The weekday a local "YYYY-MM-DD" falls on, read as UTC so the host zone cannot move it. */
export function weekdayName(date: string): string {
  const wd = isoWeekday(date);
  return wd ? (WEEKDAYS[wd % 7] ?? "") : "";
}

/** Today and Tomorrow by name, everything else by its weekday. */
export function dayWord(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return weekdayName(date);
}

// --- the targets card --------------------------------------------------------

export interface TargetsColumn {
  kind: "training" | "rest";
  label: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface TargetsSummary {
  goal: string;
  // Training day and rest day; one of them when the reader only trains or never does.
  columns: TargetsColumn[];
  // The week against maintenance, one sentence.
  line: string;
  // Building muscle at an overweight BMI.
  warning: string | null;
}

export function targetsSummary(targets: Targets, profile: Profile): TargetsSummary {
  const col = (kind: "training" | "rest", t: DayTargets): TargetsColumn => ({
    kind,
    label: kind === "training" ? "Training day" : "Rest day",
    kcal: t.kcal,
    protein: t.protein,
    fat: t.fat,
    carbs: t.carbs,
  });
  const columns: TargetsColumn[] = [];
  if (targets.trainingDaysPerWeek > 0) columns.push(col("training", targets.training));
  if (targets.trainingDaysPerWeek < 7) columns.push(col("rest", targets.rest));
  const avg = Math.round(targets.weekAverageKcal);
  const gap = Math.round(Math.abs(targets.tdeeAverage - targets.weekAverageKcal));
  const line =
    profile.goal === "cut"
      ? `Weekly average ${avg} kcal a day, about ${gap} under maintenance: roughly ${Math.abs(targets.weightChangeKgPerWeek).toFixed(2)} kg a week.`
      : profile.goal === "gain"
        ? `Weekly average ${avg} kcal a day, about ${gap} over maintenance.`
        : `Weekly average ${avg} kcal a day, at maintenance.`;
  const warning =
    profile.goal === "gain" && targets.bmi >= targets.bmiCuts.overweight
      ? `BMI ${targets.bmi.toFixed(1)} is in the overweight range. Losing fat or holding weight first usually works better.`
      : null;
  return { goal: goalLabel(profile.goal), columns, line, warning };
}

// --- days and meals ----------------------------------------------------------

/** One food of a meal at its solved weight. */
export interface IngredientRow {
  foodId: string;
  // The food table's Chinese name.
  name: string;
  // The English name the photograph resolves by.
  en: string;
  role: TemplateRole;
  category: IngredientCategory;
  grams: number;
  // "2 个" for a food counted in units, else null.
  units: string | null;
  kcal: number;
  protein: number;
}

export interface MealView {
  key: MealKey;
  label: string;
  mode: MealMode;
  // The mode as a word, for the meals that are not made.
  word: string;
  // The meal's name, or the place for out, delivery and bought. Empty for a skip.
  name: string;
  flavour: Flavour | null;
  flavourLabel: string;
  minutes: number | null;
  method: string;
  // What the dish photograph is looked up by.
  searchName: string;
  // The main meal eaten right after training.
  postWorkout: boolean;
  target: MealTarget | null;
  // Null for a meal with no grams: not made, or not yet solved.
  totals: Nutrition | null;
  cells: MealCells | null;
  rows: IngredientRow[];
  note: string;
  meal: Meal;
}

export interface DayView {
  date: string;
  word: string;
  weekday: string;
  training: boolean;
  kindLabel: string;
  targets: DayTargets | null;
  // The day's made meals added up.
  totals: Nutrition;
  // In the order they are eaten.
  meals: MealView[];
  // How the day is arranged, one sentence.
  arrangement: string;
  day: DayPlan;
}

function ingredientRows(meal: Meal, key: MealKey, dayT: DayTargets | null): {
  rows: IngredientRow[];
  totals: Nutrition | null;
  cells: MealCells | null;
} {
  const numbers = dayT ? mealNumbers(meal, key, dayT) : null;
  if (!numbers) return { rows: [], totals: null, cells: null };
  const rows = numbers.rows.map((r) => ({
    foodId: r.foodId,
    name: r.food.zh,
    en: r.food.en,
    role: r.role,
    category: r.food.category,
    grams: r.grams,
    units: r.food.unit ? `${Math.round(r.grams / r.food.unit.grams)} ${r.food.unit.label}` : null,
    kcal: r.kcal,
    protein: r.protein,
  }));
  return { rows, totals: numbers.totals, cells: numbers.cells };
}

export function mealView(meal: Meal, key: MealKey, dayT: DayTargets | null): MealView {
  const made = meal.mode === "make";
  const { rows, totals, cells } = made ? ingredientRows(meal, key, dayT) : { rows: [], totals: null, cells: null };
  return {
    key,
    label: mealLabel(key),
    mode: meal.mode,
    word: modeWord(meal.mode),
    name: (made ? meal.name : meal.place) ?? "",
    flavour: made ? (meal.flavour ?? null) : null,
    flavourLabel: made ? flavourLabel(meal.flavour) : "",
    minutes: made ? (meal.minutes ?? null) : null,
    method: made ? (meal.method ?? "") : "",
    searchName: made ? (meal.searchName ?? "") : "",
    postWorkout: dayT?.postWorkout === key,
    target: dayT ? dayT.meals[key] : null,
    totals,
    cells,
    rows,
    note: meal.note ?? "",
    meal,
  };
}

export function dayView(day: DayPlan, today: string, targets: Targets | null, profile: Profile | null): DayView {
  const dayT = targets && profile ? dayTargetsOn(targets, profile, day.date) : null;
  const order: readonly MealKey[] = dayT?.order ?? MEAL_KEYS;
  const meals = order.map((k) => mealView(day[k], k, dayT));
  const training = dayT?.kind === "training";
  return {
    date: day.date,
    word: dayWord(day.date, today),
    weekday: weekdayName(day.date),
    training,
    kindLabel: training ? "Training day" : "Rest day",
    targets: dayT,
    totals: sumNutrition(meals.flatMap((m) => (m.totals ? [m.totals] : []))),
    meals,
    arrangement: training
      ? "The snack moves to right after training; the meal after it carries more of the day's calories."
      : "No training today: a little less food, the same protein.",
    day,
  };
}

/** The line a meal takes on a row: its name, with the flavour after it. */
export function mealName(view: MealView): string {
  return view.flavourLabel ? `${view.name} · ${view.flavourLabel}` : view.name;
}

// --- the week ----------------------------------------------------------------

export interface WeekSummary {
  // Averages over the days that have made meals.
  averageKcal: number;
  averageProtein: number;
  fishMeals: number;
  madeMeals: number;
}

export function weekSummary(plan: WeekPlan, days: readonly DayView[]): WeekSummary {
  const counted = days.filter((d) => d.meals.some((m) => m.totals));
  const avg = (f: (n: Nutrition) => number) =>
    counted.length ? counted.reduce((s, d) => s + f(d.totals), 0) / counted.length : 0;
  return {
    averageKcal: avg((n) => n.kcal),
    averageProtein: avg((n) => n.protein),
    fishMeals: fishMeals(plan),
    madeMeals: plan.days.reduce((s, d) => s + MEAL_KEYS.filter((k) => d[k].mode === "make").length, 0),
  };
}

export interface MealsView {
  profile: Profile | null;
  // Null before onboarding and when the reader withheld body data.
  targets: Targets | null;
  summary: TargetsSummary | null;
  // Every day of the week in date order.
  week: DayView[];
  // The days still ahead, today first; a day already eaten leaves the screen.
  upcoming: DayView[];
  // Today and tomorrow, the two day cards.
  headline: DayView[];
  // Everything after those two, one row each.
  later: DayView[];
  weekSummary: WeekSummary | null;
  // No plan, or the plan's last day is past.
  exhausted: boolean;
}

/** Everything the meals screen draws, from the state, the date and the region. */
export function mealsView(state: MealsState, today: string, region: Region): MealsView {
  const profile = state.charter?.profile ?? null;
  const targets = targetsOf(state.charter, region);
  const plan = state.plan;
  const week = plan ? plan.days.map((d) => dayView(d, today, targets, profile)) : [];
  const upcoming = week.filter((d) => d.date >= today);
  return {
    profile,
    targets,
    summary: targets && profile ? targetsSummary(targets, profile) : null,
    week,
    upcoming,
    headline: upcoming.slice(0, 2),
    later: upcoming.slice(2),
    weekSummary: plan ? weekSummary(plan, week) : null,
    exhausted: planExhausted(plan, today),
  };
}

/** One day by its date, or null when the plan does not cover it. */
export function dayViewOn(state: MealsState, date: string, today: string, region: Region): DayView | null {
  const day = state.plan?.days.find((d) => d.date === date);
  if (!day) return null;
  return dayView(day, today, targetsOf(state.charter, region), state.charter?.profile ?? null);
}

// --- pictures ----------------------------------------------------------------

// The line under a dish photograph, and where it goes when it is tapped.
export interface DishPhotoCredit {
  text: string;
  url: string;
}

/** A picture on the screen, and the page it was found on for the proxy's Referer (pitfall 30). */
export interface Picture {
  url: string;
  pageUrl: string | null;
}

/** The photograph the search found for a meal, by its searchName. */
export function dishPicture(meal: { searchName?: string } | null | undefined, photos: PhotoCache | undefined): Picture | null {
  const photo = photoForDish(meal, photos);
  return photo ? { url: photo.url, pageUrl: photo.pageUrl || null } : null;
}

/**
 * The picture a food shows: TheMealDB's cut-out where there is one, and what
 * the search found otherwise (docs/73 图片).
 */
export function ingredientPicture(
  en: string,
  photos: PhotoCache | undefined,
  bank: (name: string) => string | null = ingredientImageUrl,
): Picture | null {
  const banked = bank(en);
  if (banked) return { url: banked, pageUrl: null };
  const photo = photoForIngredient(en, photos);
  return photo ? { url: photo.url, pageUrl: photo.pageUrl || null } : null;
}

/** "Photo: example.com" and the page it opens, or null for a meal drawn from its foods. */
export function dishPhotoCredit(
  meal: { searchName?: string } | null | undefined,
  photos: PhotoCache | undefined,
): DishPhotoCredit | null {
  const photo = photoForDish(meal, photos);
  if (!photo) return null;
  const site = photo.site.trim();
  const url = photo.pageUrl.trim();
  if (!site || !url) return null;
  return { text: `Photo: ${site}`, url };
}

const THUMBNAIL_LIMIT = 4;

/**
 * Up to four food cut-outs standing in for a meal with no photograph of its
 * own: the protein and the vegetables and fruit first, oils and sauces last.
 * Foods no bank has a picture of are skipped.
 */
export function dishThumbnails(
  items: readonly TemplateItem[] | undefined,
  resolve: (name: string) => string | null = ingredientImageUrl,
): string[] {
  const front: string[] = [];
  const back: string[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const food = foodById(item.foodId);
    const url = food ? resolve(food.en) : null;
    if (!food || !url || seen.has(url)) continue;
    seen.add(url);
    (item.role === "protein" || item.role === "staple" || isProduce(food) ? front : back).push(url);
  }
  return [...front, ...back].slice(0, THUMBNAIL_LIMIT);
}

// --- the shopping list -------------------------------------------------------

/** The second line of a shopping row: how long it keeps, and the one instruction a line can carry. */
export function shoppingNote(item: ShoppingItem): string {
  return keepsLabel(item.keeps) + (item.freezeOnArrival ? " · freeze on arrival" : "");
}
