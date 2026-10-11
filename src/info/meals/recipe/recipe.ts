// One made meal's recipe page (docs/73 做法页): what the model is asked, what
// its answer is held to, and the step the program adds to it.
//
// The model writes the steps. It never writes a gram — the list above the
// steps carries the solved weights — and never how a pot is packed and kept:
// the meal a pot is cooked at ends with a packing step written here from the
// plan (docs/73 一锅, 事实不经模型).

import { t } from "../../../i18n";
import { aiLanguageName, type AiLanguage } from "../../../platform/app/settings";
import { readObject } from "../../../platform/std/json";
import type { ParseTally } from "../../../platform/app/structured-output";
import { hashText } from "../../../platform/sync/merge/text";
import { foodById } from "../nutrition/foods";
import type { Effort, Profile } from "../nutrition/targets";
import type { PotPortion, PotStorage } from "../plan/pots";
import { boxName, type IngredientRow, type MealView } from "../screen/view";

/** What the model wrote for one meal. */
export interface RecipeText {
  steps: string[];
}

/** One stored recipe: the text, when it was written and what it was for. */
export interface RecipeEntry extends RecipeText {
  at: number;
  // The dish's name, for whoever reads the file.
  name: string;
}

/** What the model is told about the pot a meal is cooked at or eats from. */
export interface RecipePot {
  name: string;
  method: string;
  // The pot's food, by its table name.
  food: string;
  rawG: number;
  // How many meals it feeds.
  count: number;
  // This meal cooks it, rather than eating a box of it.
  cooks: boolean;
  storage: PotStorage;
}

/** Everything one call is written from. */
export interface RecipeRequest {
  key: string;
  name: string;
  flavour: string;
  minutes: number | null;
  method: string;
  rows: ReadonlyArray<Pick<IngredientRow, "foodId" | "name" | "grams" | "units">>;
  kitchen: readonly string[];
  effort: Effort;
  language: AiLanguage;
  pot: RecipePot | null;
}

/**
 * The stored recipe's key: the dish, every food at its solved grams, the
 * kitchen and the language, and for a pot meal what the steps depend on —
 * whether it cooks the pot or eats a box, the pot's name, method, weight and
 * meals, and where the box waits. Any of them changing asks for a new recipe,
 * and the old one is left for retention to drop. A meal without a pot keys as
 * it always has.
 */
export function recipeKey(
  name: string,
  rows: ReadonlyArray<Pick<IngredientRow, "foodId" | "grams">>,
  kitchen: readonly string[],
  language: string,
  pot: RecipePot | null = null,
): string {
  const foods = rows.map((r) => `${r.foodId}:${r.grams}`).sort();
  const base: unknown[] = [name, foods, [...kitchen], language];
  if (pot) base.push([pot.cooks ? "cook" : "eat", pot.name, pot.method, pot.rawG, pot.count, pot.storage]);
  return hashText(JSON.stringify(base));
}

/** What the recipe call is told about a meal's share of a pot. */
export function recipePot(portion: PotPortion | null): RecipePot | null {
  if (!portion) return null;
  const { pot } = portion;
  return {
    name: pot.name,
    method: pot.method,
    food: foodById(pot.foodId)?.zh ?? pot.foodId,
    rawG: pot.rawG,
    count: portion.count,
    cooks: portion.cooks,
    storage: portion.storage,
  };
}

/** The request for one made meal, or null for a meal the page has nothing to write for. */
export function recipeRequest(view: MealView, profile: Profile, language: AiLanguage): RecipeRequest | null {
  if (view.mode !== "make" || view.rows.length === 0) return null;
  const rows = view.rows.map((r) => ({ foodId: r.foodId, name: r.name, grams: r.grams, units: r.units }));
  const pot = recipePot(view.pot);
  return {
    key: recipeKey(view.name, rows, profile.kitchen, language, pot),
    name: view.name,
    flavour: view.flavourLabel,
    minutes: view.minutes,
    method: view.method,
    rows,
    kitchen: profile.kitchen,
    effort: profile.effort,
    language,
    pot,
  };
}

const EFFORT_LINE: Record<Effort, string> = {
  simple:
    "The reader chose the simple level: keep to the method line, no extra techniques, as few pans and steps as the dish allows.",
  homestyle: "The reader chose the home-style level: a little more care is welcome, but nothing a home cook would not do.",
};

/** The system prompt. */
export function recipeSystemPrompt(request: Pick<RecipeRequest, "effort" | "language">): string {
  const language = aiLanguageName(request.language) ?? "the language the dish is named in";
  return [
    "You write the cooking steps for one meal of a meal plan. The reader follows them in their own kitchen, one step at a time, so every step has to be doable exactly as written with the equipment they have.",
    "",
    "Steps:",
    "- 3 to 8 steps, in the order the reader does them, each one or two short sentences. Say the heat and the minutes. Use waiting time (while the water heats, cut the tofu).",
    "- Use the listed ingredients, plus water, salt and cooking oil.",
    "- Do not repeat the grams from the ingredient list: the list is printed right above the steps. A small measure that is not on the list (2 spoons of water) is fine.",
    "- Write to the reader's kitchen as they described it and keep to its limits. If the steamer rack holds one bun, steam one and heat the rest another way. Frozen steamed buns go straight onto the rack, no thawing. If the dish wants a tool they do not have, use one they do.",
    "- Say when something has to be cooked through to be safe to eat (green beans, chicken, pork, eggs).",
    `- ${EFFORT_LINE[request.effort]}`,
    "- Some meals cook a pot of meat that several meals eat from, or eat one box of such a pot. The message says which and what to write. The app adds the step that packs the pot into boxes and says where each box is kept: never write packing, storage times or which day a box is for.",
    "",
    `Write every sentence in ${language}.`,
    "",
    "Reply with one JSON object and nothing else:",
    '{"steps": ["…", "…"]}',
  ].join("\n");
}

// What the user message says about the pot, after the ingredients.
function potLines(pot: RecipePot): string[] {
  if (pot.cooks) {
    return [
      `This meal cooks a pot: ${pot.name}, ${pot.rawG} g of raw ${pot.food}. How: ${pot.method}`,
      `The pot feeds ${pot.count} meals and this one eats its share now; the ingredient list gives this meal's share of the ${pot.food}.`,
      `Write the steps for cooking the whole ${pot.rawG} g, then for putting this meal together with its fresh parts. Stop before packing the rest: the app adds that step.`,
    ];
  }
  const where =
    pot.storage === "freezer"
      ? "It was moved from the freezer to the fridge last night and has thawed."
      : "It is in the fridge.";
  return [
    `This meal eats one box from a pot cooked earlier: ${pot.name} (${pot.food}), cooked like this: ${pot.method}. ${where}`,
    `The ${pot.food} is already cooked; the list gives its raw weight. Do not cook it again: take the box out, heat it through with this kitchen, and make the fresh parts (the staple, the vegetables) while it heats.`,
  ];
}

/** The user message: the meal, numbered, then the pot it cooks or eats from. */
export function recipeUserText(request: RecipeRequest): string {
  const lines = [
    `Dish: ${request.name}`,
    ...(request.flavour ? [`Flavour: ${request.flavour}`] : []),
    ...(request.minutes !== null ? [`Hands-on minutes: ${request.minutes}`] : []),
    ...(request.method ? [`The plan's one-line method: ${request.method}`] : []),
    "Ingredients for this one meal:",
    ...request.rows.map((r, i) => `${i + 1}. ${r.name} ${r.grams} g${r.units ? ` (${r.units})` : ""}`),
    "Kitchen:",
    ...(request.kitchen.length > 0 ? request.kitchen.map((k) => `- ${k}`) : ["- (not described: assume a stove, one pot, one pan and a microwave)"]),
    ...(request.pot ? ["", ...potLines(request.pot)] : []),
  ];
  return lines.join("\n");
}

// "1. ", "1、", "Step 1:", "第1步：" — the page numbers the steps itself.
const LEADING_NUMBER = /^\s*(?:step\s*\d+\s*[:.：]|第\s*\d+\s*步\s*[:：]?|\d+\s*[.)、:：])\s*/i;

function sentence(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * The model's reply as a recipe, or an error. Steps that are not text are
 * dropped and a leading number is taken off. Anything else in the reply is
 * ignored.
 */
export function parseRecipe(text: string, tally?: ParseTally): { ok: true; value: RecipeText } | { ok: false; error: string } {
  const read = readObject(text);
  if (!read.ok) return read;
  const raw = read.value.steps;
  const all = Array.isArray(raw) ? raw : [];
  const steps = all.map((s) => sentence(s).replace(LEADING_NUMBER, "").trim()).filter((s) => s.length > 0);
  if (tally) {
    tally.seen += all.length;
    tally.kept += steps.length;
  }
  if (steps.length === 0) {
    if (tally) tally.fail = all.length === 0 ? "missing-field" : "empty-result";
    return { ok: false, error: "no steps in reply" };
  }
  return { ok: true, value: { steps } };
}

/**
 * The last step of the meal a pot is cooked at, by the program: how many boxes
 * the rest goes into, which go in the fridge and which in the freezer, each
 * marked with its day and meal. Null for any other meal.
 */
export function packStep(portion: PotPortion | null): string | null {
  if (!portion?.cooks || portion.boxes.length === 0) return null;
  const sep = t("meals.recipe.listSep");
  const names = (storage: PotStorage) =>
    portion.boxes
      .filter((b) => b.storage === storage)
      .map((b) => boxName(b.ref))
      .join(sep);
  const fridge = names("fridge");
  const freezer = names("freezer");
  const where = [
    ...(fridge ? [t("meals.recipe.packFridge", { boxes: fridge })] : []),
    ...(freezer ? [t("meals.recipe.packFreezer", { boxes: freezer })] : []),
  ].join(t("meals.recipe.packJoin"));
  return t("meals.recipe.pack", { count: portion.boxes.length, where });
}
