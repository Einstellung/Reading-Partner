// What Apply on a meals card writes (src/info/meals/apply.ts), and what the AI
// is told afterwards.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  applyCharter,
  applyPlan,
  deviationNote,
  planNote,
  recordDeviation,
  refreshPhotos,
  type MealsPorts,
} from "../../../src/info/meals/apply";
import type {
  MealsCharterCardData,
  MealsPlanCardData,
} from "../../../src/info/meals/cards";
import type { PhotoQuery } from "../../../src/info/meals/photo-run";
import { currentList, shoppingItemKey } from "../../../src/info/meals/shopping";
import type {
  Deviation,
  DishMethod,
  DishPhotoEntry,
  MealsState,
  ShoppingState,
  WeekPlan,
} from "../../../src/info/meals/types";
import { MON, shopping, state, week } from "./fixtures/week";

interface Harness {
  ports: MealsPorts;
  saved: { plan: WeekPlan | null; shopping: ShoppingState | null };
  deviations: Deviation[];
  methods: { dishId: string; method: DishMethod }[];
  reloads: number;
}

function harness(over: Partial<MealsState> = {}, fail = false): Harness {
  const current = state(over);
  const h: Harness = {
    saved: { plan: null, shopping: null },
    deviations: [],
    methods: [],
    reloads: 0,
    ports: null as unknown as MealsPorts,
  };
  h.ports = {
    current: async () => current,
    saveCharter: async () => {
      if (fail) throw new Error("no");
    },
    savePlan: async (plan, list) => {
      if (fail) throw new Error("no");
      h.saved = { plan, shopping: list };
    },
    saveShopping: async (list) => {
      h.saved.shopping = list;
    },
    saveDeviation: async (deviation, plan, list) => {
      if (fail) throw new Error("no");
      h.deviations.push(deviation);
      h.saved = { plan, shopping: list };
    },
    saveDishMethod: async (dishId, method) => {
      h.methods.push({ dishId, method });
    },
    now: () => 100,
    today: () => MON,
    changed: () => {
      h.reloads += 1;
    },
  };
  return h;
}

function planCard(over: Partial<MealsPlanCardData> = {}): MealsPlanCardData {
  const plan = week();
  return {
    kind: "meals-plan",
    threadId: "meals",
    startDate: plan.startDate,
    days: plan.days,
    dishes: plan.dishes,
    breakfastLine: plan.breakfastLine,
    adjustment: false,
    changed: [],
    changedDates: [],
    phase: "proposed",
    ...over,
  };
}

test("applying a plan writes the week and the list derived from three meals a day", async () => {
  const h = harness({ plan: null });
  const applied = await applyPlan(planCard(), h.ports);
  await applied.pending;
  expect(applied.ok).toBe(true);
  expect(h.saved.plan?.breakfastLine).toBe("Oats most days, something on the way on Friday");
  expect(currentList(h.saved.shopping!).map((i) => i.name).sort()).toEqual([
    "chickpeas",
    "kale",
    "oats",
    "salmon",
    "yogurt",
  ]);
  expect(h.reloads).toBe(1);
  expect(applied.note).toContain("5 things");
});

test("a re-derive keeps the ticks and the reader's own lines", async () => {
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
    checked: { [shoppingItemKey({ name: "kale", category: "produce" })]: true },
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

test("the charter card replaces the household", async () => {
  const h = harness();
  const card: MealsCharterCardData = {
    kind: "meals-charter",
    threadId: "meals",
    people: 2,
    stores: ["the market"],
    kitchen: "one pan",
    dislikes: ["celery"],
    nightsCooking: 4,
    nightsOut: 1,
    nightsDelivery: 1,
    text: "Two of us. Breakfast at home.",
    phase: "proposed",
  };
  const applied = await applyCharter(card, h.ports);
  expect(applied.ok).toBe(true);
  expect(applied.note).toContain("Two of us");
});

test("a recorded deviation names the meal, not the day", async () => {
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
  expect(attention).toEqual([{ date: "2026-09-22", meal: "lunch" }]);
  expect(h.deviations[0]!.changed).toBe("2026-09-22 lunch now needs another look.");
  expect(h.deviations[0]!.at).toBe(100);
  expect(note).toContain("2026-09-22 lunch");
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
        name: "salmon",
        en: "salmon",
        qty: "2",
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
  expect(asked[0]).toContain("dish:chickpea stew");
});

// The reader said a picture is wrong before this week was applied: a picture
// found before they said so is looked for again.
test("a week applied after the reader asked is searched from before their ask", async () => {
  const h = harness({ plan: null, photosAskedAt: 500 });
  h.ports.photos = async () => ({ "dish:chickpea stew": found(400) });
  const asked = searching(h);
  await (await applyPlan(planCard(), h.ports)).pending;
  expect(asked[0]).toContain("dish:chickpea stew");

  const after = harness({ plan: null, photosAskedAt: 300 });
  after.ports.photos = async () => ({ "dish:chickpea stew": found(400) });
  const later = searching(after);
  await (await applyPlan(planCard(), after.ports)).pending;
  expect(later[0]).not.toContain("dish:chickpea stew");
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
