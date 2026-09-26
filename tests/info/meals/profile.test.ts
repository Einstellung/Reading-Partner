// The profile write paths (docs/73 开场, 体重变化), the shopping list from
// solved grams, and a file of the old schema read as empty.
// Run: scripts/t.sh tests/info/meals/profile.test.ts

import { expect, test } from "bun:test";
import type { MealsPorts } from "../../../src/info/meals/apply";
import { saveProfile } from "../../../src/info/meals/apply";
import { regionForTimeZone } from "../../../src/info/meals/region";
import { deriveShoppingList } from "../../../src/info/meals/plan/shopping";
import { mealsFileBody, parseMealsFile } from "../../../src/info/meals/plan/store";
import { buildUpdateProfileTool, patchProfile } from "../../../src/info/meals/tools";
import type { MealsState, ShoppingState, WeekPlan, MealsCharter } from "../../../src/info/meals/plan/types";
import { MON, profile, state, week } from "./fixtures/week";

function ports(initial: MealsState) {
  let current = initial;
  const writes: { charter: MealsCharter; week: { plan: WeekPlan; shopping: ShoppingState } | null }[] = [];
  const p: MealsPorts = {
    current: async () => current,
    saveCharter: async (charter, w) => {
      writes.push({ charter, week: w });
      current = { ...current, charter, ...(w ? { plan: w.plan, shopping: w.shopping } : {}) };
    },
    savePlan: async () => {},
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 5,
    today: () => MON,
    changed: () => {},
  };
  return { p, writes, now: () => current };
}

const grams = (s: MealsState, foodId: string) =>
  s.plan?.days[0]?.lunch.solved?.find((r) => r.foodId === foodId)?.grams ?? 0;

test("onboarding writes the profile directly, keeping the reader's words", async () => {
  const { p, writes } = ports({ ...state(), plan: null });
  const out = await saveProfile(profile({ goal: "cut" }), p);
  expect(out.ok).toBe(true);
  expect(out.targets?.training.kcal).toBeGreaterThan(0);
  expect(writes[0]?.charter.profile.goal).toBe("cut");
  expect(writes[0]?.charter.text).toBe("Lunch is at my desk on weekdays.");
  expect(writes[0]?.week).toBeNull();
});

test("a new weight re-solves the week and re-derives the list in the same write", async () => {
  const before = state();
  const { p, writes, now } = ports(before);
  await saveProfile(profile({ weightKg: 80, goal: "gain" }), p);
  expect(writes[0]?.week).not.toBeNull();
  expect(grams(now(), "microwave_grain_rice")).toBeGreaterThan(grams(before, "microwave_grain_rice"));
  expect(now().shopping.items.length).toBeGreaterThan(0);
  expect(now().plan?.revision).toBe((before.plan?.revision ?? 0) + 1);
});

test("the profile tool writes only the fields stated and answers with the new targets", async () => {
  const { p, now } = ports(state());
  const tool = buildUpdateProfileTool({
    threadId: "t",
    state: async () => now(),
    today: () => MON,
    now: () => 5,
    region: () => "other",
    onMealsCard: () => {},
    ports: p,
  });
  const res = await tool.execute({ weightKg: 71, trainingDays: [2, 1, 1, 9] } as never);
  expect(now().charter?.profile.weightKg).toBe(71);
  expect(now().charter?.profile.trainingDays).toEqual([1, 2]);
  expect(now().charter?.profile.goal).toBe("steady");
  expect(String((res as { text: string }).text)).toContain("Daily targets now");
  expect(patchProfile(profile(), { goal: "sideways" })).toBeNull();
});

test("the list totals solved grams per food, times the people eating, in units where a food has them", () => {
  const one = deriveShoppingList(week(), MON, 1);
  const two = deriveShoppingList(week(), MON, 2);
  const yogurt = one.find((i) => i.foodId === "greek_yogurt");
  expect(yogurt?.name).toBe("无糖希腊酸奶");
  expect(yogurt?.qty).toBe(`${yogurt?.grams} g`);
  expect(two.find((i) => i.foodId === "greek_yogurt")?.grams).toBe((yogurt?.grams ?? 0) * 2);
  expect(one.find((i) => i.foodId === "egg")?.qty).toMatch(/^\d+ 个$/);
  const salmon = one.find((i) => i.foodId === "salmon");
  expect(salmon?.neededBy).toBe(MON);
  expect(one.map((i) => i.foodId)).not.toContain("dragon_meat");
});

test("a file of the old schema is read as empty, keeping only the photo ask", () => {
  const old = {
    version: 1,
    charter: { people: 2, stores: [], kitchen: "", dislikes: [], text: "two of us", updatedAt: 1 },
    plan: { id: "week-x", startDate: MON, days: [], dishes: [], revision: 1 },
    deviations: [{ date: MON, said: "x" }],
    photosAskedAt: 9,
  };
  const parsed = parseMealsFile(old);
  expect(parsed?.charter).toBeNull();
  expect(parsed?.plan).toBeNull();
  expect(parsed?.deviations).toEqual([]);
  expect(parsed?.photosAskedAt).toBe(9);
  const now = state();
  expect(parseMealsFile(JSON.parse(mealsFileBody(now)))).toEqual(now);
});

test("the region follows the host's time zone", () => {
  expect(regionForTimeZone("Asia/Shanghai")).toBe("CN");
  expect(regionForTimeZone("Europe/London")).toBe("other");
  expect(regionForTimeZone(undefined)).toBe("other");
});
