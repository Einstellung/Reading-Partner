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
import type { Deviation, MealsState, WeekPlan } from "../../../src/info/meals/types";
import { EMPTY_MEALS } from "../../../src/info/meals/types";
import { MON, shopping, state } from "./fixtures/week";

function tool(current: MealsState) {
  const written: { deviation: Deviation; plan: WeekPlan }[] = [];
  let reloads = 0;
  const ports: MealsPorts = {
    current: async () => current,
    saveCharter: async () => {},
    savePlan: async () => {},
    saveShopping: async () => {},
    saveDeviation: async (deviation, plan) => {
      written.push({ deviation, plan });
    },
    saveDishMethod: async () => {},
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

test("a lunch that was not carried is recorded, and the next cooked meal is handed back", async () => {
  const t = tool(state());
  const out = await t.run({
    day: "today",
    meal: "lunch",
    became: "out",
    place: "the canteen",
    said: "didn't take lunch, ate at the canteen",
  });
  expect(t.written[0]!.deviation).toMatchObject({
    date: MON,
    meal: "lunch",
    became: "out",
    place: "the canteen",
    at: 9,
  });
  expect(out).toContain("2026-09-21 dinner now needs another look");
  expect(out).toContain("adjustment set");
  expect(t.reloads()).toBe(1);
});

test("a dinner that became delivery hands back the packed lunch it fed", async () => {
  const t = tool(state());
  const out = await t.run({ day: "today", meal: "dinner", became: "delivery", said: "ordered in" });
  expect(out).toContain("2026-09-22 lunch");
  const lunch = t.written[0]!.plan.days[1]!.lunch;
  expect(lunch.reheatOf).toBeUndefined();
});

test("a breakfast that was bought moves nothing", async () => {
  const t = tool(state());
  const out = await t.run({ day: "2", meal: "breakfast", became: "bought", said: "grabbed a coffee" });
  expect(out).toContain("Nothing else in the week moved");
});

test("the refusals: no week, a day off the week, a meal that is not one of three, a mode that is not a mode", async () => {
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
  expect(await t.run({ day: "1", meal: "lunch", became: "grazed", said: "x" })).toContain(
    "became must be one of",
  );
  expect(t.written).toEqual([]);
});

test("a day is named the way the reader says it, or refused", () => {
  expect(resolveDeviationDate("today", MON, "2026-09-23")).toBe("2026-09-23");
  expect(resolveDeviationDate("yesterday", MON, "2026-09-23")).toBe("2026-09-22");
  expect(resolveDeviationDate("3", MON, "2026-09-23")).toBe("2026-09-23");
  expect(resolveDeviationDate("last Tuesday", MON, MON)).toBeNull();
  expect(resolveDeviationDate("0", MON, MON)).toBeNull();
});

test("a meal key is one of three, whatever case it arrives in", () => {
  expect(toMealKey("Lunch")).toBe("lunch");
  expect(toMealKey(" dinner ")).toBe("dinner");
  expect(toMealKey("supper")).toBeNull();
});
