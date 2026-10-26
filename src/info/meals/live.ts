// The meals tools bound to the real store and the real clock (docs/73), the
// way companion-live.ts binds the briefing's.
//
// The pure tools take ports so they can be tested without a filesystem; this is
// where those ports become loadMeals and the four writes. The card sink and
// the screen's reload come from whoever is running the turn.

import type { MealsPorts } from "./apply";
import type { MealsCard, MealsDraftCardData } from "./cards";
import { ingredientImageUrl } from "./photos/images";
import { mealsCanDraw, mealsDishDrawer } from "./photos/dish-draw-sweep";
import { mealsPhotoSearcher } from "./photos/photo-sweep";
import { loadMealsPhotos } from "./photos/photo-store";
import { recipeLanguageNow, writeRecipeOnce } from "./recipe/recipe-live";
import { storedRecipeKeys } from "./recipe/recipe-store";
import { createRecipeWriter, watchMealsForRecipes, type RecipeWriter } from "./recipe/recipe-sweep";
import {
  loadMeals,
  saveCharter,
  saveDeviation,
  saveMealMethod,
  savePhotosAsked,
  savePlan,
  saveShopping,
} from "./plan/store";
import { hasWebviewFetch } from "../../platform/app/platform";
import { localDate } from "../../platform/std/day";
import { buildMealsCatalogTools } from "./tools";
import type { Applied } from "./apply";
import { hostRegion } from "./region";
import type { AgentTool } from "../../legion/durable/contract";

export interface LiveMealsOptions {
  // The conversation the cards belong to.
  threadId: string;
  // Where a drafted card goes: raised, or the draft card it revises replaced in place.
  onMealsCard(card: MealsCard): void;
  // The draft card waiting in this conversation, and its Apply (tools.ts MealsToolDeps).
  currentDraft?(): MealsDraftCardData | null;
  applyDraft?(): Promise<Applied | null>;
  // The host's local date, so the tools and the screen agree on which night it
  // is without either of them asking the model.
  today(): string;
  // The screen reloads: a deviation writes without a card, so nothing else
  // would tell it.
  changed(): void;
}

let recipeWriter: RecipeWriter | null = null;

/** This device's recipe writer (recipe/recipe-sweep.ts). One, so that "one round at a time" means anything. */
export function mealsRecipeWriter(): RecipeWriter {
  recipeWriter ??= createRecipeWriter({
    state: () => loadMeals(),
    language: () => recipeLanguageNow(),
    region: () => hostRegion(),
    stored: () => storedRecipeKeys(),
    write: (request) => writeRecipeOnce(request, "meals"),
    today: () => localDate(Date.now()),
    now: () => Date.now(),
  });
  return recipeWriter;
}

let recipesWatched = false;

/** Write the week's recipes now and on every pull of the week. Idempotent. */
export function startMealsRecipeHousekeeping(): void {
  if (recipesWatched) return;
  recipesWatched = true;
  watchMealsForRecipes(mealsRecipeWriter());
}

// A write that changes the week's meals or grams changes their recipe keys:
// the recipes are written for the new week once it is on disk.
function thenWriteRecipes<T>(write: Promise<T>): Promise<T> {
  return write.then((result) => {
    void mealsRecipeWriter().sweep();
    return result;
  });
}

/**
 * The ports every meals write goes through, on the live store.
 *
 * `startPhotoRun` is here only on a machine with the hidden webview: the run is
 * `local`, so whoever starts one executes it, and a phone starting one would be
 * searching with nothing to search in (docs/73 图片, pitfall 380). Where it is
 * here, it goes through the one searcher, so an Apply cannot start a second run
 * on top of the pass that watches the synced week.
 */
export function liveMealsPorts(opts: Pick<LiveMealsOptions, "today" | "changed">): MealsPorts {
  const searcher = mealsPhotoSearcher();
  return {
    current: () => loadMeals(),
    saveCharter: (charter, week) => thenWriteRecipes(saveCharter(charter, week)),
    savePlan: (plan, shopping) => thenWriteRecipes(savePlan(plan, shopping)),
    saveDeviation: (deviation, plan, shopping) => thenWriteRecipes(saveDeviation(deviation, plan, shopping)),
    saveShopping: (shopping) => saveShopping(shopping),
    saveMealMethod: (date, meal, method) => thenWriteRecipes(saveMealMethod(date, meal, method)),
    region: () => hostRegion(),
    photos: () => loadMealsPhotos(),
    ...(hasWebviewFetch()
      ? { startPhotoRun: (planId, queries) => searcher.start(planId, queries) }
      : {}),
    markPhotosAsked: (at) => savePhotosAsked(at),
    drawDishes: () => mealsDishDrawer().sweep(),
    canDraw: () => mealsCanDraw(),
    bankImage: (en) => ingredientImageUrl(en),
    now: () => Date.now(),
    today: opts.today,
    changed: opts.changed,
  };
}

/** The tools the meals desk mounts. */
export function buildLiveMealsTools(opts: LiveMealsOptions): AgentTool[] {
  const ports = liveMealsPorts(opts);
  const deps = {
    threadId: opts.threadId,
    state: () => loadMeals(),
    today: opts.today,
    now: () => Date.now(),
    region: () => hostRegion(),
    onMealsCard: opts.onMealsCard,
    ...(opts.currentDraft ? { currentDraft: opts.currentDraft } : {}),
    ...(opts.applyDraft ? { applyDraft: opts.applyDraft } : {}),
  };
  return buildMealsCatalogTools({ ...deps, ports });
}
