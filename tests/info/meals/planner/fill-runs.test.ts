// The drafts the live runs of 2026-10-26 sent (drafts/run4-*, run5-*, run6-*):
// each was refused for something the program can fix itself (docs/671 对话).
// Run: scripts/t.sh tests/info/meals/planner/fill-runs.test.ts

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MealsDraftCardData } from "../../../../src/info/meals/cards";
import { computeTargets, type Profile } from "../../../../src/info/meals/nutrition/targets";
import { DAY_KCAL_FLOOR } from "../../../../src/info/meals/plan/checks";
import { parseDraft, type PlanDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import { PACK_TRIM_SHARE, planDayTargets } from "../../../../src/info/meals/planner/solve";
import { draftOnCard } from "../../../../src/info/meals/tools";

/** A reader like the runs': gaining, training five days, a pressure cooker and a soy-milk maker. */
const PROFILE = {
  consent: "manual",
  goal: "gain",
  sex: "m",
  age: 30,
  heightCm: 172,
  weightKg: 64,
  bodyFatPct: 17.5,
  trainingDays: [1, 2, 4, 5, 6],
  trainTime: "morning",
  work: "sit",
  people: 1,
  shops: [],
  kitchen: ["一口锅", "微波炉", "电压力锅", "豆浆机", "带蒸架的小锅"],
  dislikes: ["avocado", "oats"],
  effort: "simple",
  boxes: true,
} as unknown as Profile;
/** 2026-10-26 is a Monday. */
const ctx = { profile: PROFILE, targets: planDayTargets(computeTargets(PROFILE, "other"), PROFILE, "2026-10-26", 3), startWeekday: 1, people: 1 };

const DIR = join(import.meta.dir, "drafts");
const run = (name: string): PlanDraft => parseDraft(JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")));
const line = (out: ReturnType<typeof fillDraft>, food: string) => out.result.shopping.find((l) => l.food === food);

test("every run draft fills into a passing plan, the same way every time, well under a second", () => {
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    const name = f.replace(/\.json$/, "");
    const t0 = performance.now();
    const a = fillDraft(run(name), ctx);
    const ms = performance.now() - t0;
    expect({ name, problems: a.result.problems.map((p) => p.message) }).toEqual({ name, problems: [] });
    expect(ms).toBeLessThan(1000);
    expect(fillDraft(run(name), ctx).result.draft).toEqual(a.result.draft);
  }
});

test("a pack left over is finished by growing the vegetables that use it, not counted as a leftover", () => {
  // run5-1: a 500 g bag of bok choy, 400 g used, exactly a fifth left.
  const out = fillDraft(run("run5-1"), ctx);
  const bok = line(out, "bok_choy");
  expect(bok?.buy).toMatchObject({ by: "pack", count: 1, packG: 500 });
  expect(bok?.leftover?.grams ?? 0).toBeLessThan(1);
  const grown = out.result.plan!.days.flatMap((d) => [...d.meals.lunch.lines, ...d.meals.dinner.lines]).filter((l) => l.food === "bok_choy");
  expect(Math.max(...grown.map((l) => l.grams))).toBeGreaterThan(200);
});

test("a perishable needed just over one pack is trimmed to the pack instead of buying another", () => {
  // run6-1: white mushrooms at 268 g against a 250 g box.
  expect(PACK_TRIM_SHARE).toBe(0.15);
  const out = fillDraft(run("run6-1"), ctx);
  const mush = line(out, "button_mushroom");
  expect(mush?.buy).toMatchObject({ by: "pack", count: 1, packG: 250 });
  expect(mush!.grams).toBeLessThanOrEqual(250 * 1.02);
  expect(out.result.problems).toEqual([]);
});

test("a day a staple-less pot leaves short of kcal is filled by the other staple, the snack and the breakfast", () => {
  // run5-1 day 3 and run6-3 day 2 eat a pot's way that comes without a staple.
  for (const [name, day] of [["run5-1", 3], ["run6-3", 2]] as const) {
    const d = fillDraft(run(name), ctx).result.plan!.days[day - 1]!;
    expect(d.totals.kcal).toBeGreaterThanOrEqual(DAY_KCAL_FLOOR * d.target.kcal);
  }
});

test("rice fixed one way and a pack left the other: the search finds the change that passes both", () => {
  // run6-2: one rice per plan; moving the beef to its noodle way left 350 g of fresh noodles.
  const out = fillDraft(run("run6-2"), ctx);
  expect(out.result.problems).toEqual([]);
  expect(out.result.shopping.some((l) => l.food === "fresh_noodles")).toBe(false);
  expect(out.changed.join("\n")).toContain("for one_rice");
});

test("a breakfast and a staple they asked for hold across the plan", () => {
  const p = run("run6-4");
  p.asked = { breakfast: "milk_toast_boiled_egg", staple: "white_rice" };
  const out = fillDraft(p, ctx);
  expect(out.result.problems).toEqual([]);
  for (const d of out.result.draft.days) expect(d.breakfast).toBe("milk_toast_boiled_egg");
  const day1 = out.result.draft.days[0]!;
  expect(day1.dinner.main).toMatchObject({ dish: "sesame_chicken_cucumber_salad", staple: "steamed_bun" });
});

test("a revision sees the breakfasts and staples they asked for on the card", () => {
  const picks = run("run6-4");
  picks.days[1]!.breakfast = "soy_milk_bun_tea_egg";
  picks.asked = { staple: "brown_rice" };
  const filled = fillDraft(picks, ctx).result.draft;
  const card = { version: 2, draft: filled, picks } as unknown as MealsDraftCardData;
  const shown = JSON.parse(draftOnCard(card)[2] as string) as PlanDraft;
  expect(shown.asked).toEqual({ staple: "brown_rice" });
  expect(shown.days[1]!.breakfast).toBe("soy_milk_bun_tea_egg");
  expect(shown.days[0]!.breakfast).toBeUndefined();
  expect(shown.days[0]!.dinner.main).toEqual({ dish: "sesame_chicken_cucumber_salad", staple: "steamed_bun" });
});
