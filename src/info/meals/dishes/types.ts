// A dish in the library (docs/671 菜库, 数据模型). The model writes the
// ingredients and attributes; every number about it is computed from the
// ingredients and the food table (serving.ts, check.ts), never taken from the
// model.

import type { MethodId } from "./methods";

/**
 * 主菜 (lunch and dinner), 早餐 (an assembly template, never cooked ahead),
 * 主食 (a staple that is cooked, often a pot of grains) and 配菜 (a vegetable
 * dish: a roast tray, steamed greens).
 */
export type DishRole = "main" | "breakfast" | "staple" | "side";
export const DISH_ROLES: readonly DishRole[] = ["main", "breakfast", "staple", "side"];

/** Batch dishes are cooked once and eaten over 1 to 3 meals; fresh ones are made at the meal. */
export type DishPrep = "batch" | "fresh";

/**
 * What one ingredient line is in the dish: 蛋白、蔬菜、主食、油、调味、水果、
 * 点缀. A topping is a small amount of cheese, yogurt, nuts, seeds or herbs:
 * it has no gram minimum, its fat counts as added fat and its protein counts.
 */
export type IngredientRole = "protein" | "veg" | "staple" | "oil" | "seasoning" | "fruit" | "topping";
export const INGREDIENT_ROLES: readonly IngredientRole[] = [
  "protein",
  "veg",
  "staple",
  "oil",
  "seasoning",
  "fruit",
  "topping",
];

/** The line roles a way's add-ons may have: fresh things put on the plate at the meal. */
export const ADD_ON_ROLES: readonly IngredientRole[] = ["veg", "fruit", "topping"];

export type Cuisine =
  | "chinese"
  | "japanese"
  | "southeast_asian"
  | "american"
  | "mexican"
  | "italian"
  | "mediterranean"
  | "other";
export const CUISINES: readonly Cuisine[] = [
  "chinese",
  "japanese",
  "southeast_asian",
  "american",
  "mexican",
  "italian",
  "mediterranean",
  "other",
];

export type Equipment =
  | "stove"
  | "oven"
  | "air_fryer"
  | "rice_cooker"
  | "pressure_cooker"
  | "slow_cooker"
  | "steamer"
  | "microwave"
  | "kettle"
  | "toaster";
export const EQUIPMENT: readonly Equipment[] = [
  "stove",
  "oven",
  "air_fryer",
  "rice_cooker",
  "pressure_cooker",
  "slow_cooker",
  "steamer",
  "microwave",
  "kettle",
  "toaster",
];

/**
 * The kitchen every seed dish fits (docs/671 目标用户): a frying pan and a pot
 * (the pot with a rack is the steamer) on the stove, an electric pressure
 * cooker, a rice cooker, a microwave and a kettle. A soy milk maker is in it
 * too but no dish needs it. Oven, slow cooker, air fryer and toaster are
 * left out; a dish that needs one is only picked when the user says in
 * conversation that they have it.
 */
export const DEFAULT_KITCHEN: readonly Equipment[] = ["stove", "steamer", "pressure_cooker", "rice_cooker", "microwave", "kettle"];

export interface DishIngredient {
  /** Food table id. */
  food: string;
  /** Grams in the template; scaled to the reference serving by serving.ts. */
  grams: number;
  role: IngredientRole;
  /**
   * The cut is ground fresh at the counter or at home, for meatballs, kofta
   * or a loaf, and cooked the same day. Nutrition is the whole cut's. Only a
   * protein line of a whole meat or poultry cut can be ground; pre-packaged
   * mince is never allowed (check.ts, minced_meat).
   */
  ground?: boolean;
}

/**
 * One way to eat a batch main (吃法), so the same pot tastes different over
 * its meals: chili over rice, in a tortilla, on a baked potato.
 */
export interface DishWay {
  name: string;
  nameEn: string;
  /** The staple it goes with: a staple food id or a staple dish id; null when the pot is eaten as it is. */
  staple: string | null;
  /**
   * Fresh lines put together at the meal (veg, fruit, topping), in grams for
   * one reference serving of the pot; they are not scaled with the template.
   */
  addOns: DishIngredient[];
  /** Hands-on minutes to put the meal together, reheating aside. */
  activeMin: number;
}

export interface Dish {
  id: string;
  name: string;
  nameEn: string;
  /** One Chinese sentence (at most 40 characters) on how it is cooked, written for the dish, never copied from a recipe. */
  summary: string;
  summaryEn: string;
  role: DishRole;
  cuisine: Cuisine;
  method: MethodId;
  equipment: Equipment[];
  /** Hands-on minutes for one pot (batch) or one meal (fresh). */
  activeMin: number;
  /** Minutes from start to eating, waiting included. */
  totalMin: number;
  prep: DishPrep;
  /**
   * Staples a fresh main goes with: food ids with the staple role, or staple
   * dish ids. Empty on every other dish: a batch main names its staple on each
   * way, a breakfast carries its staple as a line.
   */
  staples: string[];
  ingredients: DishIngredient[];
  /** A batch main's 2 to 3 ways to eat it; no other dish has any. */
  ways?: DishWay[];
  origin: "seed" | "user";
  /** ISO timestamp. */
  createdAt: string;
}
