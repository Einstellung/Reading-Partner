// A dish in the library (docs/671 菜库, 数据模型). The model writes the
// ingredients and attributes; every number about it is computed from the
// ingredients and the food table (serving.ts, check.ts), never taken from the
// model.

import type { MethodId } from "./methods";

export type DishRole = "main" | "breakfast" | "staple";
export const DISH_ROLES: readonly DishRole[] = ["main", "breakfast", "staple"];

/** Batch dishes are cooked once and eaten over 1 to 3 meals; fresh ones are made at the meal. */
export type DishPrep = "batch" | "fresh";

/** What one ingredient line is in the dish: 蛋白、蔬菜、主食、油、调味. */
export type IngredientRole = "protein" | "veg" | "staple" | "oil" | "seasoning";
export const INGREDIENT_ROLES: readonly IngredientRole[] = ["protein", "veg", "staple", "oil", "seasoning"];

export type Cuisine =
  | "chinese"
  | "japanese"
  | "korean"
  | "southeast_asian"
  | "indian"
  | "american"
  | "mexican"
  | "mediterranean"
  | "other";
export const CUISINES: readonly Cuisine[] = [
  "chinese",
  "japanese",
  "korean",
  "southeast_asian",
  "indian",
  "american",
  "mexican",
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
  | "kettle";
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
];

export interface DishIngredient {
  /** Food table id. */
  food: string;
  /** Grams in the template; scaled to the reference serving by serving.ts. */
  grams: number;
  role: IngredientRole;
}

export interface Dish {
  id: string;
  name: string;
  nameEn: string;
  role: DishRole;
  cuisine: Cuisine;
  method: MethodId;
  equipment: Equipment[];
  /** Hands-on minutes for one pot (batch) or one meal (fresh). */
  activeMin: number;
  /** Minutes from start to eating, waiting included. */
  totalMin: number;
  prep: DishPrep;
  /** Staples it goes with: food ids with the staple role, or staple dish ids. */
  staples: string[];
  ingredients: DishIngredient[];
  origin: "seed" | "user";
  /** ISO timestamp. */
  createdAt: string;
}
