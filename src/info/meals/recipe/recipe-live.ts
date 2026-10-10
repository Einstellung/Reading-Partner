// Writing a recipe with the real model and keeping it (docs/73 做法页).
//
// The reader has the page open and is watching the steps area, so the call is
// on the talk tier ("chat", ai/model-tier.ts). One call per recipe: a reply
// that does not read is a failure the page offers to retry, not a second call
// made behind its back.

import { callModel, resolveModel } from "../../../ai/model-call";
import { newTally, reportParse } from "../../../platform/app/structured-output";
import { parseRecipe, recipeSystemPrompt, recipeUserText, type RecipeEntry, type RecipeRequest } from "./recipe";
import { loadRecipe, saveRecipe } from "./recipe-store";

// One call per key at a time. Leaving the page does not cancel it — the recipe
// is saved when it lands — and coming back while it runs waits on the same one.
const inFlight = new Map<string, Promise<RecipeEntry>>();

async function writeRecipe(request: RecipeRequest): Promise<RecipeEntry> {
  const model = await resolveModel("chat");
  const text = await callModel(
    "chat",
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

/** The stored recipe for a request, or null when none has been written. */
export function storedRecipe(request: RecipeRequest): Promise<RecipeEntry | null> {
  return loadRecipe(request.key);
}

/** The recipe for a request: the one being written, or a new call. */
export function writeRecipeOnce(request: RecipeRequest): Promise<RecipeEntry> {
  const running = inFlight.get(request.key);
  if (running) return running;
  const call = writeRecipe(request).finally(() => inFlight.delete(request.key));
  inFlight.set(request.key, call);
  return call;
}

/** Whether a call for this key is running now. */
export function recipeBeingWritten(key: string): boolean {
  return inFlight.has(key);
}
