// The meals line's data (docs/73): one week of three meals a day, the one
// shopping trip derived from it, and the sentences the reader says when a meal
// went differently.
//
// It is a research room in the sense docs/63 means, with the reader themselves
// as its field of view, but it mints no Lab: a lab with no claimed sources is
// offered every unclaimed source by labsForSource, and this room collects
// nothing. It keeps its own file instead. None of the bureau's vocabulary
// (room, lab, bureau) is ever shown to the reader.

// What one meal is. All seven are equal — delivery is a plan, not a failure to
// plan, and a skipped meal is a meal (docs/north-star/diet.md).
//
// cook      made now, from the dish's ingredients
// reheat    eats a base cooked at an earlier meal, plus something fresh
// packed    carried from home, eating a base cooked at an earlier meal
// out       eaten somewhere, at a place the reader names
// delivery  ordered in, from a place the reader names
// bought    picked up on the way, not from a place worth planning
// skip      not eaten, on purpose
export type MealMode =
  | "cook"
  | "reheat"
  | "packed"
  | "out"
  | "delivery"
  | "bought"
  | "skip";

// The three meals a day, in the order they are eaten. One key, everywhere: a
// day is an object with three named fields rather than a list, because every
// caller wants one of them by name and none of them wants the fourth.
export type MealKey = "breakfast" | "lunch" | "dinner";

export const MEAL_KEYS: readonly MealKey[] = ["breakfast", "lunch", "dinner"];

/** Which meal of which day. The unit a deviation and a reheat both point at. */
export interface MealRef {
  date: string;
  meal: MealKey;
}

// The aisle an ingredient is bought in. A shopping list is walked through a
// store, so the grouping is the store's, not the nutritionist's.
export type IngredientCategory =
  | "produce"
  | "protein"
  | "grains"
  | "dairy"
  | "pantry"
  | "frozen"
  | "other";

// How long the thing keeps refrigerated, in the classes the FoodKeeper table is
// read into (diet.md 做一次吃两顿). The list is ordered by this, shortest first,
// because a week's worth of shopping only works if the week is eaten in
// shelf-life order.
export type KeepsClass = "d1-2" | "d3-5" | "w1" | "w2plus" | "pantry";

// The order a list walks a store in. Exported because the UI groups by it too,
// and two orders would put the list on screen in a different order than the one
// derived.
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

export interface Ingredient {
  name: string;
  // The English common name, singular and lower case ("bok choy", "eggplant").
  // It is what resolves the photograph (images.ts): `name` is in the reader's
  // language and a picture table cannot be written in every language, so the
  // model writes both and the program looks this one up. Empty when the model
  // left it out, and an empty one simply has no picture.
  en: string;
  // Free text ("2 handfuls", "400g"), never a number the program does maths on:
  // a quantity is the model's, and nothing here adds two of them up.
  qty: string;
  category: IngredientCategory;
  keeps: KeepsClass;
}

/**
 * How a dish is actually made, written once and kept (docs/73 做法).
 *
 * Asked of the model the first time the reader opens the day it is cooked on,
 * not when the week is planned: most dishes of a week are never opened, and a
 * week's worth of steps written up front is a week's worth of tokens spent on
 * nothing.
 */
export interface DishMethod {
  // One line each, in the order they are done. Between one and ten.
  steps: string[];
  // The one thing worth knowing that is not a step ("the fifteen minutes it
  // simmers are yours"). Absent when there is nothing.
  note?: string;
  writtenAt: number;
}

// One dish, split the way it is actually cooked: a base that keeps a day and a
// fresh part added at serving that does not (diet.md 做一次吃两顿). The
// ingredients cover every meal the dish is planned for, so a dinner cooked once
// and carried to work the next day buys for both on the one shopping trip.
export interface Dish {
  // "dish-" + 8 lowercase hex.
  id: string;
  name: string;
  // The English name someone would type into an image search ("mapo tofu",
  // "shakshuka", "sheet pan salmon"), singular and lower case. It is what the
  // photograph is searched by (photo-search.ts) and it is the cache's key, so
  // two weeks planning the same dish search once.
  searchName: string;
  // One line the reader reads on the card and on the day.
  oneLine: string;
  // What is cooked ahead. Empty for a dish with nothing worth keeping.
  base: string;
  // What is added at serving. Empty when the dish is all base.
  fresh: string;
  keepsADay: boolean;
  // Hands-on minutes, the hard constraint being HANDS_ON_LIMITS for the meal it
  // is cooked at (diet.md 省事的约束写死).
  handsOnMinutes: number;
  ingredients: Ingredient[];
  // A photograph of the dish: an app-relative path, or an https URL that the
  // screen loads through the image proxy (images.ts, docs/73 图片). Written by
  // the program from the photo cache when a plan is applied, never by the model
  // — a URL out of a model is a fact through a model. Absent when the search
  // found nothing, and a dish without one is drawn from its ingredients'
  // pictures instead: the reader cannot tell one vegetable from another, so a
  // meal never goes on screen with nothing to look at.
  image?: string;
  // The steps, once anyone has asked for them (method.ts). Absent until then.
  method?: DishMethod;
}

// One photograph the image search found, for a dish or for an ingredient.
export interface DishPhoto {
  // The full-size image, what the card loads.
  url: string;
  // The search's own thumbnail, which is what a 40px square wants.
  thumb: string;
  // The page the picture sits on: what the caption opens, and what the `img:`
  // proxy sends as Referer — an arbitrary CDN may refuse a request that arrives
  // without one (docs/pitfall/30).
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

/**
 * One of the three meals of one day.
 *
 * `dishId` is on every meal that has a dish to name, cooked or carried: a
 * packed lunch shows the dish it is a box of. `reheatOf` is the pointer to
 * where that base was cooked, and it is what goes stale when the meal it
 * points at stops cooking (applyDeviation).
 */
export interface Meal {
  mode: MealMode;
  // The dish, for cook; the dish whose base is eaten, for reheat and packed.
  dishId?: string;
  // Which meal cooked the base this one eats. Absent on a box carried over from
  // a week nobody planned here, which says where it came from in `note`.
  reheatOf?: MealRef;
  // What is added to the base at serving, in one phrase.
  freshAdd?: string;
  // Where, for out, delivery and bought, in the reader's own words ("the noodle
  // place downstairs"). No POI, no menu — that is not this slice (docs/73).
  place?: string;
  // One line of the reader's own about this meal ("last night's box"), for the
  // cases the modes do not carry. Never a second description of the dish.
  note?: string;
}

export interface DayPlan {
  // Local "YYYY-MM-DD". Local because a day of meals is a local-day ritual.
  date: string;
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
}

export interface WeekPlan {
  // "week-" + startDate.
  id: string;
  // Local date of day one. days[i] is startDate + i.
  startDate: string;
  // Seven, in date order.
  days: DayPlan[];
  // Every dish the meals name, carried with the plan so one read off disk is
  // the whole week.
  dishes: Dish[];
  // The week's breakfasts as a pattern, in the reader's own words ("oats and
  // egg on toast, Friday I buy something on the way"). Breakfast is habit, not
  // seven decisions, so the week says it once; the days still carry real
  // meals, so the oats are a dish and their oats are on the list.
  breakfastLine: string;
  createdAt: number;
  // Bumped by every applied adjustment and every deviation, so the UI can tell
  // a stale render from a current one without diffing the week.
  revision: number;
}

export interface ShoppingItem {
  name: string;
  // The English common name this line resolves its photograph by. Lines merge
  // by `name`, and the first English name seen for one wins: a second spelling
  // of the same thing would swap the picture halfway through deriving.
  en: string;
  // The merged quantity text of every dish that wants it.
  qty: string;
  category: IngredientCategory;
  keeps: KeepsClass;
  // Raw protein that keeps a day or two and is not needed for another two:
  // freeze it the moment it is home, thaw it the day it is cooked.
  freezeOnArrival: boolean;
  // The earliest day a dish needs it, local date. Empty on a line the reader
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
 * The derived half and the reader's half are kept apart on purpose: an
 * adjustment re-derives `items` from the week, and a washing-up liquid nobody
 * planned must not vanish with it. The reader's removals and swaps are held as
 * overrides keyed by the derived line for the same reason — applied to the
 * derived array they would be erased by the next derivation.
 *
 * `currentList` is the only thing that puts the four together, and it is pure.
 */
export interface ShoppingState {
  // Derived from the week's cooked meals. Rebuilt whole by deriveShoppingList.
  items: ShoppingItem[];
  // Lines the reader asked for, in the order they asked.
  reader: ShoppingItem[];
  // Derived lines the reader took off, by key.
  dropped: Record<string, true>;
  // Derived lines the reader swapped for something else, by key.
  replaced: Record<string, ShoppingReplacement>;
  // Ticked in the shop, by key. Outside the lines themselves so a tick survives
  // a re-derive without the derivation having to carry it.
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

// What the household is, learned in two or three questions on the first "Plan
// this week" and corrected by talking. Never a form (diet.md 不用配置).
export interface MealsCharter {
  people: number;
  // The shops they actually buy in, which is what decides the possible
  // ingredients.
  stores: string[];
  // One line about the kitchen: what there is to cook with and what there is
  // not.
  kitchen: string;
  dislikes: string[];
  // How a week splits, as the reader described it. Advisory to the model, not
  // enforced by the program.
  nightsCooking: number;
  nightsOut: number;
  nightsDelivery: number;
  // The charter in the reader's own words, one paragraph. The structured fields
  // above are what the program can sort by; this is what the model reads.
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
  // What the program did about it, one line, written by the program and not by
  // the model.
  changed: string;
  at: number;
}

export interface MealsState {
  charter: MealsCharter | null;
  // The week being eaten. One at a time: a finished week is replaced, not
  // archived, because nothing in this slice reads an old one.
  plan: WeekPlan | null;
  shopping: ShoppingState;
  deviations: Deviation[];
  // When the reader last said the pictures are wrong (docs/73 图片). The search
  // runs on the machine with a hidden webview, which is not the machine the
  // reader is usually holding, so the request travels as data rather than as a
  // run: a cache entry written before this is stale, and the next pass on the
  // searching machine looks the whole week up again. Absent means never asked.
  photosAskedAt?: number;
}

export const MEALS_VERSION = 1 as const;

export const EMPTY_MEALS: MealsState = {
  charter: null,
  plan: null,
  shopping: EMPTY_SHOPPING,
  deviations: [],
};
