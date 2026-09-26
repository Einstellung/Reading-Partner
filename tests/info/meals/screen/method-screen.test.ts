// The "Method & sources" screen (src/info/meals/screen/method-screen.ts): every
// formula worked through with the reader's own numbers. The reader here is the
// prototype's example user.
// Run: scripts/t.sh tests/info/meals/screen/method-screen.test.ts

import { expect, test } from "bun:test";
import { foodTableRows, linkSegments, methodSections } from "../../../../src/info/meals/screen/method-screen";
import { FOODS } from "../../../../src/info/meals/nutrition/foods";
import { computeTargets } from "../../../../src/info/meals/nutrition/targets";
import { profile } from "../fixtures/week";

const EXAMPLE = profile({
  sex: "m",
  age: 30,
  heightCm: 175,
  weightKg: 72,
  bodyFatPct: 18,
  trainingDays: [1, 3, 5],
  trainTime: "evening",
  work: "sit",
  goal: "cut",
});

function sections() {
  return methodSections(computeTargets(EXAMPLE, "CN"), EXAMPLE);
}

function yours(n: number): string {
  return sections().find((s) => s.n === n)!.yours;
}

test("eight sections, in order", () => {
  expect(sections().map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

test("basal rate: body fat known, so Cunningham on fat-free mass", () => {
  expect(yours(1)).toContain("FFM = 72 × (1 − 0.18) = 59.0 kg");
  expect(yours(1)).toContain("BMR = 22 × 59.0 + 500 = 1799 kcal/day");
  expect(yours(1)).toContain("Mifflin-St Jeor would give 1669");
});

test("activity and calories: 2450 on a training day, 2150 on a rest day", () => {
  expect(yours(2)).toContain("Training day PAL 1.60");
  expect(yours(2)).toContain("rest day 1.40");
  const three = yours(3);
  expect(three).toContain("BMI 23.5 is under 24");
  expect(three).toContain("0.005 × 72 × 7700 ÷ 7 = 396 kcal/day");
  expect(three).toContain("→ 2450");
  expect(three).toContain("→ 2150");
});

test("protein: 2.3 g per kg of fat-free mass, 135 g every day", () => {
  expect(yours(4)).toContain("2.3 g × FFM 59.0 kg = 136 g");
  expect(yours(4)).toContain("135 g/day on every day");
});

test("the meal split adds each day back up, and protein is split three ways plus the snack", () => {
  const t = computeTargets(EXAMPLE, "CN");
  const sum = (d: typeof t.training) => d.meals.breakfast.kcal + d.meals.lunch.kcal + d.meals.dinner.kcal + d.meals.snack.kcal;
  expect(sum(t.training)).toBeCloseTo(2450, 6);
  expect(sum(t.rest)).toBeCloseTo(2150, 6);
  // Evening training: dinner is the post-workout meal and carries more.
  expect(yours(6)).toContain(`dinner ${Math.round(t.training.meals.dinner.kcal)}`);
  expect(t.training.meals.dinner.kcal).toBeGreaterThan(2450 * 0.3);
  expect(yours(6)).toContain("Protein: 42 g at each main meal, 10 g at the snack.");
});

test("the CN reader gets the Chinese BMI cut-offs cited", () => {
  const three = sections().find((s) => s.n === 3)!;
  expect(three.sources.map((s) => s.text).join("")).toContain("BMI cut-offs 24 / 28");
  const other = methodSections(computeTargets(EXAMPLE, "other"), EXAMPLE).find((s) => s.n === 3)!;
  expect(other.sources.map((s) => s.text).join("")).toContain("BMI cut-offs 25 / 30");
});

test("a weight change is told in conversation; nothing claims the plan adjusts itself from a trend", () => {
  const eight = sections().find((s) => s.n === 8)!;
  expect(eight.formula).toContain("in the conversation");
  expect(eight.formula).toContain("does not adjust itself from a weight trend");
  expect(eight.yours).toBe("Current weight: 72 kg.");
  const all = sections()
    .flatMap((s) => [s.title, s.formula, s.yours, ...s.sources.map((x) => x.text)])
    .join("\n");
  expect(all).not.toMatch(/automatic|auto-adjust|adjusts (itself|automatically)|from your weight trend/i);
});

test("links in a source sentence become their own segments", () => {
  expect(linkSegments("See [PMC1](https://x/1) and more.")).toEqual([
    { text: "See " },
    { text: "PMC1", url: "https://x/1" },
    { text: " and more." },
  ]);
});

test("the food table lists every food with where its numbers come from", () => {
  const rows = foodTableRows();
  expect(rows).toHaveLength(FOODS.length);
  expect(rows.every((r) => r.source.length > 0)).toBe(true);
});
