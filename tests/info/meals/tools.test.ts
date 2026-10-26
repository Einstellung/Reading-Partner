// The meals desk's tools (src/info/meals/tools.ts): what the instruction tells
// the model, what the planning tool refuses and sends back, and what the
// profile, shopping and method tools write.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import { validateToolCall } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../src/legion/durable/contract";
import {
  MAX_METHOD_CHARS,
  buildAddShoppingItemsTool,
  buildProposeMealPlanTool,
  buildRecordDeviationTool,
  buildRemoveShoppingItemTool,
  buildReplaceShoppingItemTool,
  buildUpdateProfileTool,
  buildWriteMethodTool,
  markShoppingTripDone,
  mealsGuidance,
  patchProfile,
  type MealsToolDeps,
} from "../../../src/info/meals/tools";
import type { MealsPorts } from "../../../src/info/meals/apply";
import type { MealsCard } from "../../../src/info/meals/cards";
import { currentList, deriveShoppingList } from "../../../src/info/meals/plan/shopping";
import { solvePlan, targetsOf } from "../../../src/info/meals/plan/solve-week";
import {
  EMPTY_MEALS,
  type MealKey,
  type MealsCharter,
  type MealsState,
  type ShoppingState,
  type WeekPlan,
} from "../../../src/info/meals/plan/types";
import { MON, charter, draftWeek, profile, shopping, state, week } from "./fixtures/week";

function deps(current: MealsState): MealsToolDeps & { cards: MealsCard[] } {
  const cards: MealsCard[] = [];
  return {
    cards,
    threadId: "meals",
    state: async () => current,
    today: () => MON,
    now: () => 5,
    region: () => "other",
    onMealsCard: (card) => cards.push(card),
  };
}

interface Ports extends MealsPorts {
  written: ShoppingState[];
  methods: { date: string; meal: MealKey; method: string }[];
  charters: { charter: MealsCharter; week: { plan: WeekPlan; shopping: ShoppingState } | null }[];
}

function ports(current: MealsState): Ports {
  const p: Ports = {
    written: [],
    methods: [],
    charters: [],
    current: async () => current,
    saveCharter: async (charter, week) => {
      p.charters.push({ charter, week });
    },
    savePlan: async () => {},
    saveShopping: async (list: ShoppingState) => {
      p.written.push(list);
      current.shopping = list;
    },
    saveMealMethod: async (date, meal, method) => {
      p.methods.push({ date, meal, method });
    },
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 5,
    today: () => MON,
    changed: () => {},
  };
  return p;
}

/** A tool answers with a string or a result carrying one. */
function said(out: string | { text?: unknown }): string {
  return typeof out === "string" ? out : String(out.text);
}

const LINE = {
  name: "washing up liquid",
  en: "washing up liquid",
  qty: "one bottle",
  category: "other",
  keeps: "pantry",
};

// --- the instruction ------------------------------------------------------------

test("with no body data there are no targets and nothing is planned", async () => {
  const withheld = state({ charter: charter({ consent: "no" }), plan: null });
  const text = mealsGuidance(withheld, MON);
  expect(text).toContain("chose not to share body data");
  expect(text).not.toContain("Training day:");

  const d = deps(withheld);
  const out = await buildProposeMealPlanTool(d).execute({ days: [] });
  expect(said(out)).toContain("withheld body data");
  expect(d.cards).toEqual([]);

  const fresh = mealsGuidance({ ...EMPTY_MEALS, shopping: shopping() }, MON);
  expect(fresh).toContain("have not answered the opening questions");
  const none = deps({ ...EMPTY_MEALS, shopping: shopping() });
  expect(said(await buildProposeMealPlanTool(none).execute({ days: [] }))).toContain(
    "have not answered the opening questions",
  );
});

test("the focus says what the reader has open", () => {
  const day = mealsGuidance(state(), MON, { focus: { kind: "day", date: MON } });
  expect(day).toContain("They are looking at 2026-09-21.");
  expect(day).toContain("write_meals_method");
  expect(mealsGuidance(state(), MON, { focus: { kind: "day", date: "2026-10-09" } })).toContain(
    "which the plan does not cover",
  );

  const list = shopping({ items: deriveShoppingList(week(), MON) });
  const n = list.items.length;
  const open = mealsGuidance(state({ shopping: list }), MON, { focus: { kind: "shopping" } });
  expect(open).toContain(`${n} lines, ${n} not ticked off`);
  expect(open).toContain("has not been done yet");

  const done = mealsGuidance(state({ shopping: { ...list, doneOn: MON } }), MON, { focus: { kind: "shopping" } });
  expect(done).toContain("was done on 2026-09-21");
});

// --- the week -------------------------------------------------------------------

// --- a week that has run out ------------------------------------------------------

/** The fixture week moved to start on another date. */
// --- the profile ----------------------------------------------------------------

test("a stated weight is written at once and the week re-solved against it", async () => {
  const current = state();
  const p = ports(current);
  const out = said(await buildUpdateProfileTool({ ...deps(current), ports: p }).execute({ weightKg: 71 }));
  expect(p.charters).toHaveLength(1);
  const written = p.charters[0]!;
  expect(written.charter.profile).toEqual(profile({ weightKg: 71 }));
  const c = charter({ weightKg: 71 });
  const t = targetsOf(c, "other")!;
  expect(written.week!.plan.days).toEqual(solvePlan(draftWeek(), t, c.profile).days);
  expect(out).toContain(`training day: ${t.training.kcal} kcal`);
  expect(out).toContain("re-solved");

  // Words alone replace what they said, and leave the profile as it is.
  await buildUpdateProfileTool({ ...deps(current), ports: p }).execute({ notes: "  Canteen lunch now. " });
  expect(p.charters[1]!.charter.text).toBe("Canteen lunch now.");
  expect(p.charters[1]!.charter.profile).toEqual(profile());
});

test("the effort level is set by the profile tool", async () => {
  const current = state();
  const p = ports(current);
  const tool = buildUpdateProfileTool({ ...deps(current), ports: p });
  const fields = (tool.parameters as { properties: Record<string, unknown> }).properties;
  expect(fields).toHaveProperty("effort");
  expect(fields).not.toHaveProperty("minutesPerMeal");
  await tool.execute({ effort: "homestyle" });
  expect(p.charters[0]!.charter.profile).toEqual(profile({ effort: "homestyle" }));
});

test("the profile tool refuses with no profile and with nothing usable", async () => {
  const none = { ...EMPTY_MEALS, shopping: shopping() };
  const p0 = ports(none);
  expect(said(await buildUpdateProfileTool({ ...deps(none), ports: p0 }).execute({ weightKg: 70 }))).toContain(
    "no profile to change",
  );

  const current = state();
  const p = ports(current);
  expect(
    said(await buildUpdateProfileTool({ ...deps(current), ports: p }).execute({ weightKg: -3, goal: "bulk" })),
  ).toContain("nothing changed");
  expect(p0.charters).toEqual([]);
  expect(p.charters).toEqual([]);
});

test("a profile patch takes only usable fields", () => {
  const base = profile();
  expect(patchProfile(base, {})).toBeNull();
  expect(patchProfile(base, { goal: "CUT" })?.goal).toBe("cut");
  expect(patchProfile(base, { trainingDays: [5, 2, 2, 9, 0] })?.trainingDays).toEqual([2, 5]);
  expect(patchProfile(base, { trainingDays: [] })?.trainingDays).toEqual([]);
  expect(patchProfile(base, { effort: "Homestyle" })?.effort).toBe("homestyle");
  expect(patchProfile(base, { effort: "gourmet" })).toBeNull();
  expect(patchProfile(base, { dislikes: ["celery", " ", "fish"] })?.dislikes).toEqual(["celery", "fish"]);
  expect(patchProfile(base, { weightKg: 0 })).toBeNull();
});

// --- the method -----------------------------------------------------------------

test("the method tool rewrites one made meal's line, and refuses what it cannot", async () => {
  const current = state();
  const p = ports(current);
  const d = { ...deps(current), ports: p };
  const tool = buildWriteMethodTool(d);

  const ok = await tool.execute({ day: "2", meal: "lunch", method: " 金枪鱼拌黄瓜，夹进饼里。 " });
  expect(said(ok)).toContain("金枪鱼口袋饼");
  expect(p.methods).toEqual([{ date: "2026-09-22", meal: "lunch", method: "金枪鱼拌黄瓜，夹进饼里。" }]);

  // Wednesday's dinner is delivery, not a made meal.
  expect(said(await tool.execute({ day: "3", meal: "dinner", method: "x" }))).toContain("not a made meal");
  expect(said(await tool.execute({ day: "9", meal: "lunch", method: "x" }))).toContain("not a made meal");
  expect(said(await tool.execute({ day: "1", meal: "brunch", method: "x" }))).toContain("not a made meal");
  expect(said(await tool.execute({ day: "1", meal: "lunch", method: "  " }))).toContain("one line");
  expect(said(await tool.execute({ day: "1", meal: "lunch", method: "x".repeat(MAX_METHOD_CHARS + 1) }))).toContain(
    `at most ${MAX_METHOD_CHARS} characters`,
  );
  expect(p.methods).toHaveLength(1);
});

// --- the shopping list ------------------------------------------------------------

test("before the trip is done, a line the reader asked for is added", async () => {
  const current = state({ shopping: shopping({ items: deriveShoppingList(week(), MON) }) });
  const p = ports(current);
  const out = await buildAddShoppingItemsTool({ ...deps(current), ports: p }).execute({ items: [LINE] });
  expect(said(out)).toContain("Added washing up liquid");
  expect(p.written[0]!.reader[0]!.source).toBe("reader");
  expect(p.written[0]!.reader[0]!.afterDone).toBeUndefined();
});

test("after Done the tool writes nothing and says it goes on next week's list", async () => {
  const current = state({ shopping: shopping({ doneOn: MON }) });
  const p = ports(current);
  const out = await buildAddShoppingItemsTool({ ...deps(current), ports: p }).execute({ items: [LINE] });
  expect(said(out)).toContain("next week's list");
  expect(p.written).toEqual([]);

  const passing = await buildAddShoppingItemsTool({ ...deps(current), ports: p }).execute({ items: [LINE], today: true });
  expect(said(passing)).toContain("still to get");
  expect(p.written[0]!.reader[0]!.afterDone).toBe(true);
});

test("remove and replace work on the list as it reads, and refuse a name that is not on it", async () => {
  const current = state({ shopping: shopping({ items: deriveShoppingList(week(), MON) }) });
  const p = ports(current);
  const d = { ...deps(current), ports: p };

  const swapped = await buildReplaceShoppingItemTool(d).execute({ from: "上海青", to: "菠菜", en: "Spinach", qty: "" });
  expect(said(swapped)).toContain("上海青 is now 菠菜");
  expect(currentList(p.written[0]!).some((i) => i.name === "菠菜")).toBe(true);

  const gone = await buildRemoveShoppingItemTool(d).execute({ name: "菠菜" });
  expect(said(gone)).toContain("off the list");

  const missing = await buildRemoveShoppingItemTool(d).execute({ name: "durian" });
  expect(said(missing)).toContain("nothing changed");
});

test("the trip is called done by the host", async () => {
  const current = state({ shopping: shopping({ items: deriveShoppingList(week(), MON) }) });
  const p = ports(current);
  expect(await markShoppingTripDone(p, MON)).toBe(true);
  expect(p.written[0]!.doneOn).toBe(MON);
});

// --- reading what the model sent -----------------------------------------------------

/**
 * The arguments the tool is actually handed: pi validates and coerces a call
 * against the tool's schema before execute sees it (pi-durable),
 * and a tool whose schema says a field is required that the model has nothing
 * to put in never gets that far (docs/pitfall/379).
 */
function validated(tool: AgentTool, args: Record<string, unknown>): Record<string, any> {
  const { name, description, parameters } = tool;
  return validateToolCall(
    [{ name, description, parameters }],
    { type: "toolCall", id: "call-1", name, arguments: args as Record<string, any> },
  );
}

test("the other tools validate the calls that leave a conditional field out", () => {
  const current = state();
  const d = { ...deps(current), ports: ports(current) };

  expect(
    validated(buildRecordDeviationTool(d), { day: "today", meal: "snack", became: "skip", said: "Skipped it." }).place,
  ).toBeUndefined();
  expect(validated(buildUpdateProfileTool(d), { weightKg: 71, goal: null, dislikes: null })).toEqual({ weightKg: 71 });
  expect(validated(buildAddShoppingItemsTool(d), { items: [LINE] }).today).toBeUndefined();
  expect(
    validated(buildReplaceShoppingItemTool(d), { from: "上海青", to: "菠菜", en: "spinach" }).qty,
  ).toBeUndefined();
  expect(validated(buildWriteMethodTool(d), { day: "1", meal: "lunch", method: "Toss." })).toEqual({
    day: "1",
    meal: "lunch",
    method: "Toss.",
  });
});
