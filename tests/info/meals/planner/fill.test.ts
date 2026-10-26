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

test("a second rice is a structure rule the fill meets by a staple or a way, and says so", () => {
  const p = picks();
  (p.days[0]!.lunch.main as { dish: string; staple?: string }).staple = "white_rice";
  const out = fillDraft(p, ctx);
  expect(out.result.problems.map((x) => x.rule)).not.toContain("one_rice");
  expect(out.result.plan).not.toBeNull();
  expect(out.changed.join("\n")).toContain("for one_rice");
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

test("a day short of kcal names each pick's kcal and the staple-less way, and asks for a fuller main", () => {
  // A probe draft: day 3 eats a fish main and a pot's way that comes without a staple.
  const fresh = (dish: string) => ({ main: { dish }, sides: [] });
  const pot = (batch: string, way: number) => ({ main: { batch, way }, sides: [] });
  const p: PlanDraft = {
    days: [
      { breakfast: "", lunch: fresh("sesame_chicken_cucumber_salad"), dinner: fresh("salmon_broccoli_skillet"), fruit: [] },
      { breakfast: "", lunch: pot("chicken", 1), dinner: pot("beef", 3), fruit: [] },
      { breakfast: "", lunch: fresh("lemon_dill_steamed_salmon"), dinner: pot("chicken", 3), fruit: [] },
    ],
    batches: [
      { id: "chicken", dish: "five_spice_braised_chicken", session: "prep", meals: [{ day: 2, slot: "lunch" }, { day: 3, slot: "dinner" }] },
      { id: "beef", dish: "tomato_braised_beef_shank", session: "prep", meals: [{ day: 2, slot: "dinner" }] },
    ],
    sessions: [{ id: "prep", day: 1, part: "evening" }],
  };
  const text = fillDraft(p, ctx).unfilled.join("\n");
  expect(text).toMatch(/Day 3 comes to \d+ kcal of \d+, under 90%, after the breakfast/);
  expect(text).toMatch(/Day 3 dinner five_spice_braised_chicken \(pot chicken, way 3\) \d+ kcal, no staple/);
  expect(text).toContain("a way with a staple or a fuller main");
  expect(text).not.toContain("fuller breakfast");
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
