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
import { writePrepSteps, type PrepStepsEntry, type PrepStepsRequest } from "./prep-steps";
import {
  parseRecipe,
  recipeLanguage,
  recipeSystemPrompt,
  recipeUserText,
  type RecipeEntry,
  type RecipeRequest,
} from "./recipe";
import { loadPrepSteps, loadRecipe, savePrepSteps, saveRecipe } from "./recipe-store";

/** Who is asking: the page the reader is watching, or the background sweep. */
export type RecipeTier = Extract<ThinkingKind, "chat" | "meals">;

// One call per key at a time, whoever started it. Leaving the page does not
// cancel it — the recipe is saved when it lands — and the page opened while
// the sweep writes its meal, or opened again, waits on the same call. A prep
// session's steps go through the same map under their own key.
const inFlight = new Map<string, Promise<unknown>>();

function once<T>(key: string, start: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const call = start().finally(() => inFlight.delete(key));
  inFlight.set(key, call);
  return call;
}

function callOn(tier: RecipeTier, system: string, user: string): Promise<string> {
  return callModel(
    tier,
    "plan",
    system,
    user,
    { signal: new AbortController().signal, onProgress: () => {} },
    { spend: { caller: "info" } },
  );
}

async function writeRecipe(request: RecipeRequest, tier: RecipeTier): Promise<RecipeEntry> {
  const model = await resolveModel(tier);
  const text = await callOn(tier, recipeSystemPrompt(request), recipeUserText(request));
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
  return once(request.key, () => writeRecipe(request, tier));
}

/** The stored steps of a prep session, or null when none have been written. */
export function storedPrepSteps(request: Pick<PrepStepsRequest, "key">): Promise<PrepStepsEntry | null> {
  return loadPrepSteps(request.key);
}

/**
 * A prep session's steps: the call being made, or a new one on `tier`
 * (docs/671 菜品图): the background sweep on "meals", the prep page opened
 * before it on "chat".
 */
export function writePrepStepsOnce(request: PrepStepsRequest, tier: RecipeTier = "chat"): Promise<PrepStepsEntry> {
  return once(request.key, async () => {
    const model = await resolveModel(tier);
    return writePrepSteps(request, {
      call: (system, user) => callOn(tier, system, user),
      save: (key, entry) => savePrepSteps(key, entry),
      now: () => Date.now(),
      report: (text, tally, error) => reportParse({ site: "meals-recipe", model, text, tally, error }),
    });
  });
}

/** Whether a call for this key is running now. */
export function recipeBeingWritten(key: string): boolean {
  return inFlight.has(key);
}
