// What Apply on a dinner card does (src/info/dinner/apply.ts): the only write
// in the line, the guard against a second click, and the synthetic turn the AI
// is told afterwards.
// Run: scripts/t.sh tests/info/dinner

import { expect, test } from "bun:test";
import {
  applyCharter,
  applyPlan,
  recordDeviation,
  refreshPhotos,
  type DinnerPorts,
} from "../../../src/info/dinner/apply";
import type { DinnerCharterCardData, DinnerPlanCardData } from "../../../src/info/dinner/cards";
import { EMPTY_DINNER, type DinnerState, type ShoppingItem, type WeekPlan } from "../../../src/info/dinner/types";

const MON = "2026-09-21";

function week(over: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: `week-${MON}`,
    startDate: MON,
    days: [
      { date: "2026-09-21", mode: "cook", dishId: "dish-a" },
      { date: "2026-09-22", mode: "reheat", reheatOf: "2026-09-21" },
      { date: "2026-09-23", mode: "out" },
      { date: "2026-09-24", mode: "out" },
      { date: "2026-09-25", mode: "out" },
      { date: "2026-09-26", mode: "out" },
      { date: "2026-09-27", mode: "cook", dishId: "dish-b" },
    ],
    dishes: [
      {
        id: "dish-a",
        name: "Traybake",
        searchName: "chicken traybake",
        oneLine: "",
        base: "b",
        fresh: "f",
        keepsADay: true,
        handsOnMinutes: 10,
        ingredients: [{ name: "chicken", en: "chicken", qty: "600g", category: "protein", keeps: "d1-2" }],
      },
      {
        id: "dish-b",
        name: "Sea bass",
        searchName: "baked sea bass",
        oneLine: "",
        base: "b",
        fresh: "",
        keepsADay: false,
        handsOnMinutes: 10,
        ingredients: [{ name: "sea bass", en: "sea bass", qty: "2", category: "protein", keeps: "d1-2" }],
      },
    ],
    createdAt: 1,
    revision: 2,
    ...over,
  };
}

interface Fake {
  ports: DinnerPorts;
  state: DinnerState;
  saved: { plan: WeekPlan | null; shopping: ShoppingItem[] };
  changed: number;
}

function fake(state: DinnerState = { ...EMPTY_DINNER }, fail = false): Fake {
  const f: Fake = {
    state,
    saved: { plan: null, shopping: [] },
    changed: 0,
    ports: {
      current: async () => f.state,
      saveCharter: async (charter) => {
        if (fail) throw new Error("disk");
        f.state = { ...f.state, charter };
      },
      savePlan: async (plan, shopping) => {
        if (fail) throw new Error("disk");
        f.saved = { plan, shopping: [...shopping] };
        f.state = { ...f.state, plan, shopping: [...shopping] };
      },
      saveDeviation: async (deviation, plan, shopping) => {
        if (fail) throw new Error("disk");
        f.saved = { plan, shopping: [...shopping] };
        f.state = {
          ...f.state,
          plan,
          shopping: [...shopping],
          deviations: [...f.state.deviations, deviation],
        };
      },
      now: () => 500,
      today: () => MON,
      changed: () => {
        f.changed += 1;
      },
    },
  };
  return f;
}

function charterCard(over: Partial<DinnerCharterCardData> = {}): DinnerCharterCardData {
  return {
    kind: "dinner-charter",
    threadId: "t",
    people: 2,
    stores: ["the market"],
    kitchen: "two burners",
    dislikes: [],
    nightsCooking: 4,
    nightsOut: 1,
    nightsDelivery: 2,
    text: "two of us, cooking most nights",
    phase: "proposed",
    ...over,
  };
}

function planCard(over: Partial<DinnerPlanCardData> = {}): DinnerPlanCardData {
  const w = week();
  return {
    kind: "dinner-plan",
    threadId: "t",
    startDate: w.startDate,
    days: w.days,
    dishes: w.dishes,
    adjustment: false,
    changedDates: [],
    phase: "proposed",
    ...over,
  };
}

test("applying the charter writes it with the host's clock on it", async () => {
  const f = fake();
  const { ok, note } = await applyCharter(charterCard(), f.ports);
  expect(ok).toBe(true);
  expect(f.state.charter?.updatedAt).toBe(500);
  expect(note).toContain("two of us");
  expect(f.changed).toBe(1);
});

test("a second click on an applied card writes nothing and says nothing", async () => {
  const f = fake();
  expect(await applyCharter(charterCard({ phase: "applied" }), f.ports)).toEqual({
    ok: false,
    note: "",
  });
  expect(await applyPlan(planCard({ phase: "applied" }), f.ports)).toEqual({ ok: false, note: "" });
  expect(f.changed).toBe(0);
});

test("a failed write changes nothing on screen", async () => {
  const f = fake({ ...EMPTY_DINNER }, true);
  expect((await applyPlan(planCard(), f.ports)).ok).toBe(false);
  expect(f.changed).toBe(0);
  expect(f.state.plan).toBeNull();
});

test("applying a week derives its shopping list; the model never wrote one", async () => {
  const f = fake();
  const { ok, note } = await applyPlan(planCard(), f.ports);
  expect(ok).toBe(true);
  expect(f.saved.shopping.map((i) => i.name)).toEqual(["chicken", "sea bass"]);
  // Sunday's fish is six days out: it is frozen on the way home.
  expect(f.saved.shopping.map((i) => i.freezeOnArrival)).toEqual([false, true]);
  expect(note).toContain("2 things");
  expect(note).toContain("1 to freeze");
});

test("an adjustment keeps the week's own age and what was already ticked off", async () => {
  const f = fake();
  await applyPlan(planCard(), f.ports);
  f.state = {
    ...f.state,
    shopping: f.state.shopping.map((i) =>
      i.name === "chicken" ? { ...i, checked: true } : i,
    ),
  };
  const { note } = await applyPlan(
    planCard({ adjustment: true, changedDates: ["2026-09-22"] }),
    f.ports,
  );
  expect(f.saved.plan?.createdAt).toBe(500);
  expect(f.saved.plan?.revision).toBe(2);
  expect(f.saved.shopping.find((i) => i.name === "chicken")?.checked).toBe(true);
  expect(note).toContain("2026-09-22");
});

test("a night that went differently is recorded and names only the days left open", async () => {
  const f = fake({ ...EMPTY_DINNER, plan: week() });
  const { ok, note, attention } = await recordDeviation(
    { date: MON, said: "ordered in tonight", became: "delivery", changed: "", at: 0 },
    f.ports,
  );
  expect(ok).toBe(true);
  expect(attention).toEqual(["2026-09-22"]);
  expect(f.state.deviations[0]?.changed).toContain("2026-09-22");
  expect(f.state.deviations[0]?.at).toBe(500);
  expect(note).toContain("sort out those days only");
  // The rest of the week is untouched, and the fish is still on the list.
  expect(f.saved.plan?.days[6]?.dishId).toBe("dish-b");
});

test("a deviation with no week to move writes nothing", async () => {
  const f = fake();
  const out = await recordDeviation(
    { date: MON, said: "ordered in", became: "delivery", changed: "", at: 0 },
    f.ports,
  );
  expect(out.ok).toBe(false);
  expect(f.changed).toBe(0);
});

test("Apply writes the week, then asks for the photographs it has none of", async () => {
  const f = fake();
  const started: { planId: string; queries: { key: string; q: string }[] }[] = [];
  const ports: DinnerPorts = {
    ...f.ports,
    photos: async () => ({
      "dish:chicken traybake": {
        url: "https://cdn.example/traybake.jpg",
        thumb: "",
        pageUrl: "https://example.com/traybake",
        site: "example.com",
        foundAt: 1,
      },
    }),
    bankImage: () => null,
    startPhotoRun: async (planId, queries) => {
      started.push({ planId, queries: [...queries] });
    },
  };

  const applied = await applyPlan(planCard(), ports);
  expect(applied.ok).toBe(true);
  expect(f.changed).toBe(1);
  // The picture already in the cache is on the week as it is written; only the
  // names nobody has searched for wait for the run.
  expect(f.saved.plan?.dishes[0]?.image).toBe("https://cdn.example/traybake.jpg");
  await applied.pending;
  expect(started.length).toBe(1);
  expect(started[0]?.planId).toBe(`week-${MON}`);
  expect(started[0]?.queries.map((q) => q.key)).toEqual([
    "dish:baked sea bass",
    "ingredient:chicken",
    "ingredient:sea bass",
  ]);
});

test("a host that cannot start runs still applies the week", async () => {
  const f = fake();
  const applied = await applyPlan(planCard(), f.ports);
  expect(applied.ok).toBe(true);
  await applied.pending;
  expect(f.saved.plan?.dishes.length).toBe(2);
});

test("asking again searches the whole week, the cache ignored", async () => {
  const f = fake(
    { ...EMPTY_DINNER, plan: week(), shopping: [] },
    false,
  );
  const started: { key: string; q: string }[][] = [];
  const ports: DinnerPorts = {
    ...f.ports,
    photos: async () => ({ "dish:baked sea bass": { none: true as const, checkedAt: 499 } }),
    bankImage: () => null,
    startPhotoRun: async (_planId, queries) => {
      started.push([...queries]);
    },
  };
  expect(await refreshPhotos(ports)).toBe(4);
  expect(started[0]?.map((q) => q.key)).toEqual([
    "dish:chicken traybake",
    "dish:baked sea bass",
    "ingredient:chicken",
    "ingredient:sea bass",
  ]);
});

test("asking again with no week planned asks for nothing", async () => {
  const f = fake();
  expect(await refreshPhotos({ ...f.ports, startPhotoRun: async () => {} })).toBe(0);
});
