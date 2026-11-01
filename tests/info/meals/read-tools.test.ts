// The meals read tools (src/info/meals/read.ts, read-tools.ts) over a plan
// trimmed from a real batch-cooking plan (fixtures/batch-plan.json: two pots,
// chicken over three meals and beef over two, a prep session on Day 1). A
// script must be able to get the numbers the screen shows out of them.
// Run: scripts/t.sh tests/info/meals/read-tools.test.ts

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMealsFile } from "../../../src/info/meals/plan/store";
import { EMPTY_MEALS, type MealsState } from "../../../src/info/meals/plan/types";
import { readCharter, readFoods, readPlan, readPrep, readRecipes, readShopping, type PlanRead, type PrepRead, type ShoppingRead } from "../../../src/info/meals/read";
import { buildMealsReadTools, MEALS_READ_TOOLS } from "../../../src/info/meals/read-tools";
import type { MealsRecipes } from "../../../src/info/meals/recipe/recipe-store";
import { buildMealsCatalogTools } from "../../../src/info/meals/tools";

const TODAY = "2026-11-01";

function fixture(): MealsState {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/batch-plan.json"), "utf8"));
  const state = parseMealsFile(raw);
  if (!state) throw new Error("fixture does not parse");
  return state;
}

function tools(state: MealsState, recipes: MealsRecipes | null = null) {
  const built = buildMealsReadTools({
    state: async () => state,
    today: () => TODAY,
    region: () => "other",
    recipes: async () => recipes,
    recipeLanguage: async () => "zh-CN",
  });
  return new Map(built.map((t) => [t.name, t]));
}

async function call<T>(state: MealsState, name: string, args: Record<string, unknown> = {}, recipes: MealsRecipes | null = null): Promise<T> {
  const tool = tools(state, recipes).get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return JSON.parse(String(await tool.execute(args))) as T;
}

test("every read tool is a safe read, and the meals desk mounts them all", () => {
  const built = buildMealsReadTools({ state: async () => EMPTY_MEALS, today: () => TODAY, region: () => "other" });
  expect(built.map((t) => t.name)).toEqual([...MEALS_READ_TOOLS]);
  for (const t of built) {
    expect(t.effect).toBe("read");
    expect(t.replay).toBe("safe");
    expect(t.gate).toBeUndefined();
  }
  const desk = buildMealsCatalogTools({ threadId: "meals", ports: {} } as never).map((t) => t.name);
  for (const name of MEALS_READ_TOOLS) expect(desk).toContain(name);
});

test("the raw meat across the pots: the prep tool adds it up, and the saved plan agrees", async () => {
  const prep = await call<PrepRead>(fixture(), "meals_read_prep");
  expect(prep.found).toBe(true);
  expect(prep.pots?.map((p) => [p.id, p.meals.length])).toEqual([
    ["chicken", 3],
    ["beef", 2],
  ]);
  const total = (id: string) => prep.potTotals?.find((r) => r.foodId === id)?.grams;
  expect(total("chicken_breast")).toBe(500);
  expect(total("beef_shank_raw")).toBe(335);
  expect(prep.pots?.[0]?.meals[0]).toEqual({ day: 1, date: "2026-10-31", meal: "lunch" });
  expect(prep.session).toMatchObject({ id: "prep", day: 1, date: "2026-10-31", part: "morning" });
  expect(prep.dayDates?.["0"]).toBe("2026-10-30");

  // The same answer from the saved grams: each pot meal's share of the protein, added up.
  const plan = await call<PlanRead>(fixture(), "meals_read_plan");
  const fromPlan = (id: string) =>
    plan.days.flatMap((d) => d.meals).filter((m) => m.pot).flatMap((m) => m.foods).filter((f) => f.foodId === id).reduce((s, f) => s + f.grams, 0);
  expect(Math.abs(fromPlan("chicken_breast") - 500)).toBeLessThanOrEqual(3);
  expect(Math.abs(fromPlan("beef_shank_raw") - 335)).toBeLessThanOrEqual(3);
});

test("the plan reads each meal's foods, nutrition and pot, and filters by date", async () => {
  const plan = await call<PlanRead>(fixture(), "meals_read_plan", { from: "2026-11-02", to: "2026-11-02" });
  expect(plan.planned).toBe(true);
  expect(plan.plannerStart).toBe("2026-10-31");
  expect(plan.days.map((d) => d.date)).toEqual(["2026-11-02"]);
  const lunch = plan.days[0]?.meals.find((m) => m.meal === "lunch");
  expect(lunch?.pot).toBe("chicken");
  const chicken = lunch?.foods.find((f) => f.foodId === "chicken_breast");
  expect(chicken?.grams).toBe(167);
  expect(chicken?.nutrition.kcal).toBeGreaterThan(0);
  expect(lunch?.totals?.kcal).toBeCloseTo(lunch!.foods.reduce((s, f) => s + f.nutrition.kcal, 0), 0);
  expect(plan.days[0]?.targets?.kcal).toBeGreaterThan(0);
  const dinner = plan.days[0]?.meals.find((m) => m.meal === "dinner");
  expect(dinner?.pot).toBeNull();

  expect(await call<unknown>(fixture(), "meals_read_plan", { from: "Nov 2" })).toEqual({ error: "from and to are local dates, YYYY-MM-DD." });
});

test("the shopping list gives the needed grams apart from the pack bought, with the reader's flags", async () => {
  const list = await call<ShoppingRead>(fixture(), "meals_read_shopping");
  const line = (id: string) => list.lines.find((l) => l.foodId === id);
  expect(line("beef_shank_raw")).toMatchObject({ neededG: 335, qty: "1 盒（约 600 g）", neededBy: "2026-10-31", source: "plan", dropped: false });
  expect(line("chicken_breast")).toMatchObject({ neededG: 500, qty: "1 盒（约 500 g）" });
  expect(line("orange")?.dropped).toBe(true);
  expect(line("brown_rice_cooked")).toMatchObject({ onHand: true, qty: "家里常备" });
  expect(line("cod")?.boughtFrozen).toBe(true);
  expect(list.doneOn).toBeNull();
});

test("the recipes come back by the key the recipe page stores them under", async () => {
  const state = fixture();
  const opts = { today: TODAY, region: "other" as const, language: "zh-CN" as const, from: "2026-11-02" };
  const first = readRecipes(state, { ...opts, recipes: null });
  expect(first.every((r) => r.steps === null)).toBe(true);
  const dinner = first.find((r) => r.meal === "dinner");
  expect(dinner?.key).toBeTruthy();
  const recipes: MealsRecipes = { recipes: { [dinner!.key!]: { at: 1, name: dinner!.name, steps: ["Thaw the cod.", "Simmer."] } } };
  const again = await call<ReturnType<typeof readRecipes>>(state, "meals_read_recipes", { from: "2026-11-02", meal: "dinner" }, recipes);
  expect(again).toEqual([{ ...dinner!, steps: ["Thaw the cod.", "Simmer."] }]);
});

test("the prep steps written for an older version of the session are returned and marked so", () => {
  const state = fixture();
  const step = { id: "1", text: "Brown the beef.", device: "stove" as const, pot: "beef", active: 5, wait: 0, after: [] };
  const name = "墨西哥番茄手撕鸡 + 干香料炖牛肉（rendang 风味）";
  const recipes: MealsRecipes = { recipes: {}, preps: { old: { kind: "prep", at: 1, name, session: "prep", steps: [step] } } };
  const prep = readPrep(state, { today: TODAY, region: "other", language: "zh-CN", recipes });
  expect(prep.steps).toEqual([step]);
  expect(prep.stepsCurrent).toBe(false);
  expect(readPrep(state, { today: TODAY, region: "other", language: "zh-CN", recipes: null }).steps).toBeNull();
});

test("the charter, the food table and an empty state", () => {
  const state = fixture();
  const charter = readCharter(state, "other");
  expect(charter.found).toBe(true);
  expect(charter.profile?.people).toBe(1);
  expect(charter.dislikes.find((d) => d.word === "broccoli")?.foods).toContain("broccoli");
  expect(charter.targets?.training.kcal).toBeGreaterThan(0);

  const used = readFoods(state).map((f) => f.id);
  expect(used).toContain("chicken_breast");
  expect(used).toContain("beef_shank_raw");
  const chicken = readFoods(state, { ids: ["chicken_breast"] });
  expect(chicken).toHaveLength(1);
  expect(chicken[0]?.per100g.protein).toBeGreaterThan(20);
  expect(chicken[0]?.pack?.grams).toBe(500);
  expect(readFoods(state, { query: "beef_shank" }).map((f) => f.id)).toContain("beef_shank_raw");

  expect(readPlan(EMPTY_MEALS, { today: TODAY, region: "other" })).toMatchObject({ planned: false, days: [] });
  expect(readPrep(EMPTY_MEALS, { today: TODAY, region: "other", language: "en" }).found).toBe(false);
  expect(readShopping(EMPTY_MEALS).lines).toEqual([]);
  expect(readCharter(EMPTY_MEALS, "other").found).toBe(false);
});
