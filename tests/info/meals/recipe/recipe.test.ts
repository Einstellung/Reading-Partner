// The recipe page's pure half (src/info/meals/recipe/recipe.ts) and its file
// (recipe-store.ts): the key, the prompt, the parse, the cook-ahead amounts,
// and what a save keeps.
// Run: scripts/t.sh tests/info/meals/recipe

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createFakeAppData, type FakeAppData } from "../../../support/guarded-appdata";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import {
  batchAmounts,
  batchMakeLine,
  parseRecipe,
  recipeKey,
  recipeRequest,
  recipeSystemPrompt,
  recipeUserText,
  type RecipeBatch,
  type RecipeEntry,
} from "../../../../src/info/meals/recipe/recipe";
import {
  MEALS_RECIPES_FILE,
  RECIPE_KEEP_COUNT,
  RECIPE_KEEP_DAYS,
  keptRecipes,
  loadRecipe,
  parseRecipeFile,
  saveRecipe,
} from "../../../../src/info/meals/recipe/recipe-store";
import { newTally } from "../../../../src/platform/app/structured-output";
import { strategyFor } from "../../../../src/platform/sync/merge/contract";
import { dayViewOn } from "../../../../src/info/meals/screen/view";
import { MON, profile, state } from "../fixtures/week";

let io: FakeAppData;
// The locale is one store for the whole process; put back what was there.
let before: Locale;

beforeEach(() => {
  io = createFakeAppData();
  before = getLocale();
  setLocale("zh-CN");
});

afterEach(() => setLocale(before));

const ROWS = [
  { foodId: "chicken_thigh", name: "鸡腿肉", grams: 80, units: null },
  { foodId: "egg", name: "鸡蛋", grams: 150, units: "3 个" },
  { foodId: "steamed_bun", name: "馒头", grams: 260, units: null },
];

const BATCH: RecipeBatch = {
  servings: 3,
  cook: [1, 2],
  note: "焖的时间加到 8 分钟。",
  pack: "分成 3 盒。",
  keep: "冷藏 3 天。",
  reheat: "微波 2 分钟。",
};

// A made meal off the shared week, with its solved rows.
function madeMeal() {
  const day = dayViewOn(state(), MON, MON, "other")!;
  return day.meals.find((m) => m.mode === "make" && m.rows.length > 0)!;
}

test("the key moves with the dish, a gram, the kitchen and the language, and not with row order", () => {
  const base = recipeKey("照烧鸡腿", ROWS, ["小锅"], "zh-CN");
  expect(recipeKey("照烧鸡腿", [...ROWS].reverse(), ["小锅"], "zh-CN")).toBe(base);
  expect(recipeKey("照烧鸡排", ROWS, ["小锅"], "zh-CN")).not.toBe(base);
  expect(recipeKey("照烧鸡腿", [{ ...ROWS[0], grams: 90 }, ROWS[1], ROWS[2]], ["小锅"], "zh-CN")).not.toBe(base);
  expect(recipeKey("照烧鸡腿", ROWS, ["小锅", "豆浆机"], "zh-CN")).not.toBe(base);
  expect(recipeKey("照烧鸡腿", ROWS, ["小锅"], "en")).not.toBe(base);
});

test("a made meal asks with its rows and the reader's kitchen; a meal not made asks nothing", () => {
  const view = madeMeal();
  const p = profile({ kitchen: ["小锅（带蒸架，一次蒸一个馒头）", "豆浆机"] });
  const req = recipeRequest(view, p, "zh-CN")!;
  expect(req.rows.map((r) => r.grams)).toEqual(view.rows.map((r) => r.grams));
  expect(req.key).toBe(recipeKey(view.name, view.rows, p.kitchen, "zh-CN"));
  const text = recipeUserText(req);
  expect(text).toContain("小锅（带蒸架，一次蒸一个馒头）");
  expect(text).toContain(`1. ${view.rows[0].name} ${view.rows[0].grams} g`);
  expect(recipeRequest({ ...view, mode: "out" }, p, "zh-CN")).toBeNull();
});

test("the prompt names the language and forbids grams in the steps and the batch", () => {
  const prompt = recipeSystemPrompt({ effort: "simple", language: "zh-CN" });
  expect(prompt).toContain("简体中文");
  expect(prompt).toContain("Do not repeat the grams");
  expect(prompt).toContain("Never write an amount in batch");
});

test("steps lose a leading number; a batch that is not whole is dropped", () => {
  const tally = newTally();
  const reply =
    'Here: {"steps": ["1. 鸡腿切块。", "第2步：下锅煎。", " ", 3], "batch": {"servings": 3, "cook": [1], "pack": "分装。", "keep": ""}}';
  const parsed = parseRecipe(reply, 3, tally);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.steps).toEqual(["鸡腿切块。", "下锅煎。"]);
  expect(parsed.value.batch).toBeNull();
  expect(tally).toMatchObject({ seen: 4, kept: 2, repaired: 1 });
});

test("a batch keeps only rows that exist, in order, once", () => {
  const reply = JSON.stringify({ steps: ["a"], batch: { ...BATCH, cook: [3, 1, 1, 9, 0] } });
  const parsed = parseRecipe(reply, 3);
  expect(parsed.ok && parsed.value.batch?.cook).toEqual([1, 3]);
});

test("no steps is a failure", () => {
  expect(parseRecipe('{"steps": []}', 3).ok).toBe(false);
  expect(parseRecipe("no json here", 3).ok).toBe(false);
});

test("the cook-ahead amounts are the solved grams times the servings, eggs counted", () => {
  expect(batchAmounts(ROWS, BATCH)).toEqual([
    { name: "鸡腿肉", grams: 240, units: null },
    { name: "鸡蛋", grams: 450, units: "9 个" },
  ]);
  expect(batchMakeLine(ROWS, BATCH)).toBe("一次做 3 顿：鸡腿肉 240 克、鸡蛋 9 个（450 克）。焖的时间加到 8 分钟。");
});

const entry = (at: number, name = "x"): RecipeEntry => ({ at, name, steps: ["a"], batch: null });

test("a save merges into the file and reads back", async () => {
  await saveRecipe("k1", entry(1000, "one"), 1000, io);
  await saveRecipe("k2", { ...entry(2000, "two"), batch: BATCH }, 2000, io);
  expect((await loadRecipe("k1", io))?.name).toBe("one");
  expect((await loadRecipe("k2", io))?.batch).toEqual(BATCH);
  expect(await loadRecipe("k3", io)).toBeNull();
  expect(JSON.parse(io.files.get(MEALS_RECIPES_FILE)!).recipes).toHaveProperty("k1");
});

test("a save drops what aged out and keeps the newest", () => {
  const now = RECIPE_KEEP_DAYS * 86_400_000 * 2;
  const old = now - (RECIPE_KEEP_DAYS + 1) * 86_400_000;
  expect(Object.keys(keptRecipes({ old: entry(old), fresh: entry(now) }, now))).toEqual(["fresh"]);
  const many = Object.fromEntries(Array.from({ length: RECIPE_KEEP_COUNT + 5 }, (_, i) => [`k${i}`, entry(now - i)]));
  const kept = keptRecipes(many, now);
  expect(Object.keys(kept)).toHaveLength(RECIPE_KEEP_COUNT);
  expect(kept).not.toHaveProperty(`k${RECIPE_KEEP_COUNT}`);
});

test("an entry that does not read is skipped, not the file", () => {
  const parsed = parseRecipeFile({ recipes: { good: entry(1), bad: { at: 1, steps: [] }, worse: 3 } });
  expect(Object.keys(parsed!.recipes)).toEqual(["good"]);
  expect(parseRecipeFile([])).toBeNull();
});

test("the file merges per recipe across devices", () => {
  expect(strategyFor(MEALS_RECIPES_FILE)).toBe("records");
});
