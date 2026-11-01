// The household's cooking oil (docs/671 菜库): the profile field, the
// update tool's patch and its refusals, the dish library's substitution of
// cooking-fat lines, and a real batch plan (fixtures/batch-plan.json) solved,
// stored and bought with it.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { houseOil, oilRefused, withHouseOil } from "../../../src/info/meals/dishes/house-oil";
import { checkDish } from "../../../src/info/meals/dishes/check";
import { SEED_DISHES } from "../../../src/info/meals/dishes/seed";
import { referenceServing, totals } from "../../../src/info/meals/dishes/serving";
import type { Dish } from "../../../src/info/meals/dishes/types";
import { foodById } from "../../../src/info/meals/nutrition/foods";
import type { Profile } from "../../../src/info/meals/nutrition/targets";
import { planLibrary } from "../../../src/info/meals/planner/library";
import { plannerShoppingList } from "../../../src/info/meals/planner/trip";
import { checkPlannerRecord, resolvePlannerWeek } from "../../../src/info/meals/planner/to-week";
import { targetsOf } from "../../../src/info/meals/plan/solve-week";
import { parseMealsFile, validateProfile } from "../../../src/info/meals/plan/store";
import type { MealsState } from "../../../src/info/meals/plan/types";
import { readCharter } from "../../../src/info/meals/read";
import { cookingOilWords, habitsLine, patchProfile, readCookingOil } from "../../../src/info/meals/tools";

function raw(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dir, "fixtures/batch-plan.json"), "utf8"));
}

function fixture(): MealsState {
  const state = parseMealsFile(raw());
  if (!state) throw new Error("fixture does not parse");
  return state;
}

function profileOf(state: MealsState, patch: Partial<Profile> = {}): Profile {
  const p = state.charter?.profile;
  if (!p) throw new Error("fixture has no profile");
  return { ...p, ...patch };
}

const STORED = new Map(SEED_DISHES.map((d) => [d.id, d]));
const cookingLines = (d: Dish) => [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)].filter((l) => l.cookingOil);

test("a stored profile without the field loads unchanged; a bad value is dropped", () => {
  const stored = (raw().charter as { profile: Record<string, unknown> }).profile;
  const loaded = validateProfile(stored);
  expect(loaded).not.toBeNull();
  expect("cookingOil" in (loaded as object)).toBe(false);
  const { minutesPerMeal: _gone, ...rest } = stored;
  expect(loaded).toEqual({ ...rest, effort: "simple" } as unknown as Profile);
  expect(validateProfile({ ...stored, cookingOil: "lard" })?.cookingOil).toBeUndefined();
  expect(validateProfile({ ...stored, cookingOil: "peanut_oil" })?.cookingOil).toBe("peanut_oil");
  expect(fixture().charter?.profile.cookingOil).toBeUndefined();
});

test("readCookingOil takes an id or a name of a plain cooking oil, and none", () => {
  expect(readCookingOil("peanut_oil")).toBe("peanut_oil");
  expect(readCookingOil("花生油")).toBe("peanut_oil");
  expect(readCookingOil("菜籽油")).toBe("canola_oil");
  expect(readCookingOil("none")).toBe("none");
  expect(readCookingOil("sesame_oil")).toBeNull();
  expect(readCookingOil("lard")).toBeNull();
});

test("patchProfile sets, replaces and clears the cooking oil", () => {
  const p = profileOf(fixture());
  const set = patchProfile(p, { cookingOil: "花生油" });
  expect(set?.cookingOil).toBe("peanut_oil");
  expect(patchProfile(set as Profile, { cookingOil: "olive_oil" })?.cookingOil).toBe("olive_oil");
  const cleared = patchProfile(set as Profile, { cookingOil: "none" });
  expect(cleared).not.toBeNull();
  expect("cookingOil" in (cleared as object)).toBe(false);
  expect(patchProfile(p, { cookingOil: "lard" })).toBeNull();
  expect(cookingOilWords("peanut_oil", p, set).changed).toContain("peanut_oil");
  expect(cookingOilWords("lard", p, null).refused).toContain("not recorded");
});

test("peanut oil is refused when they dislike peanuts or nuts, and dropped when such a dislike comes later", () => {
  for (const dislike of ["花生", "peanuts", "nuts"]) {
    const p = profileOf(fixture(), { dislikes: [dislike] });
    expect(oilRefused("peanut_oil", p.dislikes)).toBe(true);
    expect(patchProfile(p, { cookingOil: "peanut_oil" })).toBeNull();
    expect(cookingOilWords("peanut_oil", p, null).refused).toContain("not set as their cooking oil");
  }
  expect(oilRefused("canola_oil", ["nuts"])).toBe(false);
  const held = profileOf(fixture(), { cookingOil: "peanut_oil" });
  const next = patchProfile(held, { dislikes: [...held.dislikes, "花生"] });
  expect(next?.cookingOil).toBeUndefined();
  expect(cookingOilWords(undefined, held, next).changed).toContain("cleared");
  // Stored with a conflicting dislike all the same: the planner leaves every dish's own oil.
  expect(houseOil({ ...held, dislikes: ["nuts"] })).toBeNull();
  const lib = planLibrary({ ...held, dislikes: ["nuts"] });
  expect(lib.houseOil).toBeUndefined();
  expect(lib.dish("green_pepper_pork_strips")?.ingredients.some((l) => l.food === "canola_oil")).toBe(true);
});

test("the guidance and the charter read show the field", () => {
  const p = profileOf(fixture(), { cookingOil: "peanut_oil" });
  expect(habitsLine(p)).toContain("Cooking oil: 花生油 (peanut_oil)");
  expect(habitsLine(profileOf(fixture()))).toContain("Cooking oil: not said");
  const state = fixture();
  if (state.charter) state.charter.profile = p;
  expect(readCharter(state, "other").cookingOil).toEqual({ foodId: "peanut_oil", name: "花生油", inUse: true });
});

test("only cooking-fat lines of the plain oils are flagged, and every seed dish still passes its check", () => {
  for (const d of SEED_DISHES) {
    for (const l of cookingLines(d)) expect(["peanut_oil", "canola_oil", "olive_oil"]).toContain(l.food);
  }
  expect(SEED_DISHES.flatMap((d) => d.ingredients).filter((l) => l.food === "canola_oil" && !l.cookingOil)).toEqual([]);
  const bad = { ...(STORED.get("tuna_cucumber_bowl") as Dish) };
  bad.ingredients = bad.ingredients.map((l) => (l.food === "cucumber" ? { ...l, cookingOil: true } : l));
  const r = checkDish(bad);
  expect(r.ok ? [] : r.failures.map((f) => f.rule)).toContain("cooking_oil");
});

test("the library swaps the household oil into cooking-fat lines only", () => {
  const lib = planLibrary(profileOf(fixture(), { cookingOil: "peanut_oil" }));
  expect(lib.houseOil).toBe("peanut_oil");
  const oils = (id: string) => lib.dish(id)?.ingredients.filter((l) => l.role === "oil").map((l) => l.food);
  expect(oils("kung_pao_chicken")).toEqual(["peanut_oil"]);
  expect(oils("tomato_braised_cod")).toEqual(["peanut_oil"]);
  expect(oils("tuna_cucumber_bowl")).toEqual(["olive_oil"]);
  expect(oils("greek_cucumber_tomato_salad")).toEqual(["olive_oil"]);
  expect(oils("steamed_pumpkin_soy")).toEqual(["sesame_oil"]);
  // Without the field, today's behaviour.
  const plain = planLibrary(profileOf(fixture()));
  expect(plain.houseOil).toBeUndefined();
  expect(plain.dish("kung_pao_chicken")?.ingredients.some((l) => l.food === "canola_oil")).toBe(true);
  expect(withHouseOil(STORED.get("kung_pao_chicken") as Dish, null)).toBe(STORED.get("kung_pao_chicken") as Dish);
});

test("a dish's nutrition is the substituted oil's own", () => {
  const dish = STORED.get("tomato_braised_cod") as Dish;
  const fat = (oil: "peanut_oil" | "olive_oil") => {
    const d = planLibrary(profileOf(fixture(), { cookingOil: oil })).dish(dish.id) as Dish;
    const s = referenceServing(d);
    if (!s) throw new Error("no serving");
    const g = s.ingredients.find((l) => l.food === oil)?.grams ?? 0;
    return { total: totals(s.ingredients).fat, g };
  };
  const olive = fat("olive_oil");
  const peanut = fat("peanut_oil");
  expect(peanut.g).toBeCloseTo(olive.g, 6);
  const per = ((foodById("olive_oil")?.fat ?? 0) - (foodById("peanut_oil")?.fat ?? 0)) / 100;
  expect(olive.total - peanut.total).toBeCloseTo(olive.g * per, 6);
});

test("a real batch plan solved with peanut oil has no canola or olive oil in its oil-agnostic dishes, and buys peanut oil", () => {
  const state = fixture();
  const plan = state.plan;
  if (!plan || !state.charter) throw new Error("fixture has no plan");
  const profile = profileOf(state, { cookingOil: "peanut_oil" });
  const targets = targetsOf({ ...state.charter, profile }, "other");
  if (!targets) throw new Error("no targets");
  const check = checkPlannerRecord(plan, profile, targets);
  const solved = check?.result.plan;
  if (!check || !solved) throw new Error("the fixture plan does not solve");

  const lines = solved.days.flatMap((d) => [...Object.values(d.meals).flatMap((m) => m.lines), ...d.snack]);
  const flagged = new Set(SEED_DISHES.filter((d) => cookingLines(d).length).map((d) => d.id));
  const agnostic = lines.filter((l) => (l.dish && flagged.has(l.dish)) || l.source === "oil");
  expect(agnostic.some((l) => l.food === "peanut_oil")).toBe(true);
  for (const l of agnostic.filter((l) => l.role === "oil" && l.food !== "sesame_oil")) expect(l.food).toBe("peanut_oil");
  expect(lines.some((l) => l.food === "canola_oil")).toBe(false);
  for (const b of solved.batches) {
    if (flagged.has(b.dish)) expect(b.lines.filter((l) => l.role === "oil").map((l) => l.food)).not.toContain("olive_oil");
  }

  const week = resolvePlannerWeek(plan, profile, targets);
  const stored = week.days.flatMap((d) => [d.breakfast, d.lunch, d.dinner, d.snack]).filter((m) => m.mode === "make");
  const used = new Set(stored.flatMap((m) => (m.solved ?? []).map((s) => s.foodId)));
  expect(used.has("peanut_oil")).toBe(true);
  expect(used.has("canola_oil")).toBe(false);

  const shopping = plannerShoppingList(solved, check.draft, week, profile.people);
  const ids = shopping.map((i) => i.foodId);
  expect(ids).toContain("peanut_oil");
  expect(ids).not.toContain("canola_oil");
});
