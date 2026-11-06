// The meals read tools bound to this device's files and clock (read-tools.ts),
// for the places that answer meals questions without the meals desk: the
// voice call's think run and the tasking worker. Kept apart from live.ts so
// that mounting reads does not pull in the photo search and the recipe writer.

import { localDate } from "../../platform/std/day";
import type { AgentTool } from "../../legion/durable/contract";
import { loadMeals } from "./plan/store";
import { loadMealsDraft } from "./draft-store";
import { buildMealsReadTools, type MealsReadDeps } from "./read-tools";
import { loadRecipeFile } from "./recipe/recipe-store";
import { recipeLanguageNow } from "./recipe/recipe-live";
import { hostRegion } from "./region";

/** The read deps over the live store; `today` is the host's local date unless the caller has its own. */
export function liveMealsReadDeps(today: () => string = () => localDate(Date.now())): MealsReadDeps {
  return {
    state: () => loadMeals(),
    today,
    region: () => hostRegion(),
    recipes: () => loadRecipeFile(),
    recipeLanguage: () => recipeLanguageNow(),
    draft: () => loadMealsDraft(),
  };
}

/** The meals read tools over this device's files. */
export function buildLiveMealsReadTools(): AgentTool[] {
  return buildMealsReadTools(liveMealsReadDeps());
}
