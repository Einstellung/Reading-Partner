// What the draft rules still find after a plan is written (docs/73 写入后的检查):
// Apply and a profile change hand the problems back and write the plan exactly
// as they would without them, and the two tools tell the model in one line.
// Run: scripts/t.sh tests/info/meals/plan-check.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../src/i18n";
import { applyDraft, checkNote, saveProfile, type MealsPorts, type PlanCheck } from "../../../src/info/meals/apply";
import { buildDraftCard } from "../../../src/info/meals/build-draft-card";
import type { MealsCharter, MealsState, ShoppingState, WeekPlan } from "../../../src/info/meals/plan/types";
import { computeTargets, type Profile } from "../../../src/info/meals/nutrition/targets";
import type { PlanDraft } from "../../../src/info/meals/planner/draft";
import { resolvePlannerWeek, weekFromDraft } from "../../../src/info/meals/planner/to-week";
import { buildApplyMealPlanTool, buildUpdateProfileTool } from "../../../src/info/meals/tools";
import type { ToolResult } from "../../../src/legion/durable/contract";
import { shopping } from "./fixtures/week";
import { checked, LIB } from "./planner/card-fixture";
import { goodDraft, PROFILE, START } from "./planner/fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

/** The good draft with Day 1's breakfast soy milk: Day 1 has no calcium source (planner/calcium.test.ts). */
function soyDay1(): PlanDraft {
  const d = goodDraft();
  d.days[0]!.breakfast = "soy_milk_maker_plain";
  return d;
}

interface Harness {
  ports: MealsPorts;
  plans: { plan: WeekPlan; shopping: ShoppingState }[];
  charters: { charter: MealsCharter; week: { plan: WeekPlan; shopping: ShoppingState } | null }[];
}

function harness(over: Partial<MealsState> = {}): Harness {
  let current: MealsState = {
    charter: { profile: PROFILE, text: "", updatedAt: 1 },
    plan: null,
    shopping: shopping(),
    deviations: [],
    ...over,
  };
  const h: Harness = { plans: [], charters: [], ports: null as unknown as MealsPorts };
  h.ports = {
    current: async () => current,
    saveCharter: async (charter, week) => {
      h.charters.push({ charter, week });
      current = { ...current, charter, ...(week ? week : {}) };
    },
    savePlan: async (plan, list) => {
      h.plans.push({ plan, shopping: list });
    },
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 100,
    today: () => START,
    changed: () => {},
  };
  return h;
}

// A draft card as the planning tool drew it, without the tool's gate: the
// profile it passed against is not the one it is applied against.
function cardFor(draft: PlanDraft) {
  return buildDraftCard({ result: checked(draft), lib: LIB, startDate: START, threadId: "meals", previous: null, newId: "7" });
}

function storedPlan(draft: PlanDraft): WeekPlan {
  return weekFromDraft({ result: checked(draft), lib: LIB, start: START, now: 1, previous: null });
}

// --- Apply ---------------------------------------------------------------------

test("Apply hands back the calcium problem and writes the plan as it would without it", async () => {
  const h = harness();
  const card = cardFor(soyDay1());
  const out = await applyDraft(card, h.ports);
  await out.pending;
  expect(out.ok).toBe(true);
  expect(out.check?.start).toBe(START);
  expect(out.check?.problems.map((p) => [p.rule, p.day])).toEqual([["calcium", 1]]);
  expect(h.plans).toHaveLength(1);
  // The same plan the draft gives on its own: nothing re-planned, nothing dropped.
  const expected = weekFromDraft({ result: checked(soyDay1()), lib: LIB, start: START, now: 100, previous: null });
  expect(h.plans[0]!.plan).toEqual(expected);
});

test("a draft that still passes comes back with no problems", async () => {
  const h = harness();
  const out = await applyDraft(cardFor(goodDraft()), h.ports);
  await out.pending;
  expect(out.check).toEqual({ start: START, problems: [] });
  expect(checkNote(out.check)).toBe("");
});

// --- a profile change ------------------------------------------------------------

test("a profile change re-solves the stored draft, writes it, and hands back what the rules find", async () => {
  const plan = storedPlan(soyDay1());
  const h = harness({ plan });
  const heavier: Profile = { ...PROFILE, weightKg: 70 };
  const out = await saveProfile(heavier, h.ports);
  expect(out.ok).toBe(true);
  expect(out.check?.start).toBe(START);
  expect(out.check?.problems.map((p) => p.rule)).toContain("calcium");
  // The week is the one the re-solve gives, as before the check came back.
  const written = h.charters[0]!.week!;
  const resolved = resolvePlannerWeek(plan, heavier, computeTargets(heavier, "other"));
  expect(written.plan.days).toEqual(resolved.days);
  expect(written.plan.revision).toBe(plan.revision + 1);
  expect(written).not.toHaveProperty("check");
});

test("a profile change that breaks the draft keeps the plan and names what broke it", async () => {
  // Day 3's lunch is pork.
  const plan = storedPlan(goodDraft());
  const h = harness({ plan });
  const out = await saveProfile({ ...PROFILE, dislikes: ["pork"] }, h.ports);
  expect(out.ok).toBe(true);
  expect(out.check?.problems.map((p) => p.rule)).toContain("dish_blocked");
  expect(h.charters[0]!.week!.plan.days).toEqual(plan.days);
});

test("a profile change with no draft-made plan has nothing to check", async () => {
  const h = harness();
  const out = await saveProfile({ ...PROFILE, weightKg: 70 }, h.ports);
  expect(out.ok).toBe(true);
  expect(out.check).toBeUndefined();
});

// --- what the model is told -------------------------------------------------------

const CALCIUM: PlanCheck = { start: START, problems: [{ rule: "calcium", message: "m", day: 1 }, { rule: "sodium", message: "m", day: 3 }] };

test("the model's line names the rules and their days, and says not to call it fine", () => {
  const line = checkNote(CALCIUM);
  expect(line).toContain("calcium (Day 1); sodium (Day 3)");
  expect(line).toContain("do not tell them the plan is all fine");
  expect(line).not.toContain("\n");
  expect(checkNote({ start: START, problems: [{ rule: "fish", message: "m" }] })).toContain("rules: fish.");
});

test("apply_meal_plan adds the line when the written plan breaks a rule", async () => {
  const base = { threadId: "meals", state: async () => harness().ports.current(), today: () => START, now: () => 1, region: () => "other" as const, onMealsCard: () => {} };
  const tool = buildApplyMealPlanTool({ ...base, applyDraft: async () => ({ ok: true, note: "[Saved.]", check: CALCIUM }) });
  const res = (await tool.execute({} as never)) as ToolResult;
  expect(res.text).toStartWith("[Saved.] Say it in one line. The saved plan still breaks these plan rules: calcium (Day 1)");
  const clean = buildApplyMealPlanTool({ ...base, applyDraft: async () => ({ ok: true, note: "[Saved.]", check: { start: START, problems: [] } }) });
  expect(((await clean.execute({} as never)) as ToolResult).text).toBe("[Saved.] Say it in one line.");
});

test("update_meals_profile adds the line and hands the check to the meals page", async () => {
  const h = harness({ plan: storedPlan(soyDay1()) });
  const seen: (PlanCheck | null)[] = [];
  const tool = buildUpdateProfileTool({
    threadId: "t",
    state: () => h.ports.current(),
    today: () => START,
    now: () => 5,
    region: () => "other",
    onMealsCard: () => {},
    onPlanCheck: (check) => seen.push(check),
    ports: h.ports,
  });
  const res = (await tool.execute({ weightKg: 70 } as never)) as ToolResult;
  expect(res.text).toContain("The saved plan still breaks these plan rules: calcium (Day 1)");
  expect(seen).toHaveLength(1);
  expect(seen[0]?.problems.map((p) => p.rule)).toContain("calcium");
});
