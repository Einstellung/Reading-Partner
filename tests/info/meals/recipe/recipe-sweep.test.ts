// Writing the week's recipes in the background (src/info/meals/recipe/recipe-sweep.ts).
//
// The page used to write a recipe on first open, with the reader waiting on
// the call. The sweep writes them ahead, soonest meal first, under the very
// key the page reads.
// Run: scripts/t.sh tests/info/meals/recipe

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { recipeRequest, type RecipeRequest } from "../../../../src/info/meals/recipe/recipe";
import {
  createRecipeWriter,
  MAX_RECIPES_PER_ROUND,
  RECIPE_BACKOFF_MAX_MS,
  RECIPE_BACKOFF_MS,
  recipeBackoffAfter,
  recipesToWrite,
  watchMealsForRecipes,
  type RecipeSweepPorts,
} from "../../../../src/info/meals/recipe/recipe-sweep";
import { MEALS_FILE } from "../../../../src/info/meals/plan/store";
import type { MealsState } from "../../../../src/info/meals/plan/types";
import { addDays } from "../../../../src/info/meals/plan/week";
import { dayViewOn } from "../../../../src/info/meals/screen/view";
import { dispatchPull } from "../../../../src/platform/sync/pull-routes";
import { MON, potWeek, state } from "../fixtures/week";

let before: Locale;

beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});

afterEach(() => setLocale(before));

const opts = (over: Partial<Parameters<typeof recipesToWrite>[1]> = {}) => ({
  today: MON,
  region: "other" as const,
  language: "zh-CN" as const,
  stored: new Set<string>(),
  ...over,
});

// Every request the page would make for the week from `today` on, day by day
// in eaten order, the way MealsRecipe.tsx builds one.
function pageRequests(s: MealsState, today: string): RecipeRequest[] {
  const out: RecipeRequest[] = [];
  for (const day of s.plan!.days) {
    if (day.date < today) continue;
    const view = dayViewOn(s, day.date, today, "other")!;
    for (const meal of view.meals) {
      const req = recipeRequest(meal, s.charter!.profile, "zh-CN");
      if (req && !out.some((r) => r.key === req.key)) out.push(req);
    }
  }
  return out;
}

test("the requests are the page's own, same key, soonest first, capped", () => {
  const s = state();
  const wanted = recipesToWrite(s, opts());
  expect(wanted).toHaveLength(MAX_RECIPES_PER_ROUND);
  expect(wanted).toEqual(pageRequests(s, MON).slice(0, MAX_RECIPES_PER_ROUND));
  // Monday's made meals first, in the order the day is eaten.
  const monday = dayViewOn(s, MON, MON, "other")!.meals.filter((m) => m.mode === "make" && m.rows.length > 0);
  expect(wanted.slice(0, monday.length).map((r) => r.name)).toEqual(monday.map((m) => m.name));
});

test("pot meals get the page's key: cooking the pot and eating a box", () => {
  const s = state({ plan: potWeek() });
  const all = recipesToWrite(s, opts({ limit: 100 }));
  expect(all).toEqual(pageRequests(s, MON));
  const cook = all.find((r) => r.pot?.cooks);
  const eat = all.find((r) => r.pot && !r.pot.cooks);
  expect(cook?.name).toBe("卤牛腱配馒头");
  expect(eat).toBeDefined();
  // The page's own request for Monday's dinner, built the way MealsRecipe.tsx builds it.
  const dinner = dayViewOn(s, MON, MON, "other")!.meals.find((m) => m.key === "dinner")!;
  expect(cook!.key).toBe(recipeRequest(dinner, s.charter!.profile, "zh-CN")!.key);
});

test("eating out, takeaway, ready-made and skipped meals get nothing", () => {
  const s = state();
  const all = recipesToWrite(s, opts({ limit: 100 }));
  const names = new Set(all.map((r) => r.name));
  expect(names.has("the usual place")).toBe(false);
  expect(names.has("coffee on the way")).toBe(false);
  for (const r of all) expect(r.rows.length).toBeGreaterThan(0);
});

test("stored keys and past days are left out, and the same dish twice is one request", () => {
  const s = state();
  const all = recipesToWrite(s, opts({ limit: 100 }));
  expect(new Set(all.map((r) => r.key)).size).toBe(all.length);
  const wed = addDays(MON, 2);
  const fromWed = recipesToWrite(s, opts({ today: wed, limit: 100 }));
  expect(fromWed).toEqual(pageRequests(s, wed));
  const stored = new Set(all.slice(0, 3).map((r) => r.key));
  const rest = recipesToWrite(s, opts({ stored, limit: 100 }));
  expect(rest).toEqual(all.slice(3));
});

test("no week or no profile wants nothing", () => {
  expect(recipesToWrite(state({ plan: null }), opts())).toEqual([]);
  expect(recipesToWrite(state({ charter: null }), opts())).toEqual([]);
});

test("the wait doubles from 15 minutes and stops at 6 hours", () => {
  expect(recipeBackoffAfter(0)).toBe(0);
  expect(recipeBackoffAfter(1)).toBe(RECIPE_BACKOFF_MS);
  expect(recipeBackoffAfter(2)).toBe(2 * RECIPE_BACKOFF_MS);
  expect(recipeBackoffAfter(20)).toBe(RECIPE_BACKOFF_MAX_MS);
});

// --- the writer ----------------------------------------------------------------

interface Harness {
  ports: RecipeSweepPorts;
  stored: Set<string>;
  written: string[];
  clock: { now: number };
  fail: { next: boolean };
}

function harness(over: { state?: MealsState; write?: RecipeSweepPorts["write"] } = {}): Harness {
  const h: Harness = {
    stored: new Set(),
    written: [],
    clock: { now: 1_000_000 },
    fail: { next: false },
    ports: null as unknown as RecipeSweepPorts,
  };
  h.ports = {
    state: async () => over.state ?? state(),
    language: async () => "zh-CN",
    region: () => "other",
    stored: async () => new Set(h.stored),
    write:
      over.write ??
      (async (req) => {
        if (h.fail.next) throw new Error("provider down");
        h.written.push(req.key);
        h.stored.add(req.key);
      }),
    today: () => MON,
    now: () => h.clock.now,
  };
  return h;
}

test("a round writes the soonest few, one at a time, and the next round the next few", async () => {
  const h = harness();
  const all = recipesToWrite(state(), opts({ limit: 100 }));
  const writer = createRecipeWriter(h.ports);
  expect(await writer.sweep()).toEqual({ written: MAX_RECIPES_PER_ROUND, wanted: MAX_RECIPES_PER_ROUND });
  expect(h.written).toEqual(all.slice(0, MAX_RECIPES_PER_ROUND).map((r) => r.key));
  await writer.sweep();
  expect(h.written).toEqual(all.slice(0, 2 * MAX_RECIPES_PER_ROUND).map((r) => r.key));
});

test("a recipe the other device wrote mid-round is not written again", async () => {
  const h = harness();
  const all = recipesToWrite(state(), opts({ limit: 100 }));
  const ports = h.ports;
  h.ports = {
    ...ports,
    write: async (req) => {
      await ports.write(req);
      // The pull lands right after the first write.
      h.stored.add(all[1]!.key);
    },
  };
  await createRecipeWriter(h.ports).sweep();
  expect(h.written).not.toContain(all[1]!.key);
  expect(h.written[0]).toBe(all[0]!.key);
});

test("a failed call stops the round, writes nothing down, and waits longer each time", async () => {
  const h = harness();
  const writer = createRecipeWriter(h.ports);
  h.fail.next = true;
  expect(await writer.sweep()).toMatchObject({ written: 0, why: "failed" });
  expect(h.stored.size).toBe(0);
  // Within the wait nothing is tried.
  h.clock.now += RECIPE_BACKOFF_MS - 1;
  expect((await writer.sweep()).why).toBe("backing-off");
  // After it, one more try; failing again doubles the wait.
  h.clock.now += 1;
  expect((await writer.sweep()).why).toBe("failed");
  h.clock.now += 2 * RECIPE_BACKOFF_MS - 1;
  expect((await writer.sweep()).why).toBe("backing-off");
  h.clock.now += 1;
  h.fail.next = false;
  expect(await writer.sweep()).toEqual({ written: MAX_RECIPES_PER_ROUND, wanted: MAX_RECIPES_PER_ROUND });
  // A success resets the count: the next failure waits the first wait again.
  h.fail.next = true;
  expect((await writer.sweep()).why).toBe("failed");
  h.clock.now += RECIPE_BACKOFF_MS;
  expect((await writer.sweep()).why).toBe("failed");
});

test("one round at a time; a call during a round runs one more round after it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const h = harness();
  const ports = h.ports;
  h.ports = {
    ...ports,
    write: async (req) => {
      calls += 1;
      if (calls === 1) await gate;
      await ports.write(req);
    },
  };
  const writer = createRecipeWriter(h.ports);
  const first = writer.sweep();
  expect(writer.writing()).toBe(true);
  expect((await writer.sweep()).why).toBe("busy");
  release();
  await first;
  expect(writer.writing()).toBe(false);
  // The first round's six, then the asked-for round's six.
  expect(h.written).toHaveLength(2 * MAX_RECIPES_PER_ROUND);
});

test("nothing left is a round that writes nothing", async () => {
  const h = harness();
  for (const r of recipesToWrite(state(), opts({ limit: 100 }))) h.stored.add(r.key);
  expect((await createRecipeWriter(h.ports).sweep()).why).toBe("nothing-wanted");
  expect(h.written).toEqual([]);
});

test("a round on start and one on a pull of the week, not of other files", async () => {
  let rounds = 0;
  const writer = { sweep: async () => (rounds++, { written: 0, wanted: 0 }), writing: () => false };
  const off = watchMealsForRecipes(writer);
  try {
    expect(rounds).toBe(1);
    dispatchPull([MEALS_FILE]);
    expect(rounds).toBe(2);
    dispatchPull(["info-meals-recipes.json", "settings.json"]);
    expect(rounds).toBe(2);
  } finally {
    off();
  }
});
