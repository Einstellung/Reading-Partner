// The recipe page's pure half (src/info/meals/recipe/recipe.ts) and its file
// (recipe-store.ts): the key, the prompt, the parse, the packing step a pot's
// cook meal ends with, and what a save keeps.
// Run: scripts/t.sh tests/info/meals/recipe

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createFakeAppData, type FakeAppData } from "../../../support/guarded-appdata";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import {
  packStep,
  parseRecipe,
  recipeKey,
  recipePot,
  recipeRequest,
  recipeSystemPrompt,
  recipeUserText,
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
import { addDays } from "../../../../src/info/meals/plan/week";
import { MON, potWeek, profile, state } from "../fixtures/week";

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

// One meal of the pot week: Monday's dinner cooks the braised beef, the
// others eat a box of it.
function potMealView(dayIndex: number, meal: "lunch" | "dinner") {
  const day = dayViewOn(state({ plan: potWeek() }), addDays(MON, dayIndex), MON, "other")!;
  return day.meals.find((m) => m.key === meal)!;
}

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

test("the prompt names the language and forbids grams in the steps and the packing of a pot", () => {
  const prompt = recipeSystemPrompt({ effort: "simple", language: "zh-CN" });
  expect(prompt).toContain("简体中文");
  expect(prompt).toContain("Do not repeat the grams");
  expect(prompt).toContain("never write packing");
  expect(prompt).not.toContain("batch");
});

test("steps lose a leading number; a batch the model still sends is ignored", () => {
  const tally = newTally();
  const reply = 'Here: {"steps": ["1. 鸡腿切块。", "第2步：下锅煎。", " ", 3], "batch": {"servings": 3}}';
  const parsed = parseRecipe(reply, tally);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual({ steps: ["鸡腿切块。", "下锅煎。"] });
  expect(tally).toMatchObject({ seen: 4, kept: 2 });
});

test("no steps is a failure", () => {
  expect(parseRecipe('{"steps": []}').ok).toBe(false);
  expect(parseRecipe("no json here").ok).toBe(false);
});

test("the meal a pot is cooked at is told to cook the whole pot and ends with the program's packing step", () => {
  const cook = potMealView(0, "dinner");
  const req = recipeRequest(cook, profile(), "zh-CN")!;
  expect(req.pot).toMatchObject({ cooks: true, rawG: 600, count: 4, name: "卤牛腱", storage: "fresh" });
  const text = recipeUserText(req);
  expect(text).toContain("This meal cooks a pot: 卤牛腱, 600 g of raw 牛腱子（生）");
  expect(text).toContain("Stop before packing the rest");
  expect(packStep(cook.pot)).toBe(
    "剩下的连汤汁分成 3 盒，一盒一顿，盒上写好哪天哪顿：星期二午餐、星期三午餐放冷藏；星期五午餐今天就冷冻。",
  );
  setLocale("en");
  expect(packStep(cook.pot)).toBe(
    "Pack the rest with its sauce into 3 boxes, one per meal, each marked with its day and meal: " +
      "Tuesday Lunch, Wednesday Lunch in the fridge; Friday Lunch in the freezer today.",
  );
});

test("a meal that eats a box is told to reheat it, not cook it, and has no packing step", () => {
  const fridge = potMealView(1, "lunch");
  const frozen = potMealView(4, "lunch");
  expect(packStep(fridge.pot)).toBeNull();
  expect(packStep(madeMeal().pot)).toBeNull();
  const text = recipeUserText(recipeRequest(fridge, profile(), "zh-CN")!);
  expect(text).toContain("It is in the fridge.");
  expect(text).toContain("Do not cook it again");
  expect(recipeUserText(recipeRequest(frozen, profile(), "zh-CN")!)).toContain("moved from the freezer to the fridge last night");
});

test("the key carries the pot facts the steps depend on, and a meal without a pot keys as before", () => {
  const view = potMealView(1, "lunch");
  const pot = recipePot(view.pot)!;
  const k = (p: typeof pot | null) => recipeKey(view.name, view.rows, ["wok"], "zh-CN", p);
  expect(k(null)).toBe(recipeKey(view.name, view.rows, ["wok"], "zh-CN"));
  expect(k(pot)).not.toBe(k(null));
  expect(k({ ...pot, cooks: true })).not.toBe(k(pot));
  expect(k({ ...pot, storage: "freezer" })).not.toBe(k(pot));
  expect(k({ ...pot, count: 3 })).not.toBe(k(pot));
  expect(k({ ...pot, method: "红烧" })).not.toBe(k(pot));
});

const entry = (at: number, name = "x"): RecipeEntry => ({ at, name, steps: ["a"] });

test("a save merges into the file and reads back", async () => {
  await saveRecipe("k1", entry(1000, "one"), 1000, io);
  await saveRecipe("k2", entry(2000, "two"), 2000, io);
  expect((await loadRecipe("k1", io))?.name).toBe("one");
  expect((await loadRecipe("k2", io))?.steps).toEqual(["a"]);
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

test("an entry written with the model's batch still reads, without it", () => {
  const batch = { servings: 3, cook: [1], note: "", pack: "分成 3 盒。", keep: "冷藏 3 天。", reheat: "微波 2 分钟。" };
  const parsed = parseRecipeFile({ recipes: { old: { at: 1, name: "旧", steps: ["a"], batch }, bare: { at: 2, steps: ["b"], batch: null } } });
  expect(parsed!.recipes).toEqual({ old: { at: 1, name: "旧", steps: ["a"] }, bare: { at: 2, name: "", steps: ["b"] } });
});

test("an entry that does not read is skipped, not the file", () => {
  const parsed = parseRecipeFile({ recipes: { good: entry(1), bad: { at: 1, steps: [] }, worse: 3 } });
  expect(Object.keys(parsed!.recipes)).toEqual(["good"]);
  expect(parseRecipeFile([])).toBeNull();
});

test("the file merges per recipe across devices", () => {
  expect(strategyFor(MEALS_RECIPES_FILE)).toBe("records");
});
