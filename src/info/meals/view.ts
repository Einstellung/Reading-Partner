// What the meals screen reads off the state (docs/73): the words for a mode
// and a shelf-life class, which day a date is, what is left of the week, and
// the order the shopping list is drawn in.
//
// All of it here rather than in the .tsx, so the screen's decisions are tested
// without React (CLAUDE.md). Nothing here formats a nutrition number, because
// there is none anywhere in this line.

import { photoForDish, photoForIngredient, type PhotoCache } from "./dish-photos";
import { ingredientImageUrl } from "./images";
import {
  CATEGORY_ORDER,
  MEAL_KEYS,
  type DayPlan,
  type Dish,
  type Meal,
  type MealKey,
  type MealMode,
  type IngredientCategory,
  type KeepsClass,
  type ShoppingItem,
  type ShoppingState,
  type WeekPlan,
} from "./types";
import { currentList, isChecked } from "./shopping";
import { addDays, dishForDay, dishForMeal } from "./week";

/** The mode as a plain word. Seven modes, seven words, none of them apologetic. */
export function modeWord(mode: MealMode): string {
  switch (mode) {
    case "cook":
      return "Cook";
    case "reheat":
      return "Reheat";
    case "packed":
      return "Packed";
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

/** One meal of a day, with the dish it eats and the words for both. */
export interface MealView {
  key: MealKey;
  label: string;
  meal: Meal;
  dish: Dish | null;
  word: string;
}

export interface DayView {
  day: DayPlan;
  // The three, in the order they are eaten.
  meals: MealView[];
  // The dish the day leads with: the cooked meal latest in the day. Breakfast
  // is a pattern rather than what the day is about, so it only supplies the
  // picture on a day that cooks nothing else.
  dish: Dish | null;
  word: string;
  weekday: string;
}

/**
 * What a meal is called on a row: the dish where there is one, and otherwise
 * the place the reader named. Empty for a mode that names neither, which draws
 * as an empty cell rather than as the word "Skip" twice over.
 */
export function mealName(view: MealView): string {
  return view.dish?.name ?? view.meal.place ?? "";
}

/** The three meals of a day, in order. */
export function mealViews(plan: WeekPlan, day: DayPlan): MealView[] {
  return MEAL_KEYS.map((key) => ({
    key,
    label: mealLabel(key),
    meal: day[key],
    dish: dishForMeal(plan, day[key]),
    word: modeWord(day[key].mode),
  }));
}

function dayView(plan: WeekPlan, day: DayPlan, today: string): DayView {
  return {
    day,
    meals: mealViews(plan, day),
    dish: dishForDay(plan, day),
    word: dayWord(day.date, today),
    weekday: weekdayName(day.date),
  };
}

/** One day of the week by its date, or null when the plan does not cover it. */
export function dayViewOn(
  plan: WeekPlan | null,
  date: string,
  today: string,
): DayView | null {
  const day = plan?.days.find((d) => d.date === date);
  return plan && day ? dayView(plan, day, today) : null;
}

/**
 * The days still ahead, today first. A day already eaten leaves the screen: the
 * plan is the record, and there is nothing left to decide about it.
 */
export function upcomingDays(plan: WeekPlan | null, today: string): DayView[] {
  if (!plan) return [];
  return plan.days.filter((d) => d.date >= today).map((d) => dayView(plan, d, today));
}

/** The two days the screen gives its top half to, in order. */
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
 * A picture on the screen, and the page it was found on for the proxy to send
 * as Referer — an arbitrary CDN may be behind a hotlink check
 * (docs/pitfall/30). Null where there is nothing to send.
 */
export interface Picture {
  url: string;
  pageUrl: string | null;
}

/**
 * The picture a night shows: what the search found for the dish, or the one
 * written onto the dish when the week was applied.
 *
 * The cache first, because it is the newer of the two: a run that landed after
 * the week was written is a photograph the plan on disk knows nothing about.
 */
export function dishPicture(dish: Dish | null | undefined, photos: PhotoCache | undefined): Picture | null {
  const photo = photoForDish(dish, photos);
  if (photo) return { url: photo.url, pageUrl: photo.pageUrl || null };
  return dish?.image ? { url: dish.image, pageUrl: null } : null;
}

/**
 * The picture a shopping line shows: TheMealDB's cut-out where there is one,
 * and what the search found otherwise.
 *
 * The bank first on purpose — a white-background cut-out of a bok choy
 * identifies the vegetable in the shop better than a photograph of a dish with
 * some in it (docs/73 图片).
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

/**
 * The credit the photograph on screen owes: the site it was found on, and the
 * page it sits on. The line reads "Photo: example.com" and opens that page.
 *
 * Null for a dish drawn from its ingredients, whose credit is the screen's
 * standing TheMealDB line instead.
 */
export function dishPhotoCredit(
  dish: Dish | null | undefined,
  photos: PhotoCache | undefined,
): DishPhotoCredit | null {
  const photo = photoForDish(dish, photos);
  if (!photo) return null;
  const site = photo.site.trim();
  const url = photo.pageUrl.trim();
  if (!site || !url) return null;
  return { text: `Photo: ${site}`, url };
}

// How many cut-outs a strip has room for, and which aisles are worth showing.
//
// A vegetable or a cut of meat is a picture of what is being cooked; a jar of
// paste or a box of stock is a picture of a label, and a shelf of packshots
// says nothing about the dish. So the pantry lines go last rather than out —
// a dish that is all pantry still gets a strip.
const THUMBNAIL_LIMIT = 4;
const PICTURES_THE_DISH: readonly IngredientCategory[] = ["produce", "protein"];

/**
 * Up to four ingredient photographs standing in for a dish that has no picture
 * of its own. Ingredients no source has a photograph of are skipped rather than
 * drawn as a gap, and the strip that draws these caps and de-duplicates them
 * again (images.ts) — what is returned here is the order, not the row.
 *
 * Resolved by the English name, never the reader's — images.ts is one table in
 * one language.
 */
export function dishThumbnails(
  dish: Dish | null,
  resolve: (name: string) => string | null = ingredientImageUrl,
): string[] {
  if (!dish) return [];
  const front: string[] = [];
  const back: string[] = [];
  const seen = new Set<string>();
  for (const ing of dish.ingredients) {
    const url = resolve(ing.en);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    (PICTURES_THE_DISH.includes(ing.category) ? front : back).push(url);
  }
  return [...front, ...back].slice(0, THUMBNAIL_LIMIT);
}

/** How many lines are still to be bought. The only count the list shows. */
export function leftToBuy(shopping: ShoppingState): number {
  return currentList(shopping).filter((i) => !isChecked(shopping, i)).length;
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
export function shoppingGroups(shopping: ShoppingState): ShoppingGroup[] {
  const list = currentList(shopping);
  const groups: ShoppingGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const mine = list.filter((i) => i.category === category);
    if (!mine.length) continue;
    groups.push({
      category,
      label: categoryLabel(category),
      items: [
        ...mine.filter((i) => !isChecked(shopping, i)),
        ...mine.filter((i) => isChecked(shopping, i)),
      ],
    });
  }
  return groups;
}
