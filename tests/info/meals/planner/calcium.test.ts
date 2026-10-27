// A calcium source each plan day (docs/671 多样性, 钙): which foods count, the
// rule on a solved plan, and the program filling it.
// Run: scripts/t.sh tests/info/meals/planner/calcium.test.ts

import { describe, expect, test } from "bun:test";
import { CALCIUM_SOURCE } from "../../../../src/info/meals/nutrition/food-columns";
import { FOODS, foodById } from "../../../../src/info/meals/nutrition/foods";
import { calciumSources, checkDraft, hasCalciumSource, type DraftContext } from "../../../../src/info/meals/planner/checks";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import type { SolvedDay } from "../../../../src/info/meals/planner/solve";
import { goodDraft, PROFILE, START_WEEKDAY, targetsFor } from "./fixture";

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({ profile: PROFILE, targets: targetsFor(), startWeekday: START_WEEKDAY, ...over });
const one = (food: string, grams: number) => [{ food, grams }];
const dayLines = (d: SolvedDay) => [...d.meals.breakfast.lines, ...d.meals.lunch.lines, ...d.meals.dinner.lines, ...d.fruit, ...d.snack];

/** The good draft with Day 1's breakfast soy milk from the maker: no calcium source left on Day 1. */
function soyDay1(): PlanDraft {
  const d = goodDraft();
  d.days[0]!.breakfast = "soy_milk_maker_plain";
  return d;
}

describe("what counts", () => {
  test("every calcium food is in the table, and the column lands on exactly those", () => {
    for (const id of Object.keys(CALCIUM_SOURCE)) expect(foodById(id), id).toBeDefined();
    const tagged = FOODS.filter((f) => f.calciumSourceG).map((f) => f.id).sort();
    expect(tagged).toEqual(Object.keys(CALCIUM_SOURCE).sort());
  });

  test("each kind is a source at its serving and not under it", () => {
    const kinds = {
      dairy: ["low_fat_milk", "whole_milk", "plain_yogurt", "greek_yogurt", "cheese_slice", "mozzarella", "feta"],
      tofu: ["firm_tofu", "frozen_tofu", "dried_tofu", "spiced_dried_tofu"],
      fishWithBones: ["canned_sardine", "canned_salmon"],
      sesamePaste: ["sesame_paste"],
      greens: ["bok_choy", "pak_choi_white", "gai_lan"],
    };
    for (const id of Object.values(kinds).flat()) {
      const per = CALCIUM_SOURCE[id]!;
      expect(hasCalciumSource(one(id, per)), id).toBe(true);
      expect(hasCalciumSource(one(id, per * 0.9)), id).toBe(false);
    }
    expect(hasCalciumSource(one("low_fat_milk", 250))).toBe(true);
    expect(hasCalciumSource(one("bok_choy", 140))).toBe(true);
  });

  test("plain soy milk, soft tofu, yuba, spinach, seeds and almonds are not sources at any amount", () => {
    for (const id of ["soy_milk_unsweetened", "soybean_dry", "soft_tofu", "tofu_skin", "spinach", "frozen_spinach", "sesame_seeds", "almonds", "napa_cabbage", "canned_tuna_water"]) {
      expect(calciumSources(one(id, 500)), id).toBe(0);
    }
  });

  test("shares add up over the day: half a pot of yogurt and half a block of tofu make one", () => {
    expect(hasCalciumSource([{ food: "plain_yogurt", grams: 50 }, { food: "firm_tofu", grams: 50 }])).toBe(true);
    expect(hasCalciumSource([{ food: "sesame_paste", grams: 6 }, { food: "cheese_slice", grams: 10 }])).toBe(false);
  });
});

describe("the rule", () => {
  test("a day without a source goes back, naming what counts", () => {
    const r = checkDraft(soyDay1(), ctx());
    expect(r.problems.map((p) => p.rule)).toEqual(["calcium"]);
    const p = r.problems[0]!;
    expect(p.day).toBe(1);
    expect(p.over).toBeCloseTo(1 - calciumSources(dayLines(r.plan!.days[0]!)), 6);
    expect(p.message).toStartWith("Day 1 has no calcium source; every day needs one:");
    for (const word of ["milk", "yogurt", "cheese", "firm or dried tofu", "soy milk do not count", "sardines", "sesame paste", "bok choy", "gai lan"]) {
      expect(p.message).toContain(word);
    }
  });

  test("the good draft has one every day, the yogurt and milk breakfasts", () => {
    const r = checkDraft(goodDraft(), ctx());
    expect(r.problems).toEqual([]);
    for (const d of r.plan!.days) expect(hasCalciumSource(dayLines(d)), `Day ${d.day}`).toBe(true);
  });

  test("a bok choy side or a firm tofu main is the day's source", () => {
    const side = soyDay1();
    side.days[0]!.lunch.sides = ["garlic_bok_choy"];
    expect(checkDraft(side, ctx()).problems.map((p) => p.rule)).not.toContain("calcium");
    const tofu = soyDay1();
    tofu.days[0]!.lunch.main = { dish: "homestyle_tofu_pork_slices", staple: "brown_rice" };
    expect(checkDraft(tofu, ctx()).problems.map((p) => p.rule)).not.toContain("calcium");
  });
});

describe("the program fills it", () => {
  test("mains and pots alone pass first time: the breakfasts it picks bring the source on days the mains do not", () => {
    const d = goodDraft();
    for (const day of d.days) {
      day.breakfast = "";
      day.fruit = [];
      for (const m of [day.lunch.main, day.dinner.main]) if ("dish" in m) delete m.staple;
    }
    const out = fillDraft(d, ctx());
    expect(out.result.problems).toEqual([]);
    for (const day of out.result.plan!.days) {
      const withoutSnack = [...day.meals.breakfast.lines, ...day.meals.lunch.lines, ...day.meals.dinner.lines, ...day.fruit];
      expect(hasCalciumSource(withoutSnack), `Day ${day.day}`).toBe(true);
    }
  });

  test("a soy milk breakfast they asked for keeps, and the fill finds the day its source", () => {
    const out = fillDraft(soyDay1(), ctx());
    expect(out.result.problems).toEqual([]);
    expect(out.result.draft.days[0]!.breakfast).toBe("soy_milk_maker_plain");
    expect(hasCalciumSource(dayLines(out.result.plan!.days[0]!))).toBe(true);
  });

  test("what the fill cannot fix goes back naming the mains to change and the breakfast they asked for", () => {
    // No dairy, and no greens or sesame paste either: only a main can bring it now.
    const profile = { ...PROFILE, dislikes: ["dairy", "bok_choy", "pak_choi_white", "gai_lan", "sesame_paste"] };
    const d = soyDay1();
    for (const day of d.days) day.breakfast = "soy_milk_maker_plain";
    const out = fillDraft(d, ctx({ profile }));
    const left = out.unfilled.find((u) => u.startsWith("Day 1 has no calcium source"));
    expect(left).toContain("change one of Day 1's mains to one that has it (");
    expect(left).toContain("tofu");
    expect(left).toContain("or the breakfast they asked for (soy_milk_maker_plain) to one with milk or yogurt");
  });
});
