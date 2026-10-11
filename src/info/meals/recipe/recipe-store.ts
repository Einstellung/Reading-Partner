// The recipes on disk: info-meals-recipes.json (docs/73 做法页).
//
// Its own file rather than a field of info-meals.json, which is merged whole
// with the last writer winning: a recipe written on one device would undo a
// menu change made on the other, or the other way round. Here each recipe is a
// record under its key (recipeKey), merged per key (palace/kinds.ts), and a
// recipe never changes once written — a changed meal has another key.
//
// Bounded by the write itself: every save drops what is older than
// RECIPE_KEEP_DAYS and keeps no more than RECIPE_KEEP_COUNT, so the file holds
// a few weeks of meals and no more.

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../../platform/app/guarded-file";
import { isObject } from "../../../platform/std/json";
import { MEALS_VERSION } from "../plan/types";
import type { RecipeEntry } from "./recipe";

export const MEALS_RECIPES_FILE = "info-meals-recipes.json";

export const RECIPE_KEEP_DAYS = 60;
export const RECIPE_KEEP_COUNT = 150;

/** What the file holds: every recipe still kept, by key. */
export interface MealsRecipes {
  recipes: Record<string, RecipeEntry>;
}

export type RecipeIo = GuardedFileIo<MealsRecipes>;

export const recipeIo: RecipeIo = appGuardedFileIo();

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function isEntry(raw: unknown): raw is RecipeEntry {
  return isObject(raw) && typeof raw.at === "number" && isStrings(raw.steps) && raw.steps.length > 0;
}

/** The recipes out of a parsed file, or null when the bytes are not this shape. An entry that does not read is skipped. */
export function parseRecipeFile(raw: unknown): MealsRecipes | null {
  if (!isObject(raw)) return null;
  const recipes: Record<string, RecipeEntry> = {};
  if (isObject(raw.recipes)) {
    for (const [key, entry] of Object.entries(raw.recipes)) {
      if (!isEntry(entry)) continue;
      // Entries written before the pots carry a `batch` of the model's; it is
      // read past and gone on the next save.
      recipes[key] = { at: entry.at, name: typeof entry.name === "string" ? entry.name : "", steps: entry.steps };
    }
  }
  return { recipes };
}

/** The file body to write. */
export function recipeFileBody(state: MealsRecipes): string {
  return JSON.stringify({ version: MEALS_VERSION, ...state }, null, 2);
}

async function readRecipes(io: RecipeIo): Promise<MealsRecipes> {
  const state = await readGuardedFile(io, MEALS_RECIPES_FILE, parseRecipeFile);
  return state ?? { recipes: {} };
}

/** The stored recipe for a key, or null when there is none yet. */
export async function loadRecipe(key: string, io: RecipeIo = recipeIo): Promise<RecipeEntry | null> {
  return (await readRecipes(io)).recipes[key] ?? null;
}

/** What survives a save at `now`: the newest RECIPE_KEEP_COUNT written within RECIPE_KEEP_DAYS. */
export function keptRecipes(recipes: Readonly<Record<string, RecipeEntry>>, now: number): Record<string, RecipeEntry> {
  const floor = now - RECIPE_KEEP_DAYS * 86_400_000;
  const kept = Object.entries(recipes)
    .filter(([, e]) => e.at >= floor)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, RECIPE_KEEP_COUNT);
  return Object.fromEntries(kept);
}

/**
 * Write one recipe, merged into whatever is there, and drop what has aged out.
 * The retention of the file (palace/kinds.ts) is this function.
 */
export async function saveRecipe(
  key: string,
  entry: RecipeEntry,
  now: number = Date.now(),
  io: RecipeIo = recipeIo,
): Promise<RecipeEntry> {
  const current = await readRecipes(io);
  const recipes = keptRecipes({ ...current.recipes, [key]: entry }, now);
  await io.write(MEALS_RECIPES_FILE, recipeFileBody({ recipes }));
  return entry;
}
