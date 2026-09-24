// The food table's types and lookups. The rows are in food-table.ts.
//
// The model picks foods from this table by id; the program computes every
// gram, kcal and protein figure from the numbers here. A food the table does
// not have cannot be planned.

import { FOOD_TABLE } from "./food-table";

export type FoodRole = "protein" | "staple" | "veg" | "fruit" | "fat" | "sauce" | "dairy";

/** What dislikes and the weekly checks are evaluated against. */
export type FoodTag =
  | "seafood"
  | "fish"
  | "beef"
  | "pork"
  | "poultry"
  | "egg"
  | "soy"
  | "dairy"
  | "nuts"
  | "gluten"
  | "spicy";

export const FOOD_TAGS: readonly FoodTag[] = [
  "seafood",
  "fish",
  "beef",
  "pork",
  "poultry",
  "egg",
  "soy",
  "dairy",
  "nuts",
  "gluten",
  "spicy",
];

// The same values as IngredientCategory and KeepsClass in ../types.ts, spelled
// out here so this directory imports nothing from its parent (the parent
// imports it). A test holds the two lists together.
export type FoodCategory = "produce" | "protein" | "grains" | "dairy" | "pantry" | "frozen" | "other";
export type FoodKeeps = "d1-2" | "d3-5" | "w1" | "w2plus" | "pantry";

export type FoodSource =
  | { kind: "tw"; code: string; name: string }
  | { kind: "usda"; fdcId: number; dataset: "SR Legacy" | "Foundation"; name: string }
  | { kind: "label"; note: string };

export interface Food {
  /** Stable snake_case English id; what the model writes. */
  id: string;
  zh: string;
  /** Other names people use, simplified Chinese. */
  aliases: string[];
  /** English common name resolved by images.ts for the photo; empty for none. */
  en: string;
  roles: FoodRole[];
  category: FoodCategory;
  keeps: FoodKeeps;
  /** Per 100 g edible portion. */
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Sensible grams for one person's meal. */
  minG: number;
  maxG: number;
  /** Where an oil, nut or spread starts before the solver moves it. */
  defaultG?: number;
  /** Counted in whole units when solved (an egg is 50 g). */
  unit?: { grams: number; label: string };
  tags: FoodTag[];
  source: FoodSource;
}

export const TAIWAN_FDA_CREDIT =
  "衛生福利部食品藥物管理署，食品營養成分資料集（2026-08-27 版），依政府資料開放授權條款－第1版使用";
export const TAIWAN_FDA_LICENSE_NAME = "政府資料開放授權條款－第1版";
export const TAIWAN_FDA_LICENSE_URL = "https://data.gov.tw/license";
export const TAIWAN_FDA_DATASET_URL = "https://data.gov.tw/dataset/8543";
export const TAIWAN_FDA_VERSION = "2026-08-27";
export const USDA_FDC_CREDIT =
  "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (SR Legacy 2018-04, Foundation Foods 2026-04-30). Public domain (CC0 1.0).";
export const USDA_FDC_URL = "https://fdc.nal.usda.gov/";

export const FOODS: readonly Food[] = FOOD_TABLE;

const BY_ID: ReadonlyMap<string, Food> = new Map(FOODS.map((f) => [f.id, f]));

const norm = (s: string) => s.trim().replace(/\s+/g, "").replace(/\(/g, "（").replace(/\)/g, "）").toLowerCase();
const stripNote = (s: string) => s.replace(/（[^）]*）$/, "");

// Name → food, in precedence order: the Chinese name, an alias, the Chinese
// name without its trailing （…） note. The first row to claim a key keeps it.
const BY_NAME: ReadonlyMap<string, Food> = (() => {
  const m = new Map<string, Food>();
  const claim = (key: string, f: Food) => {
    const k = norm(key);
    if (k && !m.has(k)) m.set(k, f);
  };
  for (const f of FOODS) claim(f.zh, f);
  for (const f of FOODS) for (const a of f.aliases) claim(a, f);
  for (const f of FOODS) claim(stripNote(f.zh), f);
  return m;
})();

export function foodById(id: string): Food | undefined {
  return BY_ID.get(id);
}

/** A food by id, Chinese name or alias. */
export function findFood(nameOrId: string): Food | undefined {
  return BY_ID.get(nameOrId.trim()) ?? BY_NAME.get(norm(nameOrId));
}

/** Counts toward a meal's vegetable-and-fruit grams. */
export function isProduce(food: Food): boolean {
  return food.roles.includes("veg") || food.roles.includes("fruit");
}

/** False when a dislike names one of the food's tags, its id, its name or an alias. */
export function foodAllowed(food: Food, dislikes: readonly string[]): boolean {
  for (const d of dislikes) {
    const k = d.trim();
    if (!k) continue;
    if ((food.tags as string[]).includes(k)) return false;
    if (k === food.id || norm(k) === norm(food.zh) || food.aliases.some((a) => norm(a) === norm(k))) return false;
  }
  return true;
}

/** One line naming where a row's numbers come from, for the Method screen. */
export function sourceLabel(food: Food): string {
  const s = food.source;
  if (s.kind === "tw") return `Taiwan FDA ${s.code} ${s.name}`;
  if (s.kind === "usda") return `USDA FDC ${s.fdcId} (${s.dataset}) ${s.name}`;
  return `Typical label: ${s.note}`;
}
