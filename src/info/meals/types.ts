// The meals line's data (docs/73): one week of four meals a day — breakfast,
// lunch, dinner and a snack — each about ten minutes of assembling ready foods,
// with grams the program solves against the reader's body goal; the one
// shopping trip derived from it; and the sentences the reader says when a meal
// went differently.
//
// It is a research room in the sense docs/63 means, with the reader themselves
// as its field of view, but it mints no Lab: a lab with no claimed sources is
// offered every unclaimed source by labsForSource, and this room collects
// nothing. It keeps its own file instead. None of the bureau's vocabulary
// (room, lab, bureau) is ever shown to the reader.

import type { Profile } from "./nutrition/targets";
import type { TemplateItem, TemplateRole } from "./nutrition/solve";

// What one meal is. All five are equal — delivery is a plan, not a failure to
// plan, and a skipped meal is a meal (docs/north-star/diet.md).
//
// make      assembled at home from foods in the food table; the only mode with
//           grams
// out       eaten somewhere, at a place the reader names
// delivery  ordered in, from a place the reader names
// bought    picked up on the way, not from a place worth planning
// skip      not eaten, on purpose
export type MealMode = "make" | "out" | "delivery" | "bought" | "skip";

export const MEAL_MODES: readonly MealMode[] = ["make", "out", "delivery", "bought", "skip"];

// The four meals a day. A day is an object with named fields rather than a
// list, because every caller wants one of them by name. This order is the
// canonical one; the order they are eaten in depends on training (dayPlan in
// nutrition/targets.ts).
export type MealKey = "breakfast" | "lunch" | "dinner" | "snack";

export const MEAL_KEYS: readonly MealKey[] = ["breakfast", "lunch", "dinner", "snack"];

export type MainMealKey = Exclude<MealKey, "snack">;

export const MAIN_MEAL_KEYS: readonly MainMealKey[] = ["breakfast", "lunch", "dinner"];

/** Which meal of which day. The unit a deviation points at. */
export interface MealRef {
  date: string;
  meal: MealKey;
}

// A meal's taste, from a fixed list so the program can check that two meals in
// a row do not taste the same (docs/73 每顿怎么搭).
export type Flavour =
  | "soy-ginger"
  | "garlic"
  | "scallion-oil"
  | "tomato"
  | "curry"
  | "sesame"
  | "teriyaki"
  | "sweet-sour"
  | "spicy-sichuan"
  | "hot-sour"
  | "black-pepper"
  | "lemon-pepper"
  | "vinaigrette"
  | "miso"
  | "pesto"
  | "sweet"
  | "plain";

export const FLAVOURS: readonly { id: Flavour; zh: string; en: string }[] = [
  { id: "soy-ginger", zh: "姜葱酱油", en: "Soy & ginger" },
  { id: "garlic", zh: "蒜香", en: "Garlic" },
  { id: "scallion-oil", zh: "葱油", en: "Scallion oil" },
  { id: "tomato", zh: "番茄", en: "Tomato" },
  { id: "curry", zh: "咖喱", en: "Curry" },
  { id: "sesame", zh: "麻酱", en: "Sesame" },
  { id: "teriyaki", zh: "照烧", en: "Teriyaki" },
  { id: "sweet-sour", zh: "糖醋", en: "Sweet & sour" },
  { id: "spicy-sichuan", zh: "麻辣", en: "Sichuan spicy" },
  { id: "hot-sour", zh: "酸辣", en: "Hot & sour" },
  { id: "black-pepper", zh: "黑椒", en: "Black pepper" },
  { id: "lemon-pepper", zh: "柠檬胡椒", en: "Lemon pepper" },
  { id: "vinaigrette", zh: "油醋", en: "Vinaigrette" },
  { id: "miso", zh: "味噌", en: "Miso" },
  { id: "pesto", zh: "青酱", en: "Pesto" },
  { id: "sweet", zh: "甜口", en: "Sweet" },
  { id: "plain", zh: "原味", en: "Plain" },
];

/** The flavour an id names, or null for anything off the list. */
export function flavourOf(raw: unknown): Flavour | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return FLAVOURS.some((f) => f.id === v) ? (v as Flavour) : null;
}

/** One food of a made meal at its solved weight, as stored. */
export interface SolvedItem {
  foodId: string;
  role: TemplateRole;
  grams: number;
}

/**
 * One of the four meals of one day.
 *
 * A made meal carries what the model chose — the template (`items`), a
 * flavour, a one-line method, hands-on minutes — and the grams the program
 * solved for it (`solved`). The grams depend on that day's meal target, so
 * they are re-solved whenever the profile changes (solve-week.ts). Every other
 * mode carries only the place and the reader's note.
 */
export interface Meal {
  mode: MealMode;
  // What the meal is called on screen, in the reader's language
  // ("虾仁西兰花杂粮饭"). Made meals only.
  name?: string;
  // The dish's common English name, what its photograph is searched by
  // (photo-search.ts) and the photo cache's key.
  searchName?: string;
  flavour?: Flavour;
  // One line on how it is put together, in the reader's language.
  method?: string;
  // Hands-on minutes.
  minutes?: number;
  // The model's template: food ids from the food table and their roles, with
  // grams for the fixed items.
  items?: TemplateItem[];
  // Every row at its solved weight, written by the program. Absent until the
  // meal has been solved.
  solved?: SolvedItem[];
  // Where, for out, delivery and bought, in the reader's own words.
  place?: string;
  // One line of the reader's own about this meal.
  note?: string;
}

export interface DayPlan {
  // Local "YYYY-MM-DD".
  date: string;
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
  snack: Meal;
}

export interface WeekPlan {
  // "week-" + startDate.
  id: string;
  // Local date of day one. days[i] is startDate + i.
  startDate: string;
  // Seven, in date order.
  days: DayPlan[];
  createdAt: number;
  // Bumped by every applied adjustment, deviation and re-solve.
  revision: number;
}

// The aisle a food is bought in. A shopping list is walked through a store, so
// the grouping is the store's, not the nutritionist's.
export type IngredientCategory =
  | "produce"
  | "protein"
  | "grains"
  | "dairy"
  | "pantry"
  | "frozen"
  | "other";

// How long the thing keeps refrigerated, in the FoodKeeper classes. The list
// is ordered by this, shortest first.
export type KeepsClass = "d1-2" | "d3-5" | "w1" | "w2plus" | "pantry";

// The order a list walks a store in. Exported because the UI groups by it too.
export const CATEGORY_ORDER: readonly IngredientCategory[] = [
  "produce",
  "protein",
  "dairy",
  "frozen",
  "grains",
  "pantry",
  "other",
];

// Shortest first. The index into this is the sort key inside a category.
export const KEEPS_ORDER: readonly KeepsClass[] = ["d1-2", "d3-5", "w1", "w2plus", "pantry"];

// One photograph the image search found, for a dish or for an ingredient.
export interface DishPhoto {
  // The full-size image, what the card loads.
  url: string;
  // The search's own thumbnail, which is what a 40px square wants.
  thumb: string;
  // The page the picture sits on: what the caption opens, and what the `img:`
  // proxy sends as Referer (docs/pitfall/30).
  pageUrl: string;
  // That page's host without `www.`. The caption reads "Photo: <site>".
  site: string;
  foundAt: number;
}

// A search that found nothing usable. Kept, rather than left absent, so a name
// the search has nothing for is not asked again every time a week is planned.
export interface DishPhotoMiss {
  none: true;
  checkedAt: number;
}

export type DishPhotoEntry = DishPhoto | DishPhotoMiss;

/** Whether a cache entry is a search that came back empty. */
export function isDishPhotoMiss(entry: DishPhotoEntry): entry is DishPhotoMiss {
  return (entry as DishPhotoMiss).none === true;
}

export interface ShoppingItem {
  name: string;
  // The English common name this line resolves its photograph by.
  en: string;
  // "600 g", or "12 个" for a food counted in units. Free text on a line the
  // reader added.
  qty: string;
  category: IngredientCategory;
  keeps: KeepsClass;
  // The food-table row a derived line totals. Absent on a line the reader
  // added.
  foodId?: string;
  // The weight a derived line stands for: every meal that uses the food, times
  // the people eating.
  grams?: number;
  // Raw protein that keeps a day or two and is not needed for another two:
  // freeze it the moment it is home.
  freezeOnArrival: boolean;
  // The earliest day a meal needs it, local date. Empty on a line the reader
  // asked for, which no meal is waiting on.
  neededBy: string;
  // Set on the lines the reader added by saying so, which is what keeps them
  // through a re-derive (shopping.ts).
  source?: "reader";
  // Added after the trip was called done: it belongs to "still to get" rather
  // than to the aisles that were already walked.
  afterDone?: boolean;
}

/**
 * The one shopping trip a week (docs/73 采购单).
 *
 * The derived half and the reader's half are kept apart: a re-solve re-derives
 * `items` from the week, and a washing-up liquid nobody planned must not vanish
 * with it. The reader's removals and swaps are overrides keyed by the derived
 * line for the same reason. `currentList` is the only thing that puts the four
 * together, and it is pure.
 */
export interface ShoppingState {
  // Derived from the week's made meals. Rebuilt whole by deriveShoppingList.
  items: ShoppingItem[];
  // Lines the reader asked for, in the order they asked.
  reader: ShoppingItem[];
  // Derived lines the reader took off, by key.
  dropped: Record<string, true>;
  // Derived lines the reader swapped for something else, by key.
  replaced: Record<string, ShoppingReplacement>;
  // Ticked in the shop, by key, so a tick survives a re-derive.
  checked: Record<string, true>;
  // The local date the trip was called done, or null while it is still a list.
  doneOn: string | null;
}

/** What a derived line was swapped for. Everything the line draws itself with. */
export interface ShoppingReplacement {
  name: string;
  en: string;
  category: IngredientCategory;
  keeps: KeepsClass;
  qty: string;
}

export const EMPTY_SHOPPING: ShoppingState = {
  items: [],
  reader: [],
  dropped: {},
  replaced: {},
  checked: {},
  doneOn: null,
};

// What the reader told onboarding (docs/73 开场), and what they have said about
// their meals since. Targets are never stored: they are recomputed from the
// profile every time (nutrition/targets.ts).
export interface MealsCharter {
  profile: Profile;
  // What the reader has said about their meals in their own words ("lunch is
  // the canteen on weekdays"), kept for the model. Empty until they say
  // something the profile has no field for.
  text: string;
  updatedAt: number;
}

// A meal that went differently, said in one sentence. The plan is the record,
// so this is the only input a normal week takes (diet.md 计划就是记录).
export interface Deviation {
  date: string;
  meal: MealKey;
  // The reader's own sentence.
  said: string;
  // What the meal actually was.
  became: MealMode;
  place?: string;
  // What the program did about it, one line, written by the program.
  changed: string;
  at: number;
}

export interface MealsState {
  charter: MealsCharter | null;
  // The week being eaten. One at a time.
  plan: WeekPlan | null;
  shopping: ShoppingState;
  deviations: Deviation[];
  // When the reader last said the pictures are wrong (docs/73 图片). Absent
  // means never asked.
  photosAskedAt?: number;
}

// 2 is the quick-meals-with-a-body-goal schema (2026-09-24). A file of an
// earlier version is read as empty apart from the photo ask: its free-text
// dishes cannot be solved, so the reader goes through onboarding and plans
// afresh.
export const MEALS_VERSION = 2 as const;

export const EMPTY_MEALS: MealsState = {
  charter: null,
  plan: null,
  shopping: EMPTY_SHOPPING,
  deviations: [],
};
