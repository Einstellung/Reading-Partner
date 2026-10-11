// What the meals screen reads off the state (docs/73 屏幕): the targets card,
// each day with its meals in eating order and every food at its solved grams,
// the week in one line, and the shopping list in aisle order.
//
// All of it here rather than in the .tsx, so the screen's decisions are tested
// without React (CLAUDE.md). Every number is computed by the program from the
// profile and the stored grams; the .tsx formats nothing but what it is given.

import { formatDateTime, getLocale, t, translate } from "../../../i18n";
import { fishMeals } from "../plan/checks";
import { photoForDish, photoForIngredient, type PhotoCache } from "../photos/dish-photos";
import { ingredientImageUrl } from "../photos/images";
import { foodById, isProduce } from "../nutrition/foods";
import type { MealCells, Nutrition, TemplateItem, TemplateRole } from "../nutrition/solve";
import type { DayTargets, Goal, MealTarget, Profile, Region, Targets } from "../nutrition/targets";
import { potPortions, refKey, thawTonight, type PotPortion } from "../plan/pots";
import { dayTargetsOn, mealNumbers, sumNutrition, targetsOf } from "../plan/solve-week";
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
} from "../plan/types";
import { addDays, isoWeekday, planExhausted } from "../plan/week";

/** The mode as a plain word. None of them apologetic. */
export function modeWord(mode: MealMode): string {
  switch (mode) {
    case "make":
      return t("meals.mode.make");
    case "out":
      return t("meals.mode.out");
    case "delivery":
      return t("meals.mode.delivery");
    case "bought":
      return t("meals.mode.bought");
    case "skip":
      return t("meals.mode.skip");
  }
}

/** Which meal, as its heading. */
export function mealLabel(meal: MealKey): string {
  switch (meal) {
    case "breakfast":
      return t("meals.meal.breakfast");
    case "lunch":
      return t("meals.meal.lunch");
    case "dinner":
      return t("meals.meal.dinner");
    case "snack":
      return t("meals.meal.snack");
  }
}

/** A flavour's label, in the current UI language. */
export function flavourLabel(flavour: Flavour | null | undefined): string {
  if (!flavour) return "";
  const known = FLAVOURS.some((f) => f.id === flavour);
  return known ? translate(getLocale(), `meals.flavour.${flavour}`) : "";
}

export function goalLabel(goal: Goal): string {
  return goal === "cut" ? t("meals.goal.cut") : goal === "gain" ? t("meals.goal.gain") : t("meals.goal.steady");
}

/** How long a thing keeps, in words. */
export function keepsLabel(keeps: KeepsClass): string {
  switch (keeps) {
    case "d1-2":
      return t("meals.keeps.d1-2");
    case "d3-5":
      return t("meals.keeps.d3-5");
    case "w1":
      return t("meals.keeps.w1");
    case "w2plus":
      return t("meals.keeps.w2plus");
    case "pantry":
      return t("meals.keeps.pantry");
  }
}

/** The aisle's heading. */
export function categoryLabel(category: IngredientCategory): string {
  return translate(getLocale(), `meals.category.${category}`);
}

/** The weekday a local "YYYY-MM-DD" falls on, read as UTC so the host zone cannot move it, in the UI language. */
export function weekdayName(date: string): string {
  const wd = isoWeekday(date);
  if (!wd) return "";
  return formatDateTime(new Date(`${date}T00:00:00Z`), { weekday: "long", timeZone: "UTC" });
}

/** Today and Tomorrow by name, everything else by its weekday. */
export function dayWord(date: string, today: string): string {
  if (date === today) return t("meals.today");
  if (date === addDays(today, 1)) return t("meals.tomorrow");
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
  const col = (kind: "training" | "rest", d: DayTargets): TargetsColumn => ({
    kind,
    label: kind === "training" ? t("meals.trainingDay") : t("meals.restDay"),
    kcal: d.kcal,
    protein: d.protein,
    fat: d.fat,
    carbs: d.carbs,
  });
  const columns: TargetsColumn[] = [];
  if (targets.trainingDaysPerWeek > 0) columns.push(col("training", targets.training));
  if (targets.trainingDaysPerWeek < 7) columns.push(col("rest", targets.rest));
  const avg = Math.round(targets.weekAverageKcal);
  const gap = Math.round(Math.abs(targets.tdeeAverage - targets.weekAverageKcal));
  const line =
    profile.goal === "cut"
      ? t("meals.targetsLine.cut", {
          avg,
          gap,
          kg: Math.abs(targets.weightChangeKgPerWeek).toFixed(2),
        })
      : profile.goal === "gain"
        ? t("meals.targetsLine.gain", { avg, gap })
        : t("meals.targetsLine.steady", { avg });
  const warning =
    profile.goal === "gain" && targets.bmi >= targets.bmiCuts.overweight
      ? t("meals.overweightWarning", { bmi: targets.bmi.toFixed(1) })
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
  // "卤牛腱一锅的 1/4", standing in for the name on a meal's share of a pot.
  potLabel: string | null;
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
  // This meal's share of a pot, or null.
  pot: PotPortion | null;
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
  // Tonight's move from the freezer to the fridge, one line per box.
  thaw: string[];
  day: DayPlan;
}

/** "卤牛腱一锅的 1/4": a meal's share of a pot, as its ingredient row reads. */
export function potLabel(portion: Pick<PotPortion, "pot" | "count">): string {
  return t("meals.pot.label", { name: portion.pot.name, count: portion.count });
}

/** One meal of the week by its weekday and label: "星期三午餐". */
export function boxName(ref: { date: string; meal: MealKey }): string {
  return t("meals.pot.box", { weekday: weekdayName(ref.date), meal: mealLabel(ref.meal) });
}

/** The day card's line for a frozen share eaten tomorrow. */
export function thawLine(entry: { pot: { name: string }; ref: { date: string; meal: MealKey } }): string {
  return t("meals.pot.thaw", { box: boxName(entry.ref), name: entry.pot.name });
}

function ingredientRows(meal: Meal, key: MealKey, dayT: DayTargets | null, portion: PotPortion | null): {
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
    potLabel: portion && r.role === "protein" && r.foodId === portion.pot.foodId ? potLabel(portion) : null,
    kcal: r.kcal,
    protein: r.protein,
  }));
  return { rows, totals: numbers.totals, cells: numbers.cells };
}

export function mealView(meal: Meal, key: MealKey, dayT: DayTargets | null, portion: PotPortion | null = null): MealView {
  const made = meal.mode === "make";
  const pot = made ? portion : null;
  const { rows, totals, cells } = made ? ingredientRows(meal, key, dayT, pot) : { rows: [], totals: null, cells: null };
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
    pot,
    meal,
  };
}

/** One day as the screen draws it. `plan` is the week it belongs to, which its pots are read from. */
export function dayView(
  day: DayPlan,
  today: string,
  targets: Targets | null,
  profile: Profile | null,
  plan: WeekPlan | null = null,
): DayView {
  const dayT = targets && profile ? dayTargetsOn(targets, profile, day.date) : null;
  const order: readonly MealKey[] = dayT?.order ?? MEAL_KEYS;
  const portions = plan ? potPortions(plan) : new Map<string, PotPortion>();
  const meals = order.map((k) => mealView(day[k], k, dayT, portions.get(refKey({ date: day.date, meal: k })) ?? null));
  const training = dayT?.kind === "training";
  return {
    date: day.date,
    word: dayWord(day.date, today),
    weekday: weekdayName(day.date),
    training,
    kindLabel: training ? t("meals.trainingDay") : t("meals.restDay"),
    targets: dayT,
    totals: sumNutrition(meals.flatMap((m) => (m.totals ? [m.totals] : []))),
    meals,
    arrangement: training ? t("meals.arrangementTraining") : t("meals.arrangementRest"),
    thaw: plan ? thawTonight(plan, day.date).map(thawLine) : [],
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
  const week = plan ? plan.days.map((d) => dayView(d, today, targets, profile, plan)) : [];
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
  return dayView(day, today, targetsOf(state.charter, region), state.charter?.profile ?? null, state.plan);
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
  return { text: t("meals.photoCredit", { site }), url };
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
  return item.freezeOnArrival
    ? t("meals.shoppingNoteFreeze", { keeps: keepsLabel(item.keeps) })
    : keepsLabel(item.keeps);
}

/** A run of meals by weekday and label, joined the way the language lists them. */
export function mealsList(refs: readonly { date: string; meal: MealKey }[]): string {
  return refs.map(boxName).join(t("meals.listJoin"));
}

/**
 * The one line drawn after the plan card's Apply (cards.ts MealsAppliedCardData,
 * by shape: screen does not import the cards): what was saved and what the
 * shopping list now holds. The model's note on the same row is never drawn.
 */
export function appliedLine(card: {
  adjustment: boolean;
  changed: readonly { date: string; meal: MealKey }[];
  toBuy: number;
  freeze: number;
}): string {
  const head = card.adjustment
    ? t("meals.applied.change", { meals: mealsList(card.changed), count: card.toBuy })
    : t("meals.applied.week", { count: card.toBuy });
  return card.freeze ? `${head} · ${t("meals.applied.freeze", { count: card.freeze })}` : head;
}

const PROFILE_FIELDS = [
  "weightKg",
  "heightCm",
  "bodyFatPct",
  "waistCm",
  "goal",
  "trainingDays",
  "trainTime",
  "work",
  "effort",
  "people",
  "dislikes",
  "shops",
  "kitchen",
  "notes",
] as const;

/** The profile fields a change named, as the reader calls them. Unknown names are dropped. */
export function profileFieldsLine(fields: readonly string[]): string {
  return fields
    .filter((f): f is (typeof PROFILE_FIELDS)[number] => (PROFILE_FIELDS as readonly string[]).includes(f))
    .map((f) => t(`meals.field.${f}`))
    .join(t("meals.listJoin"));
}
