// The gram solver for a drafted plan (docs/671 克数).
// Run: scripts/t.sh tests/info/meals/planner/solve.test.ts

import { describe, expect, test } from "bun:test";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import type { Profile } from "../../../../src/info/meals/nutrition/targets";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { mealStapleCapG, solveDraft, type PlanLine, type SolvedPlan } from "../../../../src/info/meals/planner/solve";
import { goodDraft, PROFILE, targetsFor } from "./fixture";

function solve(profile: Profile = PROFILE): SolvedPlan {
  return solveDraft(goodDraft(), planLibrary(profile), targetsFor(profile));
}

/** The main lines of the meals a pot feeds, in the batch's meal order. */
function potMeals(plan: SolvedPlan, batchId = "chili"): PlanLine[][] {
  const batch = plan.batches.find((b) => b.id === batchId)!;
  return batch.meals.map((m) => plan.days[m.day - 1].meals[m.slot].lines.filter((l) => l.source === "main"));
}

describe("a pot", () => {
  test("its meals share one scale", () => {
    const plan = solve();
    const [first, second] = potMeals(plan);
    expect(first.length).toBeGreaterThan(0);
    expect(first.map((l) => [l.food, l.grams])).toEqual(second.map((l) => [l.food, l.grams]));
  });

  test("even when the days it feeds would each want another scale", () => {
    // The same dish cooked fresh at those two meals scales per day, because
    // the two days' breakfasts carry different protein ...
    const fresh = goodDraft();
    fresh.days[0].dinner.main = { dish: "chicken_bean_chili", staple: "brown_rice" };
    fresh.days[1].lunch.main = { dish: "chicken_bean_chili", staple: "brown_rice" };
    fresh.batches = [];
    fresh.sessions = [];
    const apart = solveDraft(fresh, planLibrary(PROFILE), targetsFor());
    const protein = (p: SolvedPlan, day: number, slot: "lunch" | "dinner") =>
      p.days[day - 1].meals[slot].lines.find((l) => l.source === "main" && l.role === "protein")!.grams;
    expect(protein(apart, 1, "dinner")).not.toBe(protein(apart, 2, "lunch"));
    // ... and a pot takes the mean of them for both.
    const pot = solve();
    expect(protein(pot, 1, "dinner")).toBe(protein(pot, 2, "lunch"));
    expect(protein(pot, 1, "dinner")).toBeCloseTo((protein(apart, 1, "dinner") + protein(apart, 2, "lunch")) / 2, 0);
  });

  test("its lines are the sum of its meals' main lines", () => {
    const plan = solve();
    const batch = plan.batches[0];
    const meals = potMeals(plan).flat();
    expect(batch.lines.length).toBeGreaterThan(0);
    for (const line of batch.lines) {
      const sum = meals.filter((l) => l.food === line.food && l.role === line.role).reduce((s, l) => s + l.grams, 0);
      expect(line.grams, line.food).toBeCloseTo(sum, 0);
    }
    // And nothing a meal eats from the pot is left out of it.
    const foods = new Set(meals.map((l) => `${l.food}/${l.role}`));
    expect(new Set(batch.lines.map((l) => `${l.food}/${l.role}`))).toEqual(foods);
  });

  test("keeps the draft's session and meals", () => {
    const plan = solve();
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toMatchObject({
      id: "chili",
      dish: "chicken_bean_chili",
      session: "s1",
      meals: [
        { day: 1, slot: "dinner" },
        { day: 2, slot: "lunch" },
      ],
    });
  });

  test("a protein line never passes its food's maximum per meal", () => {
    const plan = solve({ ...PROFILE, goal: "gain", weightKg: 130, sex: "m" });
    for (const meal of potMeals(plan)) {
      for (const l of meal.filter((x) => x.role === "protein")) {
        expect(l.grams, l.food).toBeLessThanOrEqual(foodById(l.food)!.maxG + 0.05);
      }
    }
  });
});

describe("staples", () => {
  const profiles: [string, Profile][] = [
    ["steady", PROFILE],
    ["gain, heavy", { ...PROFILE, goal: "gain", weightKg: 110, sex: "m" }],
    ["cut, light", { ...PROFILE, goal: "cut", weightKg: 45 }],
  ];

  for (const [name, profile] of profiles) {
    test(`stay within their bounds (${name})`, () => {
      const plan = solve(profile);
      let seen = 0;
      for (const d of plan.days) {
        for (const slot of ["lunch", "dinner"] as const) {
          for (const l of d.meals[slot].lines.filter((x) => x.source === "staple" && x.role === "staple")) {
            const food = foodById(l.food);
            if (!food) continue;
            seen++;
            expect(l.grams, `${l.food} on day ${d.day} ${slot}`).toBeGreaterThanOrEqual(food.minG - 0.05);
            expect(l.grams, `${l.food} on day ${d.day} ${slot}`).toBeLessThanOrEqual(
              mealStapleCapG(food, d.target.kcal) + 0.05,
            );
          }
        }
      }
      expect(seen).toBeGreaterThan(0);
    });
  }

  test("every lunch and dinner has one, and breakfast has none added", () => {
    const plan = solve();
    for (const d of plan.days) {
      for (const slot of ["lunch", "dinner"] as const) {
        expect(d.meals[slot].lines.some((l) => l.source === "staple"), `day ${d.day} ${slot}`).toBe(true);
      }
      expect(d.meals.breakfast.lines.some((l) => l.source === "staple")).toBe(false);
    }
  });
});

describe("the day", () => {
  test("totals add up the meals' lines, fruit and snack included", () => {
    const plan = solve();
    for (const d of plan.days) {
      const all = [d.meals.breakfast, d.meals.lunch, d.meals.dinner]
        .flatMap((m) => m.lines)
        .concat(d.fruit, d.snack);
      const kcal = all.reduce((s, l) => s + (foodById(l.food)!.kcal * l.grams) / 100, 0);
      expect(d.totals.kcal).toBeCloseTo(kcal, 3);
    }
  });

  test("solving is deterministic and leaves the draft alone", () => {
    const draft = goodDraft();
    const lib = planLibrary(PROFILE);
    const a = solveDraft(draft, lib, targetsFor());
    const b = solveDraft(draft, lib, targetsFor());
    expect(a).toEqual(b);
    expect(draft).toEqual(goodDraft());
  });
});
