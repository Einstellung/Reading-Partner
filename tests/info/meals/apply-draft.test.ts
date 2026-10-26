// The draft card's 「就这样」 (src/info/meals/apply.ts applyDraft): the plan and
// its shopping list in one write, a second click that does nothing, and the
// pictures asked for after the write.
// Run: scripts/t.sh tests/info/meals/apply-draft.test.ts

import { expect, test } from "bun:test";
import { applyDraft, type MealsPorts } from "../../../src/info/meals/apply";
import type { PhotoQuery } from "../../../src/info/meals/photos/photo-run";
import type { DishPhotoEntry, MealsState, ShoppingState, WeekPlan } from "../../../src/info/meals/plan/types";
import { addDays } from "../../../src/info/meals/plan/week";
import { shopping } from "./fixtures/week";
import { draftCard } from "./planner/card-fixture";
import { PROFILE, START } from "./planner/fixture";

interface Harness {
  ports: MealsPorts;
  saved: { plan: WeekPlan; shopping: ShoppingState }[];
  reloads: number;
}

function harness(over: Partial<MealsState> = {}, fail = false): Harness {
  const current: MealsState = {
    charter: { profile: PROFILE, text: "", updatedAt: 1 },
    plan: null,
    shopping: shopping(),
    deviations: [],
    ...over,
  };
  const h: Harness = { saved: [], reloads: 0, ports: null as unknown as MealsPorts };
  h.ports = {
    current: async () => current,
    saveCharter: async () => {},
    savePlan: async (plan, list) => {
      if (fail) throw new Error("no");
      h.saved.push({ plan, shopping: list });
    },
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 100,
    today: () => START,
    changed: () => {
      h.reloads += 1;
    },
  };
  return h;
}

test("confirming writes the plan and the list derived from it in one write, and says so to the model", async () => {
  const h = harness();
  const card = draftCard();
  const out = await applyDraft(card, h.ports);
  await out.pending;
  expect(out.ok).toBe(true);
  expect(h.saved).toHaveLength(1);
  const { plan, shopping: list } = h.saved[0]!;
  expect(plan.days.map((d) => d.date)).toEqual([START, addDays(START, 1), addDays(START, 2)]);
  expect(plan.planner).toEqual({ start: START, draft: card.draft });
  expect(plan.createdAt).toBe(100);
  // A planner plan is bought in whole packs (planner/trip.ts), never as a week's grams.
  expect(list.items.length).toBeGreaterThan(0);
  expect(list.items.every((i) => i.pack)).toBe(true);
  expect(h.reloads).toBe(1);
  expect(out.note).toContain("the 3-day plan is saved");
  expect(out.note).toContain(`${list.items.length} things`);
  // The row left for the model draws nothing: it names the draft it confirmed.
  expect(out.shown).toMatchObject({ kind: "meals-applied", draft: "42", toBuy: list.items.length });
});

test("a card already applied, a reader without targets, or a failed write changes nothing", async () => {
  const applied = harness();
  expect(await applyDraft({ ...draftCard(), phase: "applied" }, applied.ports)).toEqual({ ok: false, note: "" });
  expect(applied.saved).toEqual([]);

  const withheld = harness({ charter: { profile: { ...PROFILE, consent: "no" }, text: "", updatedAt: 1 } });
  expect((await applyDraft(draftCard(), withheld.ports)).ok).toBe(false);
  expect(withheld.saved).toEqual([]);

  const broken = harness({}, true);
  expect((await applyDraft(draftCard(), broken.ports)).ok).toBe(false);
  expect(broken.reloads).toBe(0);
});

test("the draft is checked again against the profile as it is now", async () => {
  // They stopped eating pork after the card was drawn; day 3's lunch is pork.
  const h = harness({ charter: { profile: { ...PROFILE, dislikes: ["pork"] }, text: "", updatedAt: 1 } });
  expect((await applyDraft(draftCard(), h.ports)).ok).toBe(false);
  expect(h.saved).toEqual([]);
});

// --- the photographs ----------------------------------------------------------
//
// The search runs on the machine with a hidden webview, usually not the one in
// the reader's hand (docs/73 图片, pitfall 380): the port that starts it is
// present only there.

function searching(h: Harness): string[][] {
  const asked: string[][] = [];
  h.ports.startPhotoRun = async (_planId: string, queries: readonly PhotoQuery[]) => {
    asked.push(queries.map((q) => q.key));
  };
  return asked;
}

function found(at: number): DishPhotoEntry {
  return { url: "https://cdn.example/a.jpg", thumb: "", pageUrl: "https://example.com/a", site: "example.com", foundAt: at };
}

test("the machine the reader is holding starts no search and still applies the plan", async () => {
  const h = harness();
  const out = await applyDraft(draftCard(), h.ports);
  await out.pending;
  expect(out.ok).toBe(true);
  expect(h.saved).toHaveLength(1);
});

test("on the machine that searches, applying asks for the plan's ingredients and never its dishes", async () => {
  const h = harness();
  const asked = searching(h);
  await (await applyDraft(draftCard(), h.ports)).pending;
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("ingredient:chicken breast");
  expect(asked[0]?.every((k) => k.startsWith("ingredient:"))).toBe(true);
});

test("applying starts drawing the dishes without waiting for them", async () => {
  const h = harness();
  let draws = 0;
  h.ports.drawDishes = () => {
    draws += 1;
    return new Promise<void>(() => {});
  };
  const out = await applyDraft(draftCard(), h.ports);
  await out.pending;
  expect(out.ok).toBe(true);
  expect(draws).toBe(1);
});

test("a picture found before the reader last asked is searched again; one found after is kept", async () => {
  const stale = harness({ photosAskedAt: 500 });
  stale.ports.photos = async () => ({ "ingredient:chicken breast": found(400) });
  const again = searching(stale);
  await (await applyDraft(draftCard(), stale.ports)).pending;
  expect(again[0]).toContain("ingredient:chicken breast");

  const fresh = harness({ photosAskedAt: 300 });
  fresh.ports.photos = async () => ({ "ingredient:chicken breast": found(400) });
  const kept = searching(fresh);
  await (await applyDraft(draftCard(), fresh.ports)).pending;
  expect(kept[0]).not.toContain("ingredient:chicken breast");
});
