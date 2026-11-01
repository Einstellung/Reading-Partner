// What a plan takes to be in any kitchen (docs/671 目标用户, 整包与开封): a
// stove and a microwave, and only salt, pepper, sugar and the cooking oil in
// the cupboard. Any other appliance counts when the profile names it, in the
// reader's words; a grain cooks on whatever the kitchen has; every other
// seasoning goes on the list as a whole bottle, jar or packet.
// Run: scripts/t.sh tests/info/meals/planner/kitchen-and-pantry.test.ts

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import { DEFAULT_KITCHEN } from "../../../../src/info/meals/dishes/types";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import type { Profile } from "../../../../src/info/meals/nutrition/targets";
import { parseMealsFile } from "../../../../src/info/meals/plan/store";
import { parseDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import { equipmentNamed, fitKitchen, kitchenOf, planLibrary } from "../../../../src/info/meals/planner/library";
import { buyFor, packList } from "../../../../src/info/meals/planner/packs";
import { planDayTargets } from "../../../../src/info/meals/planner/solve";
import { computeTargets } from "../../../../src/info/meals/nutrition/targets";
import { prepStepsRequest, prepStepsUserText } from "../../../../src/info/meals/recipe/prep-steps";
import { KITCHEN_OPTIONS } from "../../../../src/info/meals/screen/onboarding";

const fixture = () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/batch-plan.json"), "utf8"));
  const state = parseMealsFile(raw);
  if (!state) throw new Error("fixture does not parse");
  return state;
};

describe("the kitchen", () => {
  test("the default is a stove and a microwave", () => {
    expect([...DEFAULT_KITCHEN]).toEqual(["stove", "microwave"]);
    expect([...kitchenOf({ kitchen: [] })].sort()).toEqual(["microwave", "stove"]);
  });

  test("the owner's words name their appliances, and no rice cooker", () => {
    const { profile } = fixture().charter!;
    expect([...kitchenOf(profile)].sort()).toEqual(["microwave", "pressure_cooker", "soy_milk_maker", "steamer", "stove"]);
  });

  test("entries in Chinese, English or as ids name the equipment", () => {
    expect(equipmentNamed("一口锅")).toEqual([]);
    expect(equipmentNamed("电饭煲")).toEqual(["rice_cooker"]);
    expect(equipmentNamed("高压锅")).toEqual(["pressure_cooker"]);
    expect(equipmentNamed("Instant Pot")).toEqual(["pressure_cooker"]);
    expect(equipmentNamed("rice_cooker")).toEqual(["rice_cooker"]);
    expect(equipmentNamed("Air fryer")).toEqual(["air_fryer"]);
    expect(equipmentNamed("steamer basket")).toEqual(["steamer"]);
    expect(equipmentNamed("microwave oven")).toEqual(["microwave"]);
    expect(equipmentNamed("Dutch oven")).toEqual([]);
    expect(equipmentNamed("toaster oven")).toEqual(["oven", "toaster"]);
    expect(equipmentNamed("soy milk maker")).toEqual(["soy_milk_maker"]);
  });

  test("every onboarding option names something, except the plain pot", () => {
    for (const o of KITCHEN_OPTIONS) {
      if (o === "一口锅") continue;
      expect(equipmentNamed(o).length, o).toBe(1);
    }
    const named = new Set(KITCHEN_OPTIONS.flatMap(equipmentNamed));
    for (const e of ["rice_cooker", "pressure_cooker", "steamer", "soy_milk_maker", "oven", "air_fryer"] as const) expect(named.has(e), e).toBe(true);
  });

  test("brown rice cooks in the rice cooker, else the pressure cooker, else a pot on the stove", () => {
    const brown = SEED_DISHES.find((d) => d.id === "brown_rice")!;
    expect(fitKitchen(brown, kitchenOf({ kitchen: ["电饭煲"] })).equipment).toEqual(["rice_cooker"]);
    const pressure = fitKitchen(brown, kitchenOf({ kitchen: ["电压力锅"] }));
    expect(pressure.equipment).toEqual(["pressure_cooker"]);
    expect(pressure.summary).toContain("压力锅");
    const stove = fitKitchen(brown, kitchenOf({ kitchen: [] }));
    expect(stove.equipment).toEqual(["stove"]);
    expect(stove.totalMin).toBe(60);
    expect(stove.summaryEn).not.toMatch(/rice cooker/i);
    expect(fitKitchen(brown, new Set())).toBe(brown);
  });

  test("the library hands each dish on the route the kitchen fits; the rice is still the plan's rice", () => {
    const lib = planLibrary({ dislikes: [], kitchen: [], unavailable: [] });
    expect(lib.dish("white_rice")?.equipment).toEqual(["stove"]);
    expect(lib.stored("white_rice")?.equipment).toEqual(["rice_cooker"]);
    // A dish no route fits is left out by the callers that check the kitchen.
    expect(lib.dish("beef_ragu")?.equipment.every((e) => lib.kitchen.has(e))).toBe(false);
  });

  test("a fresh draft for the owner's profile fills, and its prep session writes no rice-cooker step", () => {
    const state = fixture();
    const profile = state.charter!.profile as Profile;
    const draft = parseDraft(state.plan!.planner!.draft);
    const lib = planLibrary(profile);
    const out = fillDraft(draft, {
      profile,
      targets: planDayTargets(computeTargets(profile, "other"), profile, state.plan!.planner!.start, draft.days.length),
      startWeekday: 6,
      people: 1,
      library: lib,
    });
    expect(out.result.problems.map((p) => p.message)).toEqual([]);
    const staples = out.result.draft.batches.map((b) => lib.dish(b.dish)!).concat(
      out.result.storage?.rice ? [lib.dish(out.result.storage.rice.staple)!] : [],
    );
    for (const d of staples) expect(d.equipment, d.id).not.toContain("rice_cooker");

    const request = prepStepsRequest(state, { today: "2026-10-30", region: "other", language: "en" });
    expect(request).not.toBeNull();
    expect(request!.devices).not.toContain("rice_cooker");
    if (request!.rice) expect(request!.rice.equipment).toEqual(["pressure_cooker"]);
    expect(prepStepsUserText(request!)).not.toMatch(/rice cooker/i);
  });
});

describe("the cupboard", () => {
  test("only salt, black pepper and sugar are flagged as at home", () => {
    const flagged = ["salt", "ground_black_pepper", "white_sugar"];
    for (const id of flagged) expect(foodById(id)?.assumedHome, id).toBe(true);
    for (const id of ["ground_cumin", "taco_seasoning", "stock_paste", "garlic_paste", "ginger_paste", "crushed_tomatoes", "curry_powder", "ground_cinnamon", "olive_oil"]) {
      expect(foodById(id)?.assumedHome, id).toBeUndefined();
      expect(buyFor(foodById(id)!, 5).by, id).toBe("pack");
    }
  });

  test("the cooking oil is at home, a dressing oil is bought", () => {
    const state = fixture();
    const profile = state.charter!.profile as Profile;
    const draft = parseDraft(state.plan!.planner!.draft);
    const out = fillDraft(draft, {
      profile,
      targets: planDayTargets(computeTargets(profile, "other"), profile, state.plan!.planner!.start, draft.days.length),
      startWeekday: 6,
      people: 1,
      library: planLibrary(profile),
    });
    const plan = out.result.plan!;
    const lines = plan.days.flatMap((d) => [d.meals.breakfast, d.meals.lunch, d.meals.dinner]).flatMap((m) => m.lines);
    const cooking = new Set(lines.filter((l) => l.cookingOil || l.source === "oil").map((l) => l.food));
    const list = packList(plan, out.result.draft);
    for (const l of list) {
      const food = foodById(l.food)!;
      if (food.assumedHome || cooking.has(l.food)) expect(l.buy.by, l.food).toBe("onHand");
      else expect(l.buy.by, l.food).not.toBe("onHand");
    }
    // A plan that uses only sesame oil as a drizzle buys a bottle of it.
    const sesame = list.find((l) => l.food === "sesame_oil");
    if (sesame && !cooking.has("sesame_oil")) expect(sesame.buy).toMatchObject({ by: "pack", kind: "bottle" });
  });
});
