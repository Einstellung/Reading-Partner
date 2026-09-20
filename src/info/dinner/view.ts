// What the dinner screen reads off the state (docs/73): the words for a mode
// and a shelf-life class, which day a date is, what is left of the week, and
// the order the shopping list is drawn in.
//
// All of it here rather than in the .tsx, so the screen's decisions are tested
// without React (CLAUDE.md). Nothing here formats a nutrition number, because
// there is none anywhere in this line.

import { photoForDish } from "./dish-photos";
import { ingredientImageUrl } from "./images";
import {
  CATEGORY_ORDER,
  type DayPlan,
  type Dish,
  type DishPhotoEntry,
  type DinnerMode,
  type IngredientCategory,
  type KeepsClass,
  type ShoppingItem,
  type WeekPlan,
} from "./types";
import { addDays, dishForDay } from "./week";

/** The mode as a plain word. Four nights, four words, none of them apologetic. */
export function modeWord(mode: DinnerMode): string {
  switch (mode) {
    case "cook":
      return "Cook";
    case "reheat":
      return "Reheat";
    case "out":
      return "Eat out";
    case "delivery":
      return "Delivery";
  }
}

/** How long a thing keeps, in words rather than in the class's own spelling. */
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
  switch (category) {
    case "produce":
      return "Produce";
    case "protein":
      return "Protein";
    case "dairy":
      return "Dairy";
    case "frozen":
      return "Frozen";
    case "grains":
      return "Grains";
    case "pantry":
      return "Pantry";
    case "other":
      return "Other";
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The weekday a local "YYYY-MM-DD" falls on. Read as UTC on purpose: the string
 * is already local, and letting the host's zone re-interpret it moves the day
 * either side of midnight.
 */
export function weekdayName(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return WEEKDAYS[d.getUTCDay()] ?? "";
}

/**
 * What to call a date on the screen: Today and Tomorrow by name, everything
 * else by its weekday. The weekday rides along either way, because "Today" on
 * its own does not say which night the card is about.
 */
export function dayWord(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return weekdayName(date);
}

export interface DayView {
  day: DayPlan;
  dish: Dish | null;
  word: string;
  weekday: string;
}

function dayView(plan: WeekPlan, day: DayPlan, today: string): DayView {
  return {
    day,
    dish: dishForDay(plan, day),
    word: dayWord(day.date, today),
    weekday: weekdayName(day.date),
  };
}

/**
 * The nights still ahead, today first. A night already eaten leaves the screen:
 * the plan is the record, and there is nothing left to decide about it.
 */
export function upcomingDays(plan: WeekPlan | null, today: string): DayView[] {
  if (!plan) return [];
  return plan.days.filter((d) => d.date >= today).map((d) => dayView(plan, d, today));
}

/** The two nights the screen gives its top half to, in order. */
export function headlineDays(plan: WeekPlan | null, today: string): DayView[] {
  return upcomingDays(plan, today).slice(0, 2);
}

/** Everything after those two, as the compact list. */
export function laterDays(plan: WeekPlan | null, today: string): DayView[] {
  return upcomingDays(plan, today).slice(2);
}

// The line under a dish photograph, and where it goes when it is tapped.
export interface DishPhotoCredit {
  text: string;
  url: string;
}

/**
 * The credit a dish photograph owes: its creator and its licence, and the page
 * it was found on.
 *
 * Only for the photograph actually on screen — the dish's `image` has to be the
 * one the cache holds, or a credit would name the wrong photographer. Null for
 * a dish drawn from its ingredients, whose credit is the screen's standing
 * TheMealDB line instead.
 */
export function dishPhotoCredit(
  dish: Dish | null | undefined,
  photos: Readonly<Record<string, DishPhotoEntry>> | undefined,
): DishPhotoCredit | null {
  if (!dish?.image) return null;
  const photo = photoForDish(dish, photos);
  if (!photo || photo.url !== dish.image) return null;
  const who = photo.creator.trim();
  const parts = ["Photo", who ? `: ${who}` : "", photo.license ? ` · ${photo.license}` : ""];
  const url = photo.foreignLandingUrl || photo.licenseUrl;
  if (!url) return null;
  return { text: parts.join(""), url };
}

/**
 * Up to three ingredient photographs standing in for a dish that has no picture
 * of its own. Three is what fits in a strip the width of one card; ingredients
 * no source has a photograph of are skipped rather than drawn as a gap.
 *
 * Resolved by the English name, never the reader's — images.ts is one table in
 * one language.
 */
export function dishThumbnails(
  dish: Dish | null,
  resolve: (name: string) => string | null = ingredientImageUrl,
): string[] {
  if (!dish) return [];
  const urls: string[] = [];
  for (const ing of dish.ingredients) {
    const url = resolve(ing.en);
    if (url) urls.push(url);
    if (urls.length === 3) break;
  }
  return urls;
}

/** How many lines are still to be bought. The only count the list shows. */
export function leftToBuy(items: readonly ShoppingItem[]): number {
  return items.filter((i) => !i.checked).length;
}

export interface ShoppingGroup {
  category: IngredientCategory;
  label: string;
  items: ShoppingItem[];
}

/**
 * The list as it is drawn: the aisles in the order the derivation already put
 * them in (CATEGORY_ORDER, so one order and not two), and inside each aisle the
 * ticked lines sunk to the bottom in the order they were already in.
 *
 * Sunk rather than hidden: a ticked line is what is in the fridge, and the list
 * is the inventory (docs/73).
 */
export function shoppingGroups(items: readonly ShoppingItem[]): ShoppingGroup[] {
  const groups: ShoppingGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const mine = items.filter((i) => i.category === category);
    if (!mine.length) continue;
    groups.push({
      category,
      label: categoryLabel(category),
      items: [...mine.filter((i) => !i.checked), ...mine.filter((i) => i.checked)],
    });
  }
  return groups;
}
