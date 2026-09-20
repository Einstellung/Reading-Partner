// The dinner line's data (docs/73): one week of dinners, the shopping list the
// program derives from it, and the sentences the reader says when a night went
// differently.
//
// It is a research room in the sense docs/63 means, with the reader themselves
// as its field of view, but it mints no Lab: a lab with no claimed sources is
// offered every unclaimed source by labsForSource, and this room collects
// nothing. It keeps its own file instead. None of the bureau's vocabulary
// (room, lab, bureau) is ever shown to the reader.

// What a night is. All four are equal — delivery is a plan, not a failure to
// plan (docs/north-star/diet.md).
export type DinnerMode = "cook" | "reheat" | "out" | "delivery";

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
  // Free text ("2 handfuls", "400g"), never a number the program does maths on:
  // a quantity is the model's, and nothing here adds two of them up.
  qty: string;
  category: IngredientCategory;
  keeps: KeepsClass;
}

// One dish, split the way it is actually cooked: a base that keeps a day and a
// fresh part added at serving that does not (diet.md 做一次吃两顿). The
// ingredients cover every serving the dish is planned for, so a cook day paired
// with a reheat day buys the greens for both on the one shopping trip.
export interface Dish {
  // "dish-" + 8 lowercase hex.
  id: string;
  name: string;
  // One line the reader reads on the card and on the day.
  oneLine: string;
  // What is cooked ahead. Empty for a dish with nothing worth keeping.
  base: string;
  // What is added at serving. Empty when the dish is all base.
  fresh: string;
  keepsADay: boolean;
  // Hands-on minutes, the hard constraint being 15 (diet.md 省事的约束写死).
  handsOnMinutes: number;
  ingredients: Ingredient[];
}

export interface DayPlan {
  // Local "YYYY-MM-DD". Local because dinner is a local-evening ritual.
  date: string;
  mode: DinnerMode;
  // The dish, for a cook day. A reheat day names no dish of its own: it eats
  // the base made on `reheatOf`.
  dishId?: string;
  // The date whose base this reheats. Cleared when that day stops being a cook
  // day (applyDeviation), which is what makes the day need attention.
  reheatOf?: string;
  // What is added to the reheated base at serving, in one phrase.
  freshAdd?: string;
  // Where, for out and delivery, in the reader's own words ("the noodle place
  // downstairs"). No POI, no menu — that is not this slice (docs/73).
  place?: string;
}

export interface WeekPlan {
  // "week-" + startDate.
  id: string;
  // Local date of day one. days[i] is startDate + i.
  startDate: string;
  // Seven, in date order.
  days: DayPlan[];
  // Every dish the days name, carried with the plan so one read off disk is
  // the whole week.
  dishes: Dish[];
  createdAt: number;
  // Bumped by every applied adjustment and every deviation, so the UI can tell
  // a stale render from a current one without diffing the week.
  revision: number;
}

export interface ShoppingItem {
  name: string;
  // The merged quantity text of every dish that wants it.
  qty: string;
  category: IngredientCategory;
  keeps: KeepsClass;
  // Raw protein that keeps a day or two and is not needed for another two:
  // freeze it the moment it is home, thaw it the night it is cooked.
  freezeOnArrival: boolean;
  // Checked in the shop. A checked item is what is in the fridge — the list is
  // the inventory, so nothing else has to be kept.
  checked: boolean;
  // The earliest day a dish needs it, local date.
  neededBy: string;
}

// What the household is, learned in two or three questions on the first "Plan
// this week" and corrected by talking. Never a form (diet.md 不用配置).
export interface DinnerCharter {
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

// A night that went differently, said in one sentence. The plan is the record,
// so this is the only input a normal week takes (diet.md 计划就是记录).
export interface Deviation {
  date: string;
  // The reader's own sentence.
  said: string;
  // What the night actually was.
  became: DinnerMode;
  place?: string;
  // What the program did about it, one line, written by the program and not by
  // the model.
  changed: string;
  at: number;
}

export interface DinnerState {
  charter: DinnerCharter | null;
  // The week being eaten. One at a time: a finished week is replaced, not
  // archived, because nothing in this slice reads an old one.
  plan: WeekPlan | null;
  shopping: ShoppingItem[];
  deviations: Deviation[];
}

export const DINNER_VERSION = 1 as const;

export const EMPTY_DINNER: DinnerState = {
  charter: null,
  plan: null,
  shopping: [],
  deviations: [],
};
