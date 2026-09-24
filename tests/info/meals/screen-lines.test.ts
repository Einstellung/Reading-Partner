import { describe, expect, test } from "bun:test";

import { computeTargets } from "../../../src/info/meals/nutrition/targets";
import {
  cellMarks,
  cellsAriaLabel,
  dayMeters,
  dayTotalsLine,
  guideLine,
  macroLine,
  mealHeading,
  mealNumbersLine,
  weekRowNumbers,
} from "../../../src/info/meals/screen-lines";
import { dayView } from "../../../src/info/meals/view";
import { MON, profile, week } from "./fixtures/week";

const p = profile();
const t = computeTargets(p, "CN");
const monday = () => {
  const day = week().days.find((d) => d.date === MON);
  if (!day) throw new Error("no Monday");
  return dayView(day, MON, t, p);
};

describe("screen lines", () => {
  test("a made meal's row line: kcal, protein, minutes", () => {
    const m = monday().meals.find((x) => x.totals);
    if (!m?.totals) throw new Error("no made meal");
    expect(mealNumbersLine(m)).toBe(
      `${Math.round(m.totals.kcal)} kcal · P ${Math.round(m.totals.protein)} g · ${m.minutes} min`,
    );
    expect(macroLine({ kcal: 412.4, protein: 30.6, fat: 12.2, carbs: 45.5 })).toBe(
      "412 kcal · P 31 g · F 12 g · C 46 g",
    );
  });

  test("a meal with no grams has no numbers line", () => {
    const m = { ...monday().meals[0]!, totals: null };
    expect(mealNumbersLine(m)).toBeNull();
  });

  test("the day's totals, meters and guide against its targets", () => {
    const d = monday();
    if (!d.targets) throw new Error("no targets");
    expect(dayTotalsLine(d)).toBe(
      `${Math.round(d.totals.kcal)} / ${d.targets.kcal} kcal · P ${Math.round(d.totals.protein)} / ${d.targets.protein} g`,
    );
    const [kcal, protein] = dayMeters(d);
    expect(kcal?.label).toBe("Calories");
    expect(protein?.label).toBe("Protein");
    expect(kcal!.pct).toBeGreaterThan(0);
    expect(kcal!.pct).toBeLessThanOrEqual(100);
    expect(guideLine(d)).toContain(`(guide ${d.targets.fat} / ${d.targets.carbs} g)`);
    expect(weekRowNumbers(d)).toEqual([`${Math.round(d.totals.kcal)} kcal`, `P ${Math.round(d.totals.protein)} g`]);
  });

  test("a day without targets has no number lines", () => {
    const day = week().days[0]!;
    const d = dayView(day, MON, null, null);
    expect(dayTotalsLine(d)).toBeNull();
    expect(guideLine(d)).toBeNull();
    expect(dayMeters(d)).toEqual([]);
  });

  test("the post-workout meal says so", () => {
    const d = monday();
    const post = d.meals.find((m) => m.postWorkout);
    expect(post).toBeDefined();
    expect(mealHeading(post!)).toBe(`${post!.label} · after training`);
  });

  test("the three cells", () => {
    const c = { protein: true, produce: false, carbs: true };
    expect(cellMarks(c).map((m) => `${m.short}${m.on ? "+" : "-"}`)).toEqual(["P+", "V-", "C+"]);
    expect(cellsAriaLabel(c)).toBe("Protein yes, veg no, carbs yes");
  });
});
