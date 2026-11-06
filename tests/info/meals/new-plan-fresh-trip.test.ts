// A newly confirmed plan starts a new trip (src/info/meals/apply.ts applyDraft,
// plan/shopping.ts freshShoppingList); the same plan re-solved keeps the trip
// (saveProfile, reconcileShoppingList). The old state is shaped like the one on
// the reader's disk on 2026-11-01: a plan from 10-23 re-planned on 10-28, two
// drops left from an October trip (橙子, 无糖豆浆), a swap, a tick, a line they
// added, a trip called done, and the old prep's progress.
// Run: scripts/t.sh tests/info/meals/new-plan-fresh-trip.test.ts

import { expect, test } from "bun:test";
import { applyDraft, saveProfile, type MealsPorts } from "../../../src/info/meals/apply";
import { currentList, shoppingItemKey } from "../../../src/info/meals/plan/shopping";
import type { MealsState, ShoppingItem, ShoppingState, WeekPlan } from "../../../src/info/meals/plan/types";
import { weekFromDraft } from "../../../src/info/meals/planner/to-week";
import { plannerShoppingList } from "../../../src/info/meals/planner/trip";
import { checked, draftCard, LIB } from "./planner/card-fixture";
import { PROFILE } from "./planner/fixture";

const TODAY = "2026-11-01";
const OLD_DROPS = { "produce\u0000橙子": true, "dairy\u0000无糖豆浆": true } as const;

interface Written {
  plan: WeekPlan;
  shopping: ShoppingState;
}

function ports(current: MealsState, saved: Written[]): MealsPorts {
  return {
    current: async () => current,
    saveCharter: async (_charter, week) => {
      if (week) saved.push(week);
    },
    savePlan: async (plan, shopping) => {
      saved.push({ plan, shopping });
    },
    saveShopping: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 1_000,
    today: () => TODAY,
    changed: () => {},
  };
}

/** The old plan and its trip, every override the reader can leave on one set. */
function oldState(doneOn: string | null): MealsState {
  const first = weekFromDraft({ result: checked(), lib: LIB, start: "2026-10-23", now: 1, today: "2026-10-23", previous: null });
  const second = weekFromDraft({ result: checked(), lib: LIB, start: "2026-10-29", now: 2, today: "2026-10-28", previous: first });
  const plan: WeekPlan = {
    ...second,
    planner: { ...second.planner!, preppedAt: 3, prepRun: { key: "old-steps", startedAt: 3, steps: {} } },
  };
  const solved = checked();
  const items = plannerShoppingList(solved.plan!, solved.draft, plan, PROFILE.people);
  const bought = items.filter((i) => !i.pack?.onHand);
  const [dropped, swapped, ticked] = bought.map(shoppingItemKey);
  const added: ShoppingItem = { ...bought[0]!, name: "厨房纸", en: "paper towels", source: "reader", ...(doneOn ? { afterDone: true } : {}) };
  return {
    charter: { profile: PROFILE, text: "", updatedAt: 1 },
    plan,
    shopping: {
      items,
      reader: [added],
      dropped: { ...OLD_DROPS, [dropped!]: true },
      replaced: { [swapped!]: { name: "别的", en: "something else", category: bought[1]!.category, keeps: bought[1]!.keeps, qty: "1" } },
      checked: { [ticked!]: true },
      doneOn,
      have: { chicken_breast: 300 },
    },
    deviations: [],
  };
}

async function confirm(state: MealsState): Promise<Written> {
  const saved: Written[] = [];
  const out = await applyDraft(draftCard(), ports(state, saved));
  await out.pending;
  expect(out.ok).toBe(true);
  expect(saved).toHaveLength(1);
  return saved[0]!;
}

test("a plan confirmed over a done trip: the list is the new plan's alone, nothing of the old trip left", async () => {
  const old = oldState("2026-10-24");
  const { plan, shopping } = await confirm(old);
  // The same card confirmed on a disk with no plan and no trip at all.
  const clean = await confirm({ ...old, plan: null, shopping: { items: [], reader: [], dropped: {}, replaced: {}, checked: {}, doneOn: null, have: {} } });

  expect(shopping).toEqual({ items: clean.shopping.items, reader: [], dropped: {}, replaced: {}, checked: {}, doneOn: null, have: {} });
  // Every derived line shows, as derived, unticked: the old drops no longer hide any.
  expect(currentList(shopping)).toEqual(shopping.items);
  // From today on the plan is the new one's days; the old prep's progress is gone with its planner record.
  const ahead = (p: WeekPlan) => p.days.filter((d) => d.date >= TODAY);
  expect(ahead(plan)).toEqual(ahead(clean.plan));
  expect(plan.planner).toEqual(clean.plan.planner);
  expect(plan.planner?.prepRun).toBeUndefined();
  expect(plan.planner?.preppedAt).toBeUndefined();
});

test("a plan confirmed while the old trip is still a list keeps the lines the reader added, and nothing else of it", async () => {
  const old = oldState(null);
  const { shopping } = await confirm(old);
  expect(shopping.reader).toEqual(old.shopping.reader);
  expect(shopping.dropped).toEqual({});
  expect(shopping.replaced).toEqual({});
  expect(shopping.checked).toEqual({});
  expect(shopping.doneOn).toBeNull();
  expect(currentList(shopping)).toEqual([...shopping.items, ...old.shopping.reader]);
});

test("a profile change re-solving the same plan keeps the trip: drops, swaps, ticks, added lines and the done date", async () => {
  const old = oldState("2026-10-31");
  const saved: Written[] = [];
  const out = await saveProfile({ ...PROFILE, weightKg: PROFILE.weightKg + 2 }, ports(old, saved));
  expect(out.ok).toBe(true);
  expect(saved).toHaveLength(1);
  const { plan, shopping } = saved[0]!;
  expect(plan.id).toBe(old.plan!.id);
  expect(plan.planner?.prepRun).toEqual(old.plan!.planner!.prepRun!);
  const { items: _items, ...kept } = shopping;
  const { items: _old, ...was } = old.shopping;
  expect(kept).toEqual(was);
});
