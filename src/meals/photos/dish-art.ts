// The library's own dish pictures (docs/671 菜品图): one drawn ahead of time for
// every way of eating a batch main, every fresh main and every breakfast in the
// seed library. Not in the installer: they sit on a GitHub release, one WebP per
// id, fetched the first time a meal shows one and kept on disk under the tag
// (dish-art-store.ts). Pure; this file says which picture a meal shows and where
// it lives.
//
// A meal is matched by its searchName, which the planner writes as the way's or
// the dish's English name (planner/to-week.ts). A dish whose food was swapped
// for the reader carries a renamed name and matches nothing: its picture would
// show the food they cannot get.

import { SEED_DISHES } from "../dishes/seed";
import type { Dish } from "../dishes/types";
import { MEAL_KEYS, type DishPhotoEntry, type WeekPlan } from "../plan/types";
import { DISH_ART_IDS } from "./dish-art-ids";
import { dishDrawingKey, normalizeSearchName, type PhotoCache } from "./dish-photos";

/** The release the pictures are published under. Its files never change; new pictures get a new tag. */
export const DISH_ART_TAG = "dish-art-v1";

const RELEASE_BASE = "https://github.com/Einstellung/lumen-assets/releases/download";

/** Where one picture is downloaded from. */
export function dishArtUrl(id: string, tag = DISH_ART_TAG): string {
  return `${RELEASE_BASE}/${tag}/${id}.webp`;
}

/** The app-data directory a tag's pictures are kept in. */
export function dishArtDir(tag = DISH_ART_TAG): string {
  return `meals-art/${tag}`;
}

/** Where one picture is kept once downloaded. */
export function dishArtPath(id: string, tag = DISH_ART_TAG): string {
  return `${dishArtDir(tag)}/${id}.webp`;
}

/** The picture id each library meal would have, by its normalized English name. */
function libraryArtIds(dish: Dish): Array<[string, string]> {
  if (dish.role === "main" && dish.ways?.length) {
    return dish.ways.map((w, i) => [w.nameEn, `${dish.id}--w${i + 1}-${w.staple ?? "plain"}`]);
  }
  if (dish.role === "main" && dish.staples[0]) return [[dish.nameEn, `${dish.id}--${dish.staples[0]}`]];
  if (dish.role === "breakfast") return [[dish.nameEn, `${dish.id}--breakfast`]];
  return [];
}

/**
 * The published pictures by the name a meal carries. A library meal whose id
 * has no picture under the tag (a way added or restapled since) is left out
 * and shows what it showed before.
 */
export function dishArtByName(
  dishes: readonly Dish[] = SEED_DISHES,
  ids: readonly string[] = DISH_ART_IDS,
): ReadonlyMap<string, string> {
  const published = new Set(ids);
  const out = new Map<string, string>();
  for (const dish of dishes) {
    for (const [name, id] of libraryArtIds(dish)) {
      const key = normalizeSearchName(name);
      if (key && published.has(id)) out.set(key, id);
    }
  }
  return out;
}

let byName: ReadonlyMap<string, string> | null = null;

/** The picture a meal shows, by its searchName, or null. */
export function dishArtId(searchName: string | undefined): string | null {
  byName ??= dishArtByName();
  return byName.get(normalizeSearchName(searchName ?? "")) ?? null;
}

/** The pictures the plan's made meals show, each once. */
export function weekArtIds(plan: WeekPlan | null | undefined): string[] {
  const ids = new Set<string>();
  for (const day of plan?.days ?? []) {
    for (const k of MEAL_KEYS) {
      const meal = day[k];
      const id = meal.mode === "make" ? dishArtId(meal.searchName) : null;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * The screen's cache with each made meal's library picture in place of
 * whatever its drawing key held, for the meals whose picture has been read
 * (`sources`, by id, as data: URIs). In memory only: the cache file never sees
 * it. A meal whose picture is not here yet keeps its drawing or its strip.
 */
export function withDishArt(
  cache: PhotoCache,
  plan: WeekPlan | null | undefined,
  sources: Readonly<Record<string, string>>,
): PhotoCache {
  const next: Record<string, DishPhotoEntry> = { ...cache };
  for (const day of plan?.days ?? []) {
    for (const k of MEAL_KEYS) {
      const meal = day[k];
      if (meal.mode !== "make") continue;
      const id = dishArtId(meal.searchName);
      const src = id ? sources[id] : undefined;
      const key = dishDrawingKey(meal.searchName ?? "");
      if (id && src && key) next[key] = { drawing: dishArtPath(id), drawnAt: 0, src };
    }
  }
  return next;
}
