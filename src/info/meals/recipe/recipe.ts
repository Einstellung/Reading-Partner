// One made meal's recipe page (docs/73 做法页): what the model is asked, what
// its answer is held to, and the numbers the page adds to it.
//
// The model writes the steps and, for a dish that keeps, how to cook it ahead.
// It never writes a gram: the list above the steps carries the solved weights,
// and the cook-ahead amounts are those weights times the servings, computed
// here (docs/73 事实不经模型).

import { t } from "../../../i18n";
import { aiLanguageName, type AiLanguage } from "../../../platform/app/settings";
import { readObject } from "../../../platform/std/json";
import type { ParseTally } from "../../../platform/app/structured-output";
import { hashText } from "../../../platform/sync/merge/text";
import { foodById } from "../nutrition/foods";
import type { Effort, Profile } from "../nutrition/targets";
import type { IngredientRow, MealView } from "../screen/view";

/** How to cook the dish ahead for several meals. Absent for a dish that does not keep. */
export interface RecipeBatch {
  // How many meals one cooking makes, this one included.
  servings: number;
  // Which ingredient rows are cooked ahead, 1-based in the order of the list.
  // The rest (a steamed bun, fruit) are made fresh each time.
  cook: number[];
  // What changes at that size, or what is not made ahead. May be empty.
  note: string;
  pack: string;
  keep: string;
  reheat: string;
}

/** What the model wrote for one meal. */
export interface RecipeText {
  steps: string[];
  batch: RecipeBatch | null;
}

/** One stored recipe: the text, when it was written and what it was for. */
export interface RecipeEntry extends RecipeText {
  at: number;
  // The dish's name, for whoever reads the file.
  name: string;
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
}

/**
 * The stored recipe's key: the dish, every food at its solved grams, the
 * kitchen and the language. A meal whose dish or grams changed, a kitchen the
 * reader re-described, or a switch of language each ask for a new recipe, and
 * the old one is left for retention to drop.
 */
export function recipeKey(
  name: string,
  rows: ReadonlyArray<Pick<IngredientRow, "foodId" | "grams">>,
  kitchen: readonly string[],
  language: string,
): string {
  const foods = rows.map((r) => `${r.foodId}:${r.grams}`).sort();
  return hashText(JSON.stringify([name, foods, [...kitchen], language]));
}

/** The request for one made meal, or null for a meal the page has nothing to write for. */
export function recipeRequest(view: MealView, profile: Profile, language: AiLanguage): RecipeRequest | null {
  if (view.mode !== "make" || view.rows.length === 0) return null;
  const rows = view.rows.map((r) => ({ foodId: r.foodId, name: r.name, grams: r.grams, units: r.units }));
  return {
    key: recipeKey(view.name, rows, profile.kitchen, language),
    name: view.name,
    flavour: view.flavourLabel,
    minutes: view.minutes,
    method: view.method,
    rows,
    kitchen: profile.kitchen,
    effort: profile.effort,
    language,
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
    "",
    "Batch: whether this dish is worth cooking ahead for several meals.",
    "- null for a dish that suffers from it: noodles, shrimp, salmon and other fish, soft eggs, salads, anything crisp, anything that takes under ten minutes anyway.",
    "- For one that keeps (stews, braises, sauced meat, beans, grains cooked in a pot): servings 2 to 4, this meal included. cook lists the numbers of the ingredients that are cooked ahead; leave out what is better fresh each time (steamed buns, raw fruit, yogurt).",
    "- note: one sentence on what changes when cooking that much (a longer simmer, the pot it fits in) or what is made fresh each time. pack, keep, reheat: one sentence each — how to portion it, how long it keeps in the fridge and the freezer, how to reheat it with this kitchen.",
    "- Never write an amount in batch: the app multiplies the list by the servings and prints it.",
    "",
    `Write every sentence in ${language}.`,
    "",
    "Reply with one JSON object and nothing else:",
    '{"steps": ["…", "…"], "batch": null}',
    "or",
    '{"steps": ["…"], "batch": {"servings": 3, "cook": [1, 3], "note": "…", "pack": "…", "keep": "…", "reheat": "…"}}',
  ].join("\n");
}

/** The user message: the meal, numbered so batch.cook can point at rows. */
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
  ];
  return lines.join("\n");
}

// "1. ", "1、", "Step 1:", "第1步：" — the page numbers the steps itself.
const LEADING_NUMBER = /^\s*(?:step\s*\d+\s*[:.：]|第\s*\d+\s*步\s*[:：]?|\d+\s*[.)、:：])\s*/i;

function sentence(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function parseBatch(raw: unknown, rowCount: number, tally?: ParseTally): RecipeBatch | null {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const servings = typeof b.servings === "number" && Number.isFinite(b.servings) ? Math.round(b.servings) : 0;
  const cook = Array.isArray(b.cook)
    ? [...new Set(b.cook.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= rowCount))].sort((x, y) => x - y)
    : [];
  const pack = sentence(b.pack);
  const keep = sentence(b.keep);
  const reheat = sentence(b.reheat);
  if (servings < 2 || servings > 6 || cook.length === 0 || !pack || !keep || !reheat) {
    if (tally) tally.repaired++;
    return null;
  }
  return { servings, cook, note: sentence(b.note), pack, keep, reheat };
}

/**
 * The model's reply as a recipe, or an error. Steps that are not text are
 * dropped and a leading number is taken off; a batch that is not whole is
 * dropped rather than shown half.
 */
export function parseRecipe(
  text: string,
  rowCount: number,
  tally?: ParseTally,
): { ok: true; value: RecipeText } | { ok: false; error: string } {
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
  return { ok: true, value: { steps, batch: parseBatch(read.value.batch, rowCount, tally) } };
}

/** One row of the cook-ahead amounts. */
export interface BatchAmount {
  name: string;
  grams: number;
  // "6 个" for a food counted in units.
  units: string | null;
}

/** The cooked-ahead rows at their weight for every serving, by the program. */
export function batchAmounts(
  rows: ReadonlyArray<Pick<IngredientRow, "foodId" | "name" | "grams">>,
  batch: Pick<RecipeBatch, "servings" | "cook">,
): BatchAmount[] {
  return batch.cook.flatMap((n) => {
    const row = rows[n - 1];
    if (!row) return [];
    const grams = Math.round(row.grams * batch.servings);
    const unit = foodById(row.foodId)?.unit;
    return [{ name: row.name, grams, units: unit ? `${Math.round(grams / unit.grams)} ${unit.label}` : null }];
  });
}

/** The first line of the cook-ahead card: how many meals, the amounts, the model's note. */
export function batchMakeLine(
  rows: ReadonlyArray<Pick<IngredientRow, "foodId" | "name" | "grams">>,
  batch: RecipeBatch,
): string {
  const items = batchAmounts(rows, batch)
    .map((a) =>
      a.units
        ? t("meals.recipe.batchItemUnits", { name: a.name, grams: a.grams, units: a.units })
        : t("meals.recipe.batchItem", { name: a.name, grams: a.grams }),
    )
    .join(t("meals.recipe.listSep"));
  const line = t("meals.recipe.batchMake", { count: batch.servings, items });
  if (!batch.note) return line;
  // A line that ends in a full-width stop (Chinese, Japanese) takes the note without a space.
  return /[。！？]$/.test(line) ? `${line}${batch.note}` : `${line} ${batch.note}`;
}
