// record_meals_deviation (src/info/meals/tools.ts): the one sentence the reader
// says, which meal it is about, and what the tool tells the model to do next.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  buildRecordDeviationTool,
  resolveDeviationDate,
  toMealKey,
  type MealsToolDeps,
} from "../../../src/info/meals/tools";
import type { MealsPorts } from "../../../src/info/meals/apply";
import type { Deviation, MealsState, ShoppingState, WeekPlan } from "../../../src/info/meals/plan/types";
import { EMPTY_MEALS } from "../../../src/info/meals/plan/types";
import { mealOn } from "../../../src/info/meals/plan/week";
import { MON, shopping, state } from "./fixtures/week";

function tool(current: MealsState) {
  const written: { deviation: Deviation; plan: WeekPlan; shopping: ShoppingState }[] = [];
  let reloads = 0;
  const ports: MealsPorts = {
    current: async () => current,
    saveCharter: async () => {},
    savePlan: async () => {},
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async (deviation, plan, list) => {
      written.push({ deviation, plan, shopping: list });
    },
    region: () => "other",
    now: () => 9,
    today: () => MON,
    changed: () => {
      reloads += 1;
    },
  };
  const deps: MealsToolDeps = {
    threadId: "meals",
    state: async () => current,
    today: () => MON,
    now: () => 9,
    region: () => "other",
    onMealsCard: () => {},
  };
  return {
    written,
    run: async (args: Record<string, unknown>) => {
      const out = await buildRecordDeviationTool({ ...deps, ports }).execute(args);
      return typeof out === "string" ? out : String(out.text);
    },
    reloads: () => reloads,
  };
}

test("a lunch that was not made is recorded, and the next made meal is handed back", async () => {
  const t = tool(state());
  const out = await t.run({
    day: "today",
    meal: "lunch",
    became: "out",
    place: "the canteen",
    said: "didn't make lunch, ate at the canteen",
  });
  expect(t.written[0]!.deviation).toMatchObject({
    date: MON,
    meal: "lunch",
    became: "out",
    place: "the canteen",
    at: 9,
  });
  expect(out).toContain("2026-09-21 dinner needs its foods picked again");
  expect(out).toContain("adjustment set");
  expect(t.reloads()).toBe(1);
});

test("a dinner that became delivery hands back tomorrow's breakfast", async () => {
  const t = tool(state());
  const out = await t.run({ day: "1", meal: "dinner", became: "delivery", said: "ordered in" });
  expect(out).toContain("2026-09-22 breakfast");
  expect(mealOn(t.written[0]!.plan, MON, "dinner")).toEqual({ mode: "delivery" });
});

// Tuesday is a rest day: the snack sits between lunch and dinner.
test("a snack not eaten hands back that evening's dinner", async () => {
  const t = tool(state());
  const out = await t.run({ day: "2", meal: "Snack", became: "skip", said: "wasn't hungry" });
  expect(t.written[0]!.deviation).toMatchObject({ date: "2026-09-22", meal: "snack", became: "skip" });
  expect(out).toContain("2026-09-22 dinner needs its foods picked again");
  expect(mealOn(t.written[0]!.plan, "2026-09-22", "snack")).toEqual({ mode: "skip" });
});

test("a meal that becomes made hands back that meal itself", async () => {
  const t = tool(state());
  const out = await t.run({ day: "3", meal: "dinner", became: "make", said: "I'll cook tonight" });
  expect(out).toContain("2026-09-23 dinner needs its foods picked again");
});

test("a meal that was never made moves nothing else", async () => {
  const t = tool(state());
  const out = await t.run({ day: "6", meal: "breakfast", became: "out", place: "a cafe", said: "sat down for it" });
  expect(out).toContain("Nothing else in the week moved");
  expect(mealOn(t.written[0]!.plan, "2026-09-26", "breakfast")).toEqual({ mode: "out", place: "a cafe" });
});

test("the refusals: no week, a day off the week, a meal that is not one of four, a mode that is not a mode", async () => {
  const none = tool({ ...EMPTY_MEALS, shopping: shopping() });
  expect(await none.run({ day: "today", meal: "lunch", became: "out", said: "x" })).toContain(
    "no week planned",
  );

  const t = tool(state());
  expect(await t.run({ day: "9", meal: "lunch", became: "out", said: "x" })).toContain(
    "not a day of this week",
  );
  expect(await t.run({ day: "1", meal: "brunch", became: "out", said: "x" })).toContain(
    "meal must be one of",
  );
  // The old modes are gone.
  expect(await t.run({ day: "1", meal: "lunch", became: "packed", said: "x" })).toContain(
    "became must be one of",
  );
  expect(await t.run({ day: "1", meal: "lunch", became: "cook", said: "x" })).toContain(
    "became must be one of",
  );
  expect(t.written).toEqual([]);
});

test("a day is named the way the reader says it, or refused", () => {
  expect(resolveDeviationDate("today", MON, "2026-09-23")).toBe("2026-09-23");
  expect(resolveDeviationDate("yesterday", MON, "2026-09-23")).toBe("2026-09-22");
  expect(resolveDeviationDate("tomorrow", MON, "2026-09-23")).toBe("2026-09-24");
  expect(resolveDeviationDate("3", MON, "2026-09-23")).toBe("2026-09-23");
  expect(resolveDeviationDate("last Tuesday", MON, MON)).toBeNull();
  expect(resolveDeviationDate("0", MON, MON)).toBeNull();
});

test("a meal key is one of four, whatever case it arrives in", () => {
  expect(toMealKey("Lunch")).toBe("lunch");
  expect(toMealKey(" dinner ")).toBe("dinner");
  expect(toMealKey("SNACK")).toBe("snack");
  expect(toMealKey("supper")).toBeNull();
});
