import { describe, expect, test } from "bun:test";
import { foodById, type Food } from "../../../../src/info/meals/nutrition/foods";
import { stapleCapG } from "../../../../src/info/meals/nutrition/solve";
import type { Profile } from "../../../../src/info/meals/nutrition/targets";
import { checkDraft, DAY_PROTEIN_FLOOR, type DraftRule } from "../../../../src/info/meals/planner/checks";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { packList } from "../../../../src/info/meals/planner/packs";
import {
  breakfastUnit,
  DAY_SODIUM_MG,
  growBreakfast,
  mealStapleCapG,
  solveDraft,
  STAPLE_REFERENCE_DAY_KCAL,
} from "../../../../src/info/meals/planner/solve";
import { DAY_KCAL_FLOOR } from "../../../../src/info/meals/plan/checks";
import { goodDraft, PROFILE, START_WEEKDAY, targetsFor } from "./fixture";

const food = (id: string) => foodById(id) as Food;

/** Office workers who train, from a light 55 kg woman to an 85 kg man training five days. */
const BODIES: Record<string, Partial<Profile>> = {
  "55 kg woman, 2 days": { sex: "f", weightKg: 55, heightCm: 160, age: 28, trainingDays: [2, 5] },
  "60 kg woman, 3 days": {},
  "60 kg woman cutting": { goal: "cut" },
  "72 kg man, 3 days": { sex: "m", weightKg: 72, heightCm: 175, age: 30 },
  "72 kg man gaining": { sex: "m", weightKg: 72, heightCm: 175, age: 30, goal: "gain" },
  "72 kg man cutting": { sex: "m", weightKg: 72, heightCm: 175, age: 30, goal: "cut" },
  "85 kg man, 5 days": { sex: "m", weightKg: 85, heightCm: 182, age: 30, trainingDays: [1, 2, 3, 4, 5] },
  "85 kg man gaining, 5 days": { sex: "m", weightKg: 85, heightCm: 182, age: 30, trainingDays: [1, 2, 3, 4, 5], goal: "gain" },
};

/** The bodies whose day sodium stays within the limit on this draft; the others' saucy mains scale past it with their protein. */
const SODIUM_OK = ["55 kg woman, 2 days", "60 kg woman, 3 days", "60 kg woman cutting", "72 kg man, 3 days", "85 kg man, 5 days"];

function run(over: Partial<Profile>) {
  const profile: Profile = { ...PROFILE, ...over };
  const targets = targetsFor(profile);
  return { profile, targets, result: checkDraft(goodDraft(), { profile, targets, startWeekday: START_WEEKDAY }) };
}

const only = (rules: DraftRule[], r: ReturnType<typeof run>["result"]) => r.problems.filter((p) => rules.includes(p.rule)).map((p) => p.message);

describe("the 3-day fixture draft across bodies", () => {
  for (const [name, over] of Object.entries(BODIES)) {
    test(`${name}: every day reaches its protein and kcal`, () => {
      const { result } = run(over);
      expect(only(["protein", "kcal"], result)).toEqual([]);
      for (const d of result.plan?.days ?? []) {
        expect(d.totals.protein).toBeGreaterThanOrEqual(DAY_PROTEIN_FLOOR * d.target.protein);
        expect(d.totals.kcal).toBeGreaterThanOrEqual(DAY_KCAL_FLOOR * d.target.kcal);
      }
    });
  }

  for (const name of SODIUM_OK) {
    test(`${name}: passes every check`, () => {
      expect(run(BODIES[name]).result.problems.map((p) => p.message)).toEqual([]);
    });
  }

  test("fruit stays two to three portions and oil only tops up the fat floor", () => {
    for (const over of Object.values(BODIES)) {
      const { result } = run(over);
      expect(only(["fruit", "vegetables", "whole_grain", "red_meat"], result)).toEqual([]);
      for (const d of result.plan?.days ?? []) {
        if (d.fatBumpG > 0) {
          const withoutBump = d.totals.fat - (2 * d.fatBumpG * food("olive_oil").fat) / 100;
          expect(withoutBump).toBeLessThan(d.target.fatFloor);
        }
      }
    }
  });
});

describe("breakfast grows by whole units", () => {
  const big = run(BODIES["85 kg man, 5 days"]);
  const small = run(BODIES["55 kg woman, 2 days"]);
  const lib = planLibrary(PROFILE);
  const template = lib.dish("milk_oats_banana")?.ingredients ?? [];

  test("each line grows by its unit, to at most twice its template grams", () => {
    const grown = growBreakfast(template, big.targets[2]);
    expect(grown.map((l) => l.food)).toEqual(template.map((l) => l.food));
    grown.forEach((l, i) => {
      const was = template[i].grams;
      const unit = breakfastUnit(food(l.food));
      if (!unit) expect(l.grams).toBe(was);
      else expect(Number.isInteger((l.grams - was) / unit.grams)).toBe(true);
      expect(l.grams).toBeLessThanOrEqual(2 * was);
    });
    expect(grown.find((l) => l.food === "banana")?.grams).toBe(template.find((l) => l.food === "banana")?.grams);
    expect(grown.reduce((s, l) => s + l.grams, 0)).toBeGreaterThan(template.reduce((s, l) => s + l.grams, 0));
  });

  test("a breakfast already at its share stays as written", () => {
    const soy = lib.dish("soy_milk_maker_plain")?.ingredients ?? [];
    expect(growBreakfast(soy, small.targets[0])).toEqual(soy);
  });

  test("a salty unit is not added past the breakfast's share of the sodium limit", () => {
    const toast = lib.dish("milk_toast_boiled_egg")?.ingredients ?? [];
    const t = big.targets[1];
    const grown = growBreakfast(toast, t);
    expect(grown.find((l) => l.food === "whole_wheat_toast")?.grams).toBe(70);
    const share = (t.meals.breakfast.kcal / t.kcal) * DAY_SODIUM_MG;
    const sodium = (lines: typeof toast) => lines.reduce((s, l) => s + ((food(l.food).sodium ?? 0) * l.grams) / 100, 0);
    // The template is over its share already; only milk, no saltier per kcal than the day, was added.
    expect(sodium(toast)).toBeGreaterThan(share);
    expect(grown.find((l) => l.food === "egg")?.grams).toBe(100);
    expect(grown.find((l) => l.food === "low_fat_milk")?.grams).toBe(500);
  });
});

describe("staple caps follow the day's kcal", () => {
  test("unchanged up to the reference day, scaled above it", () => {
    for (const id of ["brown_rice_cooked", "quinoa_cooked", "potato", "multigrain_rice_raw"]) {
      expect(mealStapleCapG(food(id), STAPLE_REFERENCE_DAY_KCAL)).toBeCloseTo(stapleCapG(food(id)), 6);
      expect(mealStapleCapG(food(id), 1600)).toBeCloseTo(stapleCapG(food(id)), 6);
      expect(mealStapleCapG(food(id), 2500)).toBeCloseTo(1.25 * stapleCapG(food(id)), 6);
    }
  });
});

describe("the snack", () => {
  test("is empty on days lunch and dinner fill", () => {
    const { result } = run(BODIES["55 kg woman, 2 days"]);
    expect(result.plan?.days.map((d) => d.snack)).toEqual([[], [], []]);
  });

  test("is whole units, counted in the day and on the shopping list, and said in the notes", () => {
    const { result } = run(BODIES["72 kg man, 3 days"]);
    const day = result.plan?.days.find((d) => d.snack.length);
    expect(day).toBeDefined();
    for (const l of day?.snack ?? []) expect(["low_fat_milk", "mixed_nuts"]).toContain(l.food);
    expect(day?.snack.map((l) => l.grams)).toEqual(day?.snack.map((l) => (l.food === "low_fat_milk" ? 250 : 25)));
    expect(result.shopping.some((s) => s.food === "low_fat_milk")).toBe(true);
    expect(result.notes.some((n) => n.startsWith(`Added a snack`) && n.includes(`Day ${day?.day}`))).toBe(true);
  });

  test("skips foods the user cannot have", () => {
    const over = { ...BODIES["72 kg man, 3 days"], unavailable: ["mixed_nuts"] };
    const { profile, targets } = run(over);
    const plan = solveDraft(goodDraft(), planLibrary(profile), targets);
    const foods = plan.days.flatMap((d) => d.snack.map((l) => l.food));
    expect(foods).toContain("almonds");
    expect(foods).not.toContain("mixed_nuts");
    expect(packList(plan, goodDraft()).some((s) => s.food === "almonds")).toBe(true);
  });
});
