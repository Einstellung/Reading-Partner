// The program's half of a draft (src/info/meals/planner/fill.ts): the model
// sends mains and pots, the program fills breakfasts, staples, sides and fruit
// to pass every rule, or names the picks to change.
// Run: scripts/t.sh tests/info/meals/planner/fill.test.ts

import { expect, test } from "bun:test";
import { DEFAULT_MAX_ROUNDS } from "../../../../src/legion/durable/turn";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import { MAX_DRAFT_ROUNDS, type PlanDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import { leftoverChecked } from "../../../../src/info/meals/planner/packs";
import { goodDraft, PROFILE, START_WEEKDAY, targetsFor } from "./fixture";

const ctx = { profile: PROFILE, targets: targetsFor(), startWeekday: START_WEEKDAY };

/** The good draft as the model now sends it: mains and pots only. */
function picks(): PlanDraft {
  const d = goodDraft();
  for (const day of d.days) {
    day.breakfast = "";
    day.fruit = [];
    day.lunch.sides = [];
    day.dinner.sides = [];
    for (const m of [day.lunch.main, day.dinner.main]) if ("dish" in m) delete m.staple;
  }
  return d;
}

test("mains and pots alone are filled into a plan that passes, the same way every time", () => {
  const a = fillDraft(picks(), ctx);
  expect(a.result.problems).toEqual([]);
  expect(a.unfilled).toEqual([]);
  for (const day of a.result.draft.days) {
    expect(day.breakfast).not.toBe("");
    for (const m of [day.lunch.main, day.dinner.main]) if ("dish" in m) expect(m.staple).toBeTruthy();
  }
  const b = fillDraft(picks(), ctx);
  expect(b.result.draft).toEqual(a.result.draft);
});

test("a breakfast they asked for stays; the others are the program's", () => {
  const p = picks();
  p.days[1]!.breakfast = "milk_toast_boiled_egg";
  const out = fillDraft(p, ctx);
  expect(out.result.problems).toEqual([]);
  expect(out.result.draft.days[1]!.breakfast).toBe("milk_toast_boiled_egg");
});

test("a pot eaten twice the same way takes another way, and says so", () => {
  const p = picks();
  const lunch = p.days[1]!.lunch.main as { batch: string; way: number };
  lunch.way = 1;
  const out = fillDraft(p, ctx);
  expect(out.result.problems.filter((x) => x.rule === "ways_vary")).toEqual([]);
  expect(out.changed.join("\n")).toContain("Day 2 lunch eats pot chili as way");
});

test("a pack only mains use, half used by a pick, comes back naming the food and the pick", () => {
  const p = picks();
  p.days[2]!.dinner = { main: { dish: "lemon_dill_steamed_salmon" }, sides: [] };
  const out = fillDraft(p, ctx);
  const text = out.unfilled.join("\n");
  expect(out.result.problems.some((x) => x.rule === "leftover" && x.food === "green_beans")).toBe(true);
  expect(text).toContain("(green_beans)");
  expect(text).toContain("Day 3 dinner lemon_dill_steamed_salmon");
  expect(text).toContain("lubia_beef_green_beans");
});

test("soy milk keeps like milk once opened, so its leftover carton is not held to the plan", () => {
  expect(leftoverChecked(foodById("soy_milk_unsweetened")!)).toBe(false);
  expect(leftoverChecked(foodById("low_fat_milk")!)).toBe(false);
  expect(leftoverChecked(foodById("spinach")!)).toBe(true);
});

test("the turn's round cap leaves a round after the last refused draft for the explanation", () => {
  expect(MAX_DRAFT_ROUNDS).toBe(4);
  expect(MAX_DRAFT_ROUNDS + 1).toBeLessThanOrEqual(DEFAULT_MAX_ROUNDS);
});
