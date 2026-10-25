// Method categories and the storage the program derives from them (docs/671
// 一锅). There is no deep frying. Only hands-off methods whose hands-on time
// does not grow with the amount and whose food reheats well can be batched;
// everything else is made at the meal. Storage is never stored on a dish: it
// is read off the method and the foods each time.

import { foodById } from "../nutrition/foods";
import type { Dish } from "./types";

export type MethodId =
  | "stew"
  | "braise"
  | "pressure_cook"
  | "slow_cook"
  | "roast"
  | "bake"
  | "steam"
  | "simmer"
  | "grain"
  | "pan_fry"
  | "stir_fry"
  | "cold_dress"
  | "pickle"
  | "marinate"
  | "greens"
  | "salad"
  | "microwave"
  | "toast"
  | "assemble";

export interface Storage {
  /** Days in the fridge after the cooking day; the cooking day itself is always fine. */
  fridgeDays: number;
  /** Weeks in the freezer, or 0 when the method does not freeze. */
  freezeWeeks: number;
}

export interface Method {
  id: MethodId;
  zh: string;
  /** Null: made at the meal only, never batched. */
  storage: Storage | null;
}

const COOKED: Storage = { fridgeDays: 2, freezeWeeks: 3 };
const GRAIN: Storage = { fridgeDays: 1, freezeWeeks: 3 };

export const METHODS: readonly Method[] = [
  { id: "stew", zh: "炖煮", storage: COOKED },
  { id: "braise", zh: "卤", storage: COOKED },
  { id: "pressure_cook", zh: "压力锅", storage: COOKED },
  { id: "slow_cook", zh: "慢炖", storage: COOKED },
  { id: "roast", zh: "烤盘、烤箱烤", storage: COOKED },
  { id: "bake", zh: "焗烤", storage: COOKED },
  { id: "steam", zh: "蒸", storage: COOKED },
  { id: "simmer", zh: "煮（汤、白煮肉、手撕肉、煮蛋）", storage: COOKED },
  { id: "grain", zh: "煮米饭和谷物", storage: GRAIN },
  { id: "pan_fry", zh: "煎（含鱼、牛排）", storage: null },
  { id: "stir_fry", zh: "少油炒", storage: null },
  { id: "cold_dress", zh: "凉拌", storage: null },
  { id: "pickle", zh: "醋渍", storage: null },
  { id: "marinate", zh: "腌泡", storage: null },
  { id: "greens", zh: "绿叶菜", storage: null },
  { id: "salad", zh: "沙拉", storage: null },
  { id: "microwave", zh: "微波加热", storage: null },
  { id: "toast", zh: "烤面包", storage: null },
  { id: "assemble", zh: "组装，不开火", storage: null },
];

/** What a breakfast may be made with (docs/671 早餐): assembly, boiled eggs, the microwave, reheating by steam, toast. */
export const BREAKFAST_METHODS: readonly MethodId[] = ["assemble", "simmer", "microwave", "steam", "toast"];

const BY_ID: ReadonlyMap<string, Method> = new Map(METHODS.map((m) => [m.id, m]));

export function methodById(id: string): Method | undefined {
  return BY_ID.get(id);
}

/** True for the hands-off methods a pot can be cooked with. */
export function canBatch(id: string): boolean {
  return methodById(id)?.storage != null;
}

export interface DishStorage {
  fridgeDays: number;
  freezable: boolean;
  freezeWeeks: number;
}

/**
 * How long a cooked pot keeps, or null when the dish cannot be batched (its
 * method is made-at-the-meal, or unknown). A pot with any not-freezable food
 * in it does not freeze.
 */
export function dishStorage(dish: Pick<Dish, "method" | "ingredients">): DishStorage | null {
  const s = methodById(dish.method)?.storage;
  if (!s) return null;
  const blocked = dish.ingredients.some((i) => foodById(i.food)?.noFreeze);
  const freezable = s.freezeWeeks > 0 && !blocked;
  return { fridgeDays: s.fridgeDays, freezable, freezeWeeks: freezable ? s.freezeWeeks : 0 };
}
