// The meals writes (src/info/meals/apply.ts): Apply on a plan card, a profile
// written straight through, a deviation, and what the AI is told afterwards.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  applyPlan,
  deviationNote,
  planNote,
  recordDeviation,
  refreshPhotos,
  saveProfile,
  type MealsPorts,
} from "../../../src/info/meals/apply";
import type { MealsPlanCardData } from "../../../src/info/meals/cards";
import type { PhotoQuery } from "../../../src/info/meals/photo-run";
import { currentList, deriveShoppingList, shoppingItemKey } from "../../../src/info/meals/shopping";
import { solvePlan, targetsOf } from "../../../src/info/meals/solve-week";
import type {
  Deviation,
  DishPhotoEntry,
  MealsCharter,
  MealsState,
  ShoppingState,
  WeekPlan,
} from "../../../src/info/meals/types";
import { mealOn } from "../../../src/info/meals/week";
import { MON, charter, draftWeek, profile, shopping, state, week } from "./fixtures/week";

interface Harness {
  ports: MealsPorts;
  saved: { plan: WeekPlan | null; shopping: ShoppingState | null };
  charters: { charter: MealsCharter; week: { plan: WeekPlan; shopping: ShoppingState } | null }[];
  deviations: Deviation[];
  reloads: number;
}

function harness(over: Partial<MealsState> = {}, fail = false): Harness {
  const current = state(over);
  const h: Harness = {
    saved: { plan: null, shopping: null },
    charters: [],
    deviations: [],
    reloads: 0,
    ports: null as unknown as MealsPorts,
  };
  h.ports = {
    current: async () => current,
    saveCharter: async (c, w) => {
      if (fail) throw new Error("no");
      h.charters.push({ charter: c, week: w });
    },
    savePlan: async (plan, list) => {
      if (fail) throw new Error("no");
      h.saved = { plan, shopping: list };
    },
    saveShopping: async (list) => {
      h.saved.shopping = list;
    },
    saveMealMethod: async () => {},
    saveDeviation: async (deviation, plan, list) => {
      if (fail) throw new Error("no");
      h.deviations.push(deviation);
      h.saved = { plan, shopping: list };
    },
    region: () => "other",
    now: () => 100,
    today: () => MON,
    changed: () => {
      h.reloads += 1;
    },
  };
  return h;
}

function planCard(over: Partial<MealsPlanCardData> = {}): MealsPlanCardData {
  const plan = draftWeek();
  return {
    kind: "meals-plan",
    threadId: "meals",
    startDate: plan.startDate,
    days: plan.days,
    adjustment: false,
    changed: [],
    changedDates: [],
    phase: "proposed",
    ...over,
  };
}

// The week as the program solves it for a profile.
function solvedFor(over: Parameters<typeof profile>[0]): WeekPlan {
  const c = charter(over);
  return solvePlan(draftWeek(), targetsOf(c, "other")!, c.profile);
}

test("applying a plan writes the week with its grams solved and the list derived from them", async () => {
  const h = harness({ plan: null });
  const applied = await applyPlan(planCard(), h.ports);
  await applied.pending;
  expect(applied.ok).toBe(true);
  expect(h.saved.plan!.days).toEqual(week().days);
  expect(h.saved.plan!.revision).toBe(1);
  expect(mealOn(h.saved.plan, MON, "lunch")!.solved!.length).toBe(5);
  const list = currentList(h.saved.shopping!);
  expect(list).toEqual(deriveShoppingList(week(), MON, 1));
  expect(list.find((i) => i.foodId === "salmon")?.qty).toBe("240 g");
  expect(h.reloads).toBe(1);
  expect(applied.note).toContain(`${list.length} things`);
});

test("Apply re-solves against the profile as it is now, not the one the card was drafted for", async () => {
  // The card carries grams solved for 60 kg; the reader has since said 80.
  const h = harness({ charter: charter({ weightKg: 80 }) });
  await (await applyPlan(planCard({ days: week().days, adjustment: true }), h.ports)).pending;
  const heavier = solvedFor({ weightKg: 80 });
  expect(h.saved.plan!.days).toEqual(heavier.days);
  expect(h.saved.plan!.days).not.toEqual(week().days);
  expect(currentList(h.saved.shopping!)).toEqual(deriveShoppingList(heavier, MON, 1));
  // An adjustment keeps the week's identity and counts one more revision.
  expect(h.saved.plan!.revision).toBe(2);
});

test("a re-derive keeps the ticks and the reader's own lines", async () => {
  const salmon = deriveShoppingList(week(), MON, 1).find((i) => i.foodId === "salmon")!;
  const before = shopping({
    items: [],
    reader: [
      {
        name: "milk",
        en: "milk",
        qty: "two",
        category: "other",
        keeps: "w1",
        freezeOnArrival: false,
        neededBy: "",
        source: "reader",
      },
    ],
    checked: { [shoppingItemKey(salmon)]: true },
  });
  const h = harness({ shopping: before });
  await (await applyPlan(planCard({ adjustment: true }), h.ports)).pending;
  const list = currentList(h.saved.shopping!);
  expect(list.map((i) => i.name)).toContain("milk");
  expect(h.saved.shopping!.checked).toEqual(before.checked);
});

test("a second Apply does nothing", async () => {
  const h = harness();
  const applied = await applyPlan(planCard({ phase: "applied" }), h.ports);
  expect(applied.ok).toBe(false);
  expect(h.saved.plan).toBeNull();
});

test("a failed write changes nothing on screen", async () => {
  const h = harness({}, true);
  const applied = await applyPlan(planCard(), h.ports);
  expect(applied.ok).toBe(false);
  expect(h.reloads).toBe(0);
});

// --- the profile --------------------------------------------------------------

test("a new profile re-solves the week and re-derives the list in the same write", async () => {
  const salmon = deriveShoppingList(week(), MON, 1).find((i) => i.foodId === "salmon")!;
  const h = harness({ shopping: shopping({ items: deriveShoppingList(week(), MON, 1), checked: { [shoppingItemKey(salmon)]: true } }) });
  const out = await saveProfile(profile({ weightKg: 80 }), h.ports);
  expect(out.ok).toBe(true);
  expect(out.targets).toEqual(targetsOf(charter({ weightKg: 80 }), "other"));

  expect(h.charters).toHaveLength(1);
  const written = h.charters[0]!;
  expect(written.charter.profile.weightKg).toBe(80);
  expect(written.charter.updatedAt).toBe(100);
  // No new words: what they said before is kept.
  expect(written.charter.text).toBe(charter().text);

  const heavier = solvedFor({ weightKg: 80 });
  expect(written.week!.plan.days).toEqual(heavier.days);
  expect(written.week!.plan.revision).toBe(week().revision + 1);
  expect(written.week!.shopping.items).toEqual(deriveShoppingList(heavier, MON, 1));
  expect(written.week!.shopping.checked).toEqual({ [shoppingItemKey(salmon)]: true });
  expect(h.reloads).toBe(1);
});

test("onboarding with no week writes the profile alone, with the reader's words", async () => {
  const h = harness({ charter: null, plan: null });
  const out = await saveProfile(profile({ goal: "cut" }), h.ports, "Two of us on weekends.");
  expect(out.ok).toBe(true);
  expect(out.targets).not.toBeNull();
  expect(h.charters[0]!.week).toBeNull();
  expect(h.charters[0]!.charter.text).toBe("Two of us on weekends.");
});

test("a reader who withholds body data gets no targets", async () => {
  const h = harness();
  const out = await saveProfile(profile({ consent: "no" }), h.ports);
  expect(out).toEqual({ ok: true, targets: null });
});

test("a profile that could not be written reports no targets and does not reload", async () => {
  const h = harness({}, true);
  expect(await saveProfile(profile({ weightKg: 80 }), h.ports)).toEqual({ ok: false, targets: null });
  expect(h.reloads).toBe(0);
});

// --- a deviation ----------------------------------------------------------------

test("a recorded deviation names the meal, re-solves the week and re-derives the list", async () => {
  const h = harness();
  const { ok, attention, note } = await recordDeviation(
    {
      date: MON,
      meal: "dinner",
      said: "ordered in",
      became: "delivery",
      place: "the usual place",
      changed: "",
      at: 0,
    },
    h.ports,
  );
  expect(ok).toBe(true);
  expect(attention).toEqual([{ date: "2026-09-22", meal: "breakfast" }]);
  expect(h.deviations[0]!.changed).toBe("2026-09-22 breakfast now needs another look.");
  expect(h.deviations[0]!.at).toBe(100);
  expect(note).toContain("2026-09-22 breakfast");

  const plan = h.saved.plan!;
  expect(mealOn(plan, MON, "dinner")).toEqual({ mode: "delivery", place: "the usual place" });
  // Monday's salmon is no longer bought.
  const salmon = (s: ShoppingState) => currentList(s).find((i) => i.foodId === "salmon")!.grams!;
  expect(salmon(h.saved.shopping!)).toBeLessThan(salmon(shopping({ items: deriveShoppingList(week(), MON, 1) })));
  expect(currentList(h.saved.shopping!)).toEqual(deriveShoppingList(plan, MON, 1));
});

test("a skipped snack hands back the next main meal the reader's day eats", async () => {
  const h = harness();
  const { attention } = await recordDeviation(
    { date: "2026-09-22", meal: "snack", said: "not hungry", became: "skip", changed: "", at: 0 },
    h.ports,
  );
  expect(attention).toEqual([{ date: "2026-09-22", meal: "dinner" }]);
});

test("nothing is recorded against a week that does not exist", async () => {
  const h = harness({ plan: null });
  const out = await recordDeviation(
    { date: MON, meal: "lunch", said: "x", became: "out", changed: "", at: 0 },
    h.ports,
  );
  expect(out.ok).toBe(false);
  expect(h.deviations).toEqual([]);
});

test("the notes are said in the reader's voice and never read the list back", () => {
  const list = shopping({
    items: [
      {
        name: "三文鱼",
        en: "salmon",
        qty: "240 g",
        category: "protein",
        keeps: "d1-2",
        freezeOnArrival: true,
        neededBy: MON,
      },
    ],
  });
  expect(planNote(planCard(), list)).toContain("1 things, 1 to freeze");
  expect(planNote(planCard(), list)).toContain("Don't read it back");
  expect(
    planNote(planCard({ adjustment: true, changed: [{ date: MON, meal: "lunch" }] }), list),
  ).toContain("2026-09-21 lunch");
  expect(
    deviationNote(
      { date: MON, meal: "lunch", said: "canteen", became: "out", changed: "", at: 0 },
      [],
    ),
  ).toContain("Nothing else needs to change");
});

// --- the photographs ----------------------------------------------------------
//
// The search runs on the machine with a hidden webview, which is usually not
// the one the reader is holding (docs/73 图片, pitfall 380). So the port that
// starts a run is present only there, and what the reader asks for travels as a
// time written on the week.

function found(at: number): DishPhotoEntry {
  return {
    url: "https://cdn.example/a.jpg",
    thumb: "",
    pageUrl: "https://example.com/a",
    site: "example.com",
    foundAt: at,
  };
}

// A harness that can search, and the names it was asked to search for.
function searching(h: Harness): string[][] {
  const asked: string[][] = [];
  h.ports.startPhotoRun = async (_planId: string, queries: readonly PhotoQuery[]) => {
    asked.push(queries.map((q) => q.key));
  };
  return asked;
}

test("the machine the reader is holding starts no search and still applies the week", async () => {
  const h = harness({ plan: null });
  const applied = await applyPlan(planCard(), h.ports);
  await applied.pending;
  expect(applied.ok).toBe(true);
  expect(h.saved.plan).not.toBeNull();
});

test("applying a week on the machine that searches asks for what it is missing", async () => {
  const h = harness({ plan: null });
  const asked = searching(h);
  await (await applyPlan(planCard(), h.ports)).pending;
  expect(asked[0]).toContain("dish:shrimp rice bowl");
});

// The reader said a picture is wrong before this week was applied: a picture
// found before they said so is looked for again.
test("a week applied after the reader asked is searched from before their ask", async () => {
  const h = harness({ plan: null, photosAskedAt: 500 });
  h.ports.photos = async () => ({ "dish:shrimp rice bowl": found(400) });
  const asked = searching(h);
  await (await applyPlan(planCard(), h.ports)).pending;
  expect(asked[0]).toContain("dish:shrimp rice bowl");

  const after = harness({ plan: null, photosAskedAt: 300 });
  after.ports.photos = async () => ({ "dish:shrimp rice bowl": found(400) });
  const later = searching(after);
  await (await applyPlan(planCard(), after.ports)).pending;
  expect(later[0]).not.toContain("dish:shrimp rice bowl");
});

test("asking for better pictures writes down when they asked, wherever they are", async () => {
  const h = harness();
  const at: number[] = [];
  h.ports.markPhotosAsked = async (when) => {
    at.push(when);
  };
  const result = await refreshPhotos(h.ports);
  expect(at).toEqual([100]);
  // Nothing was started here: this machine cannot search, and the time it just
  // wrote down is what reaches the machine that can.
  expect(result.searching).toBe(false);
  expect(result.queries).toBeGreaterThan(0);
});

test("on the machine that searches, asking again starts the run itself", async () => {
  const h = harness();
  h.ports.markPhotosAsked = async () => {};
  const asked = searching(h);
  const result = await refreshPhotos(h.ports);
  expect(result.searching).toBe(true);
  expect(asked[0]?.length).toBe(result.queries);
});

test("an ask that could not be written down is not reported as asked", async () => {
  const h = harness();
  h.ports.markPhotosAsked = async () => {
    throw new Error("no");
  };
  const asked = searching(h);
  expect(await refreshPhotos(h.ports)).toEqual({ queries: 0, searching: false });
  expect(asked).toEqual([]);

  // No week is nothing to search for either, and nothing is written down.
  const none = harness({ plan: null });
  let wrote = false;
  none.ports.markPhotosAsked = async () => {
    wrote = true;
  };
  expect(await refreshPhotos(none.ports)).toEqual({ queries: 0, searching: false });
  expect(wrote).toBe(false);
});
