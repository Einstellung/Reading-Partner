// Writing a recipe with the real model and keeping it (docs/73 做法页).
//
// Most recipes are written in the background before anyone opens the page
// (recipe-sweep.ts), on the everyday tier ("meals", ai/model-tier.ts). A page
// opened before the sweep reached its meal writes it on the talk tier
// ("chat"): the reader is watching the steps area. One call per recipe: a
// reply that does not read is a failure, not a second call made behind the
// reader's back.

import { callModel, resolveModel } from "../../../ai/model-call";
import type { ThinkingKind } from "../../../ai/model-tier";
import type { Locale } from "../../../i18n/locale";
import { loadSettings } from "../../../platform/app/settings";
import { newTally, reportParse } from "../../../platform/app/structured-output";
import {
  parseRecipe,
  recipeLanguage,
  recipeSystemPrompt,
  recipeUserText,
  type RecipeEntry,
  type RecipeRequest,
} from "./recipe";
import { loadRecipe, saveRecipe } from "./recipe-store";

/** Who is asking: the page the reader is watching, or the background sweep. */
export type RecipeTier = Extract<ThinkingKind, "chat" | "meals">;

// One call per key at a time, whoever started it. Leaving the page does not
// cancel it — the recipe is saved when it lands — and the page opened while
// the sweep writes its meal, or opened again, waits on the same call.
const inFlight = new Map<string, Promise<RecipeEntry>>();

async function writeRecipe(request: RecipeRequest, tier: RecipeTier): Promise<RecipeEntry> {
  const model = await resolveModel(tier);
  const text = await callModel(
    tier,
    "plan",
    recipeSystemPrompt(request),
    recipeUserText(request),
    { signal: new AbortController().signal, onProgress: () => {} },
    { spend: { caller: "info" } },
  );
  const tally = newTally();
  const parsed = parseRecipe(text, tally);
  reportParse({ site: "meals-recipe", model, text, tally, error: parsed.ok ? undefined : parsed.error });
  if (!parsed.ok) throw new Error(parsed.error);
  const entry: RecipeEntry = { at: Date.now(), name: request.name, ...parsed.value };
  return saveRecipe(request.key, entry);
}

/** The language a recipe asked for now is written in, read from the answer-language setting. */
export async function recipeLanguageNow(): Promise<Locale> {
  return recipeLanguage((await loadSettings()).aiLanguage);
}

/** The stored recipe for a request, or null when none has been written. */
export function storedRecipe(request: RecipeRequest): Promise<RecipeEntry | null> {
  return loadRecipe(request.key);
}

/**
 * The recipe for a request: the one being written, or a new call on `tier`.
 * A call already running keeps the tier it started on.
 */
export function writeRecipeOnce(request: RecipeRequest, tier: RecipeTier = "chat"): Promise<RecipeEntry> {
  const running = inFlight.get(request.key);
  if (running) return running;
  const call = writeRecipe(request, tier).finally(() => inFlight.delete(request.key));
  inFlight.set(request.key, call);
  return call;
}

/** Whether a call for this key is running now. */
export function recipeBeingWritten(key: string): boolean {
  return inFlight.has(key);
}
