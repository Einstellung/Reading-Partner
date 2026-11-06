// A pot held at the raw protein they already have (DraftBatch.rawG, docs/platform/687
// 三餐): the 10-31 plan with 600 g of chicken breast and 400 g of beef shank.
// The pot's meals share it evenly, the shopping list, the prep steps and the
// recipe page read the same grams, a rawG the dish cannot take is a `pot`
// problem, and the picks follow an edit so a redraft keeps it.
// Run: scripts/t.sh tests/info/meals/planner/pot-rawg.test.ts

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTargets, type Profile } from "../../../../src/info/meals/nutrition/targets";
import { parseMealsFile } from "../../../../src/info/meals/plan/store";
import type { MealsState, WeekPlan } from "../../../../src/info/meals/plan/types";
import { checkDraft } from "../../../../src/info/meals/planner/checks";
import { parseDraft, type PlanDraft } from "../../../../src/info/meals/planner/draft";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { draftContext, editedPicks, redraft, revisionPicks } from "../../../../src/info/meals/planner/redraft";
import { potRawRange } from "../../../../src/info/meals/planner/solve";
import { batchPortions, checkPlannerRecord, plannerSolveOf } from "../../../../src/info/meals/planner/to-week";
import { plannerShoppingList } from "../../../../src/info/meals/planner/trip";
import { prepStepsRequest } from "../../../../src/info/meals/recipe/prep-steps";

const fixture = (): MealsState => {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/batch-plan.json"), "utf8"));
  const state = parseMealsFile(raw);
  if (!state) throw new Error("fixture does not parse");
  return state;
};

const withRaw = (draft: PlanDraft, raw: Record<string, number>): PlanDraft => ({
  ...draft,
  batches: draft.batches.map((b) => (b.id in raw ? { ...b, rawG: raw[b.id] } : b)),
});

/** The fixture's plan with its stored draft's pots given these raw grams. */
function planWith(raw: Record<string, number>, people?: number) {
  const state = fixture();
  const profile: Profile = { ...state.charter!.profile, ...(people ? { people } : {}) };
  const plan = state.plan!;
  const draft = withRaw(parseDraft(plan.planner!.draft), raw);
  const next: WeekPlan = { ...plan, planner: { ...plan.planner!, draft } };
  const targets = computeTargets(profile, "other");
  return { state: { ...state, charter: { ...state.charter!, profile }, plan: next }, profile, plan: next, targets };
}

const proteinOf = (lines: readonly { food: string; grams: number; role: string }[], food: string) =>
  lines.filter((l) => l.food === food && l.role === "protein").reduce((s, l) => s + l.grams, 0);

describe("a pot held at its raw protein", () => {
  test("parseDraft reads rawG, and leaves a draft without it as it was", () => {
    const d = parseDraft({ days: [], batches: [{ id: "a", dish: "x", session: "s", meals: [], rawG: 600 }, { id: "b", dish: "y", session: "s", meals: [] }], sessions: [] });
    expect(d.batches[0].rawG).toBe(600);
    expect("rawG" in d.batches[1]).toBe(false);
    expect(Number.isNaN(parseDraft({ days: [], batches: [{ id: "a", rawG: "lots" }], sessions: [] }).batches[0].rawG)).toBe(true);
  });

  test("600 g of chicken and 400 g of beef: each pot's meals add up to it, shared evenly", () => {
    for (const people of [1, 2]) {
      const raw = { chicken: 600 * people, beef: 400 * people };
      const { plan, profile, targets } = planWith(raw, people);
      const check = checkPlannerRecord(plan, profile, targets)!;
      expect(check.result.problems.filter((p) => p.rule === "pot")).toEqual([]);
      const solved = check.result.plan!;
      expect(solved).not.toBeNull();
      for (const [id, food] of [["chicken", "chicken_breast"], ["beef", "beef_shank_raw"]] as const) {
        const batch = solved.batches.find((b) => b.id === id)!;
        const per = batch.meals.map((m) => proteinOf(solved.days[m.day - 1].meals[m.slot].lines.filter((l) => l.source === "main"), food));
        expect(Math.abs(per.reduce((s, g) => s + g, 0) * people - raw[id])).toBeLessThan(0.5);
        for (const g of per) expect(Math.abs(g - per[0])).toBeLessThan(0.11);
        expect(Math.round(proteinOf(batch.lines, food) * people)).toBe(raw[id]);
      }
    }
  });

  test("the shopping list, the prep steps and the recipe page read the same grams", () => {
    const { state, plan, profile, targets } = planWith({ chicken: 600, beef: 400 });
    const solve = plannerSolveOf(checkPlannerRecord(plan, profile, targets))!;
    const list = plannerShoppingList(solve.solved, solve.draft, plan, profile.people);
    expect(list.find((i) => i.foodId === "chicken_breast")?.grams).toBe(600);
    expect(list.find((i) => i.foodId === "beef_shank_raw")?.grams).toBe(400);

    const req = prepStepsRequest(state, { today: plan.planner!.start, region: "other", language: "zh-CN" })!;
    const rows = req.pots.flatMap((p) => p.rows);
    expect(rows.find((r) => r.food === "chicken_breast")?.grams).toBe(600);
    expect(rows.find((r) => r.food === "beef_shank_raw")?.grams).toBe(400);

    const portions = [...batchPortions(plan, profile, targets).values()];
    expect(portions.find((p) => p.batch === "chicken")?.pot.rawG).toBe(600);
    expect(portions.find((p) => p.batch === "beef")?.pot.rawG).toBe(400);
  });

  test("more than the dish's largest portions, or under the reference serving, is a pot problem", () => {
    const lib = planLibrary(fixture().charter!.profile);
    const chicken = potRawRange(lib.dish("salsa_shredded_chicken")!, 3);
    const beef = potRawRange(lib.dish("dry_spice_braised_beef")!, 2);
    expect(chicken.min).toBeLessThan(600);
    expect(chicken.max).toBeGreaterThan(600);
    expect(beef.min).toBeLessThan(400);
    expect(beef.max).toBeGreaterThan(400);
    for (const [raw, batch, over] of [
      [{ chicken: chicken.max + 1 }, "chicken", 1],
      [{ beef: beef.min - 20 }, "beef", 20],
      [{ chicken: 0 }, "chicken", undefined],
    ] as const) {
      const { plan, profile, targets } = planWith(raw);
      const result = checkPlannerRecord(plan, profile, targets)!.result;
      const pot = result.problems.filter((p) => p.rule === "pot");
      expect(pot.map((p) => p.batch)).toEqual([batch]);
      expect(pot[0].over).toBe(over);
      expect(result.plan).toBeNull();
    }
    // The bounds themselves pass.
    const { plan, profile, targets } = planWith({ chicken: chicken.max, beef: beef.min });
    expect(checkPlannerRecord(plan, profile, targets)!.result.problems.filter((p) => p.rule === "pot")).toEqual([]);
  });
});

describe("the picks follow an edit", () => {
  const base = () => {
    const plan = fixture().plan!;
    return { draft: parseDraft(plan.planner!.draft), picks: parseDraft(plan.planner!.picks) };
  };

  test("a pot's rawG and dish are written into the picks; untouched meals keep the picks' own", () => {
    const { draft, picks } = base();
    const after = withRaw(draft, { chicken: 600 });
    const next = editedPicks(draft, after, picks);
    expect(next.batches.find((b) => b.id === "chicken")?.rawG).toBe(600);
    expect(next.days.map((d) => d.breakfast)).toEqual(picks.days.map((d) => d.breakfast));
    expect(next.days.map((d) => [d.lunch.main, d.dinner.main])).toEqual(picks.days.map((d) => [d.lunch.main, d.dinner.main]));
    expect(next.asked).toEqual(picks.asked);
  });

  test("a meal's main or way changed in the draft is written at the same place", () => {
    const { draft, picks } = base();
    const after = structuredClone(draft);
    const lunch = after.days[0].lunch.main as { batch: string; way: number };
    after.days[0].lunch.main = { batch: lunch.batch, way: lunch.way === 1 ? 2 : 1 };
    after.days[2].dinner.main = { dish: "salmon_broccoli_skillet", staple: "quinoa" };
    const next = editedPicks(draft, after, picks);
    expect(next.days[0].lunch.main).toEqual(after.days[0].lunch.main);
    expect(next.days[2].dinner.main).toEqual({ dish: "salmon_broccoli_skillet", staple: "quinoa" });
    expect(next.days[1]).toEqual(picks.days[1]);
    // The staple of the new fresh main survives the revision a redraft starts from.
    expect(revisionPicks(after, next).days[2].dinner.main).toEqual({ dish: "salmon_broccoli_skillet", staple: "quinoa" });
  });

  test("without picks, the draft before the edit stands in for them", () => {
    const { draft } = base();
    const next = editedPicks(draft, withRaw(draft, { beef: 400 }), undefined);
    expect(next.batches.find((b) => b.id === "beef")?.rawG).toBe(400);
    expect(next.days.every((d) => d.breakfast === "")).toBe(true);
  });

  test("a redraft after a profile change keeps the pot's rawG", () => {
    const { draft, picks } = base();
    const after = withRaw(draft, { chicken: 600, beef: 400 });
    const nextPicks = editedPicks(draft, after, picks);
    const state = fixture();
    const before = state.charter!.profile;
    // Day 1's apple, now refused, makes the program fill the draft again.
    const lib = planLibrary(before);
    const profile: Profile = { ...before, dislikes: [...before.dislikes, "apple"] };
    const start = state.plan!.planner!.start;
    const r = redraft(after, nextPicks, draftContext(profile, computeTargets(profile, "other"), start, after.days.length), lib);
    expect(r.kind).toBe("redrafted");
    if (r.kind !== "redrafted") return;
    expect(r.result.draft.batches.find((b) => b.id === "chicken")?.rawG).toBe(600);
    expect(r.result.draft.batches.find((b) => b.id === "beef")?.rawG).toBe(400);
    expect(r.picks.batches.find((b) => b.id === "chicken")?.rawG).toBe(600);
    const solved = r.result.plan!;
    expect(Math.round(proteinOf(solved.batches.find((b) => b.id === "chicken")!.lines, "chicken_breast"))).toBe(600);
  });
});

test("a draft without rawG solves as before", () => {
  const state = fixture();
  const profile = state.charter!.profile;
  const plan = state.plan!;
  const draft = parseDraft(plan.planner!.draft);
  const ctx = draftContext(profile, computeTargets(profile, "other"), plan.planner!.start, draft.days.length);
  const result = checkDraft(draft, ctx);
  expect(result.plan).not.toBeNull();
  expect(Math.round(proteinOf(result.plan!.batches.find((b) => b.id === "chicken")!.lines, "chicken_breast"))).toBe(500);
});
