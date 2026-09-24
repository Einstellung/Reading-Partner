import { describe, expect, test } from "bun:test";
import {
  computeTargets,
  dayPlan,
  mealTargets,
  targetsForWeekday,
  type Profile,
} from "../../../../src/info/meals/nutrition/targets";

// The prototype's example user.
const EXAMPLE: Profile = {
  consent: "health",
  goal: "cut",
  sex: "m",
  age: 30,
  heightCm: 175,
  weightKg: 72,
  bodyFatPct: 18,
  trainingDays: [1, 3, 5],
  trainTime: "evening",
  work: "sit",
  minutesPerMeal: 10,
  people: 1,
  shops: [],
  kitchen: [],
  dislikes: [],
};

const withP = (p: Partial<Profile>): Profile => ({ ...EXAMPLE, ...p });

describe("computeTargets", () => {
  test("the prototype's example user: 2450 / 2150 kcal, 135 g protein", () => {
    const t = computeTargets(EXAMPLE, "CN");
    expect(t.bmrFormula).toBe("cunningham");
    expect(t.ffm).toBeCloseTo(59.04, 2);
    expect(t.bmr).toBeCloseTo(1798.88, 2);
    expect(t.palTraining).toBeCloseTo(1.6, 10);
    expect(t.palRest).toBeCloseTo(1.4, 10);
    expect(t.palAverage).toBeCloseTo(10.4 / 7, 10);
    expect(t.cutRule).toBe("weight-percent");
    expect(t.deficit).toBeCloseTo(396, 0);
    expect(t.training.kcal).toBe(2450);
    expect(t.rest.kcal).toBe(2150);
    expect(t.protein).toBe(135);
    expect(t.training.protein).toBe(135);
    expect(t.rest.protein).toBe(135);
    expect(t.proteinRule).toEqual({ kind: "ffm", perKg: 2.3, ffmKg: t.ffm as number });
    expect(t.training.fat).toBe(70);
    expect(t.training.carbs).toBe(320);
    expect(t.rest.fat).toBe(60);
    expect(t.rest.carbs).toBe(270);
    expect(t.weightChangeKgPerWeek).toBeLessThan(0);
  });

  test("the research doc's worked example", () => {
    // 70 kg, 20% body fat. Every intermediate matches the doc; the training day
    // comes out at 2350 rather than the doc's 2400 because the day targets are
    // the weekly target scaled by PAL (the prototype's split), not TDEE minus a
    // flat deficit.
    const t = computeTargets(withP({ weightKg: 70, bodyFatPct: 20 }), "CN");
    expect(t.ffm).toBeCloseTo(56, 6);
    expect(Math.round(t.bmr)).toBe(1732);
    expect(Math.round(t.tdeeRest)).toBe(2425);
    expect(Math.round(t.tdeeTraining)).toBe(2771);
    expect(t.bmi).toBeCloseTo(22.9, 1);
    expect(Math.round(t.deficit)).toBe(385);
    expect(t.rest.kcal).toBe(2050);
    expect(t.training.kcal).toBe(2350);
    expect(t.protein).toBe(130);
  });

  test("Mifflin-St Jeor without body fat, and with body fat out of range", () => {
    const mifflinMale = 10 * 72 + 6.25 * 175 - 5 * 30 + 5;
    for (const p of [withP({ bodyFatPct: undefined }), withP({ bodyFatPct: 50 })]) {
      const t = computeTargets(p, "CN");
      expect(t.bmrFormula).toBe("mifflin");
      expect(t.ffm).toBeNull();
      expect(t.bmr).toBeCloseTo(mifflinMale, 6);
      // Cutting and training but no FFM: 1.8 g/kg.
      expect(t.proteinRule).toEqual({ kind: "weight", perKg: 1.8, refWeightKg: 72, usesReferenceWeight: false });
      expect(t.protein).toBe(130);
    }
    const woman = computeTargets(withP({ sex: "f", bodyFatPct: 8 }), "CN");
    expect(woman.bmrFormula).toBe("mifflin");
    expect(woman.bmr).toBeCloseTo(10 * 72 + 6.25 * 175 - 5 * 30 - 161, 6);
  });

  test("overweight cut takes 85% and protein on the reference weight; cut points follow the region", () => {
    const p = withP({ weightKg: 76, bodyFatPct: undefined }); // BMI 24.8
    const cn = computeTargets(p, "CN");
    expect(cn.bmiClass).toBe("overweight");
    expect(cn.cutRule).toBe("overweight-85");
    expect(cn.weeklyKcal).toBeCloseTo(cn.tdeeAverage * 0.85, 6);
    expect(cn.proteinRule).toMatchObject({ kind: "weight", perKg: 1.8, usesReferenceWeight: true });
    expect((cn.proteinRule as { refWeightKg: number }).refWeightKg).toBeCloseTo(24 * 1.75 ** 2, 6);
    expect(cn.protein).toBe(130); // 1.8 × 73.5 = 132.3

    const other = computeTargets(p, "other");
    expect(other.bmiClass).toBe("normal");
    expect(other.cutRule).toBe("weight-percent");
    expect(other.fatDefaultPct).toBe(0.3);
    expect(other.rest.fat).toBeGreaterThan(cn.rest.fat);
  });

  test("obese cut takes 80%", () => {
    const t = computeTargets(withP({ weightKg: 95, heightCm: 170, bodyFatPct: undefined }), "CN");
    expect(t.bmiClass).toBe("obese");
    expect(t.cutRule).toBe("obese-80");
    expect(t.weeklyKcal).toBeCloseTo(t.tdeeAverage * 0.8, 6);
  });

  test("the cut never goes under max(BMR, 1000 women)", () => {
    const t = computeTargets(
      withP({ sex: "f", age: 70, weightKg: 38, heightCm: 150, bodyFatPct: undefined, trainingDays: [] }),
      "CN",
    );
    expect(t.kcalFloor).toBe(1000);
    expect(t.weeklyKcal).toBeLessThan(1000);
    expect(t.rest.kcal).toBe(1000);
  });

  test("gain: weekly average × 1.10, split by PAL, carbs at least 3 g/kg", () => {
    const t = computeTargets(withP({ goal: "gain", bodyFatPct: undefined }), "CN");
    expect(t.weeklyKcal).toBeCloseTo(t.tdeeAverage * 1.1, 6);
    expect(t.training.kcal).toBe(Math.round((t.weeklyKcal * 1.6) / t.palAverage / 50) * 50);
    expect(t.rest.kcal).toBe(Math.round((t.weeklyKcal * 1.4) / t.palAverage / 50) * 50);
    expect(t.training.kcal).toBeGreaterThan(t.rest.kcal);
    expect(t.training.carbFloor).toBe(216);
    expect(t.rest.carbs).toBeGreaterThanOrEqual(216);
    expect(t.protein).toBe(130); // 1.8 × 72
    expect(t.weightChangeKgPerWeek).toBeGreaterThan(0);
  });

  test("steady: each day at its own TDEE", () => {
    const t = computeTargets(withP({ goal: "steady" }), "CN");
    expect(t.training.kcal).toBe(Math.round(t.tdeeTraining / 50) * 50);
    expect(t.rest.kcal).toBe(Math.round(t.tdeeRest / 50) * 50);
    expect(t.deficit).toBe(0);
    expect(t.cutRule).toBeNull();
    expect(t.protein).toBe(Math.round((1.4 * 72) / 5) * 5);
  });

  test("activity: stand and labor bases, training capped at 2.0", () => {
    const stand = computeTargets(withP({ work: "stand" }), "CN");
    expect(stand.palRest).toBeCloseTo(1.6, 10);
    expect(stand.palTraining).toBeCloseTo(1.8, 10);
    const labor = computeTargets(withP({ work: "labor" }), "CN");
    expect(labor.palTraining).toBeCloseTo(2.0, 10);
    const none = computeTargets(withP({ trainingDays: [] }), "CN");
    expect(none.palAverage).toBeCloseTo(1.4, 10);
  });

  test("protein floor and cap", () => {
    const floor = computeTargets(
      withP({ sex: "f", goal: "steady", weightKg: 45, heightCm: 160, bodyFatPct: undefined, trainingDays: [] }),
      "CN",
    );
    expect(floor.protein).toBe(55); // 1.2 × 45 = 54
    // 45% body fat at BMI 22.9: 1.8 × 70 = 126 is over 3.1 × FFM = 119.35.
    const cap = computeTargets(withP({ goal: "gain", weightKg: 70, bodyFatPct: 45 }), "CN");
    expect(cap.proteinCap).toBeCloseTo(3.1 * 38.5, 6);
    expect(cap.protein).toBe(120);
  });

  test("a carb shortfall pulls fat down toward its floor", () => {
    const t = computeTargets(
      withP({ sex: "f", age: 70, weightKg: 38, heightCm: 150, bodyFatPct: undefined, trainingDays: [] }),
      "CN",
    );
    // 1000 kcal, 55 g protein: 25% fat (30 g) leaves 127.5 g carbs, under 130.
    expect(t.rest.protein).toBe(55);
    expect(t.rest.fat).toBe(25);
    expect(t.rest.carbs).toBe(140);
    expect(t.rest.kcalRaisedForCarbs).toBe(false);
    expect(t.rest.fat).toBeGreaterThanOrEqual(t.rest.fatFloor);
  });
});

describe("meal split", () => {
  test("rest day: 25/35/30/10, snack protein min(10 g, 10%)", () => {
    const t = computeTargets(EXAMPLE, "CN");
    const m = t.rest.meals;
    expect(t.rest.order).toEqual(["breakfast", "lunch", "snack", "dinner"]);
    expect(t.rest.postWorkout).toBeNull();
    expect(m.breakfast.kcal).toBeCloseTo(2150 * 0.25, 6);
    expect(m.lunch.kcal).toBeCloseTo(2150 * 0.35, 6);
    expect(m.dinner.kcal).toBeCloseTo(2150 * 0.3, 6);
    expect(m.snack.kcal).toBeCloseTo(2150 * 0.1, 6);
    expect(m.snack.protein).toBe(10);
    expect(m.breakfast.protein).toBeCloseTo(125 / 3, 6);
    const small = mealTargets({ kcal: 1500, protein: 60 }, null);
    expect(small.snack.protein).toBeCloseTo(6, 6);
    expect(small.lunch.protein).toBeCloseTo(18, 6);
  });

  test("training time places the snack and the +5 point meal", () => {
    expect(dayPlan(true, "morning")).toEqual({ order: ["snack", "breakfast", "lunch", "dinner"], postWorkout: "breakfast" });
    expect(dayPlan(true, "midday")).toEqual({ order: ["breakfast", "snack", "lunch", "dinner"], postWorkout: "lunch" });
    expect(dayPlan(true, "evening")).toEqual({ order: ["breakfast", "lunch", "snack", "dinner"], postWorkout: "dinner" });

    for (const post of ["breakfast", "lunch", "dinner"] as const) {
      const m = mealTargets({ kcal: 2000, protein: 120 }, post);
      const base = { breakfast: 0.25, lunch: 0.35, dinner: 0.3 };
      expect(m[post].kcal).toBeCloseTo(2000 * (base[post] + 0.05), 6);
      const others = (["breakfast", "lunch", "dinner"] as const).filter((k) => k !== post);
      const pool = others.reduce((s, k) => s + base[k], 0);
      for (const k of others) expect(m[k].kcal).toBeCloseTo(2000 * (base[k] - (0.05 * base[k]) / pool), 6);
      expect(m.snack.kcal).toBeCloseTo(200, 6);
      const sum = m.breakfast.kcal + m.lunch.kcal + m.dinner.kcal + m.snack.kcal;
      expect(sum).toBeCloseTo(2000, 6);
    }

    const t = computeTargets(withP({ trainTime: "morning" }), "CN");
    expect(t.training.postWorkout).toBe("breakfast");
    expect(t.training.meals.breakfast.kcal).toBeCloseTo(2450 * 0.3, 6);
    expect(targetsForWeekday(t, EXAMPLE, 1)).toBe(t.training);
    expect(targetsForWeekday(t, EXAMPLE, 2)).toBe(t.rest);
  });
});
