// The meals desk's tools (src/info/meals/tools.ts): what the instruction tells
// the model, what the planning tool refuses and sends back, and what the
// profile, shopping and method tools write.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import { validateToolCall } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../src/legion/execute/contract";
import {
  MAX_METHOD_CHARS,
  buildAddShoppingItemsTool,
  buildProposeMealsPlanTool,
  buildRecordDeviationTool,
  buildRemoveShoppingItemTool,
  buildReplaceShoppingItemTool,
  buildUpdateProfileTool,
  buildWriteMethodTool,
  foodListing,
  markShoppingTripDone,
  mealsGuidance,
  patchProfile,
  toDayDrafts,
  type MealsToolDeps,
} from "../../../src/info/meals/tools";
import type { MealsPorts } from "../../../src/info/meals/apply";
import type { MealsCard, MealsPlanCardData } from "../../../src/info/meals/cards";
import { currentList, deriveShoppingList } from "../../../src/info/meals/shopping";
import { solvePlan, targetsOf } from "../../../src/info/meals/solve-week";
import {
  EMPTY_MEALS,
  type MealKey,
  type MealsCharter,
  type MealsState,
  type ShoppingState,
  type WeekPlan,
} from "../../../src/info/meals/types";
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

/** A week as the model would send it: day numbers, food ids and roles, no grams it does not own. */
function sent(plan: WeekPlan): Record<string, unknown>[] {
  const keys: MealKey[] = ["breakfast", "lunch", "dinner", "snack"];
  return plan.days.map((day, i) => {
    const out: Record<string, unknown> = { day: i + 1 };
    for (const key of keys) {
      const { solved: _solved, items, ...rest } = day[key];
      out[key] = items
        ? { ...rest, items: items.map((it) => ({ food: it.foodId, role: it.role, ...(it.grams ? { grams: it.grams } : {}) })) }
        : rest;
    }
    return out;
  });
}

const LINE = {
  name: "washing up liquid",
  en: "washing up liquid",
  qty: "one bottle",
  category: "other",
  keeps: "pantry",
};

// --- the instruction ------------------------------------------------------------

test("the instruction gives the program's targets and every meal of every day", () => {
  const text = mealsGuidance(state(), MON);
  const t = targetsOf(charter(), "other")!;
  expect(text).toContain(
    `Training day: ${t.training.kcal} kcal, protein ${t.training.protein} g, fat ${t.training.fat} g, carbs ${t.training.carbs} g`,
  );
  expect(text).toContain(`Rest day: ${t.rest.kcal} kcal, protein ${t.rest.protein} g`);
  expect(text).toContain("Goal: steady energy. Trains Mon, Wed, Fri (evening).");
  expect(text).toContain("In their words: Lunch is at my desk on weekdays.");
  expect(text).toContain("- Day 1 (2026-09-21, Mon, training)  <- today");
  expect(text).toContain("- Day 2 (2026-09-22, Tue, rest)");
  expect(text).toContain(
    "lunch: 虾仁杂粮饭 [soy-ginger], 10 min: frozen_shrimp (protein), microwave_grain_rice (staple), " +
      "olive_oil (fat), frozen_mixed_veg 150 g, light_soy_sauce 15 g",
  );
  expect(text).toContain("dinner: delivery from the usual place");
  expect(text).toContain("dinner: late lunch");
  expect(text).toContain("They are looking at the week.");
  expect(text).toContain("never more than 10");
  expect(text).toContain("soy-ginger (");
});

test("the food listing leaves out what they do not eat, by id, name or tag", () => {
  const all = foodListing([]);
  expect(all.some((l) => l.startsWith("frozen_shrimp "))).toBe(true);
  expect(all.some((l) => l.startsWith("salmon "))).toBe(true);

  const text = mealsGuidance(state({ charter: charter({ dislikes: ["frozen_shrimp", "三文鱼"] }) }), MON);
  const foods = text.slice(text.indexOf("FOODS (id"), text.indexOf("WHEN A MEAL"));
  expect(foods).toMatch(/^greek_yogurt /m);
  expect(foods).not.toMatch(/^frozen_shrimp /m);
  expect(foods).not.toMatch(/^salmon /m);
  expect(text).toContain("Never use: frozen_shrimp, 三文鱼.");

  const noSeafood = foodListing(["seafood", "fish"]);
  expect(noSeafood.some((l) => l.startsWith("frozen_shrimp "))).toBe(false);
  expect(noSeafood.some((l) => l.startsWith("salmon "))).toBe(false);
  expect(noSeafood.length).toBeGreaterThan(0);
});

test("with no body data there are no targets and nothing is planned", async () => {
  const withheld = state({ charter: charter({ consent: "no" }), plan: null });
  const text = mealsGuidance(withheld, MON);
  expect(text).toContain("chose not to share body data");
  expect(text).not.toContain("Training day:");

  const d = deps(withheld);
  const out = await buildProposeMealsPlanTool(d).execute({ days: sent(week()) });
  expect(said(out)).toContain("withheld body data");
  expect(d.cards).toEqual([]);

  const fresh = mealsGuidance({ ...EMPTY_MEALS, shopping: shopping() }, MON);
  expect(fresh).toContain("have not answered the opening questions");
  const none = deps({ ...EMPTY_MEALS, shopping: shopping() });
  expect(said(await buildProposeMealsPlanTool(none).execute({ days: sent(week()) }))).toContain(
    "have not answered the opening questions",
  );
});

test("the focus says what the reader has open", () => {
  const day = mealsGuidance(state(), MON, { focus: { kind: "day", date: MON } });
  expect(day).toContain("They are looking at 2026-09-21.");
  expect(day).toContain("write_meals_method");
  expect(mealsGuidance(state(), MON, { focus: { kind: "day", date: "2026-10-09" } })).toContain(
    "which this week does not cover",
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

test("a fresh week is refused until it is seven days of four meals", async () => {
  const d = deps(state({ plan: null }));
  const tool = buildProposeMealsPlanTool(d);
  const full = sent(week());

  const short = await tool.execute({ days: full.slice(0, 3) });
  expect(said(short)).toContain("needs all 7 days");

  const thin = await tool.execute({ days: full.map((day, i) => (i === 2 ? { ...day, snack: undefined } : day)) });
  expect(said(thin)).toContain("breakfast, lunch, dinner and snack on every day; day 3");
  expect(d.cards).toEqual([]);
});

test("a clean week drafts a card with the grams the program solved, and writes nothing", async () => {
  const d = deps(state({ plan: null }));
  const out = await buildProposeMealsPlanTool(d).execute({ days: sent(week()) });
  expect(said(out)).toContain("Proposed the week's meals");
  const card = d.cards[0] as MealsPlanCardData;
  expect(card.kind).toBe("meals-plan");
  expect(card.startDate).toBe(MON);
  expect(card.adjustment).toBe(false);
  expect(card.days).toEqual(week().days);
});

test("a week that fails the checks goes back to the model, and the fixed one is proposed", async () => {
  const d = deps(state({ plan: null }));
  const tool = buildProposeMealsPlanTool(d);

  const broken = sent(week());
  const lunch = (broken[0]!.lunch as { items: { food: string }[] });
  lunch.items[0]!.food = "dragon_steak";
  // Tuesday breakfast tastes like Monday dinner.
  (broken[1]!.breakfast as { flavour: string }).flavour = "teriyaki";
  const first = said(await tool.execute({ days: broken }));
  expect(first).toContain("Nothing was proposed");
  expect(first).toContain('Day 1 lunch: "dragon_steak" is not in the food table');
  expect(first).toContain("call propose_meals_plan again with the whole week, all 7 days");
  expect(first).not.toContain("Fix only those meals");
  expect(d.cards).toEqual([]);

  // The template holds now; the flavour rule reads the solved week.
  lunch.items[0]!.food = "frozen_shrimp";
  const second = said(await tool.execute({ days: broken }));
  expect(second).toContain("Day 1 dinner and Day 2 breakfast are both teriyaki; change one.");
  expect(second).not.toContain("dragon_steak");
  expect(d.cards).toEqual([]);

  (broken[1]!.breakfast as { flavour: string }).flavour = "plain";
  expect(said(await tool.execute({ days: broken }))).toContain("Proposed the week's meals");
  expect(d.cards).toHaveLength(1);
});

test("an adjustment re-picks only the meals it sends, and is checked against the reader's limits", async () => {
  const d = deps(state());
  const tool = buildProposeMealsPlanTool(d);
  const slow = said(
    await tool.execute({
      adjustment: true,
      days: [{ day: 2, lunch: { ...(sent(week())[4]!.dinner as object), minutes: 25 } }],
    }),
  );
  expect(slow).toContain("Day 2 lunch takes 25 minutes; they allow 10.");
  expect(slow).toContain("Fix only those meals and call propose_meals_plan again.");

  const out = await tool.execute({
    adjustment: true,
    days: [{ day: 2, lunch: sent(week())[4]!.dinner }],
  });
  expect(said(out)).toContain("Proposed a change to 1 meal(s)");
  const card = d.cards[0] as MealsPlanCardData;
  expect(card.changed).toEqual([{ date: "2026-09-22", meal: "lunch" }]);
  expect(card.changedDates).toEqual(["2026-09-22"]);
  expect(card.days[1]!.lunch.name).toBe("虾仁杂粮饭");
  expect(card.days[1]!.lunch.solved?.length).toBeGreaterThan(0);
  expect(card.days[0]).toEqual(week().days[0]!);
});

test("an adjustment with no week to adjust is refused", async () => {
  const d = deps(state({ plan: null }));
  const out = await buildProposeMealsPlanTool(d).execute({ adjustment: true, days: [{ day: 1, lunch: { mode: "out" } }] });
  expect(said(out)).toContain("no week planned yet");
});

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
  expect(patchProfile(base, { minutesPerMeal: 14.6 })?.minutesPerMeal).toBe(15);
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

test("what the model sent is read defensively", () => {
  expect(toDayDrafts("nonsense")).toEqual([]);
  const days = toDayDrafts([
    {
      day: 2.4,
      breakfast: {
        mode: "Make",
        name: " 燕麦碗 ",
        searchName: "Oat Bowl",
        flavour: "sweet",
        minutes: 4.6,
        items: [
          { food: "oats", role: "staple", grams: 40 },
          { food: "greek_yogurt", role: "protein" },
          { food: "blueberries", role: "garnish", grams: 79.6 },
          { food: "  " },
        ],
      },
      lunch: { mode: "nonsense" },
      dinner: { mode: "out", place: "noodle shop", items: [{ food: "egg", role: "protein" }], note: "with Ann" },
      snack: { mode: "make", flavour: "not-a-flavour" },
    },
  ]);
  const day = days[0]!;
  expect(day.day).toBe(2);
  expect(day.breakfast).toEqual({
    mode: "make",
    name: "燕麦碗",
    searchName: "oat bowl",
    flavour: "sweet",
    minutes: 5,
    items: [
      // A solved role carries no grams the model gave.
      { foodId: "oats", role: "staple" },
      { foodId: "greek_yogurt", role: "protein" },
      // A role off the list becomes fixed, for the check to name.
      { foodId: "blueberries", role: "fixed", grams: 80 },
    ],
  });
  expect(day.lunch).toBeUndefined();
  expect(day.dinner).toEqual({ mode: "out", place: "noodle shop", note: "with Ann" });
  expect(day.snack).toEqual({ mode: "make", items: [] });
});

/**
 * The arguments the tool is actually handed: pi validates and coerces a call
 * against the tool's schema before execute sees it (src/legion/execute/turn.ts),
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

test("a meal validates without the fields its mode has no use for", () => {
  const tool = buildProposeMealsPlanTool(deps(state()));
  const args = validated(tool, {
    adjustment: true,
    days: [
      {
        day: 1,
        // What the model sends for a made meal: null where a place would go.
        lunch: { ...(sent(week())[0]!.lunch as object), place: null },
        dinner: { mode: "out", place: "noodle shop", items: null, flavour: null },
      },
    ],
  });
  expect("place" in args.days[0].lunch).toBe(false);
  expect(args.days[0].dinner).toEqual({ mode: "out", place: "noodle shop" });

  const drafts = toDayDrafts(args.days);
  expect(drafts[0]!.lunch!.items).toHaveLength(5);
  expect(drafts[0]!.dinner).toEqual({ mode: "out", place: "noodle shop" });
  expect(drafts[0]!.breakfast).toBeUndefined();
});

test("a fresh week validates without adjustment, and drafts its card", async () => {
  const d = deps(state({ plan: null }));
  const tool = buildProposeMealsPlanTool(d);
  const args = validated(tool, { adjustment: null, days: sent(week()) });
  expect("adjustment" in args).toBe(false);
  const out = await tool.execute(args);
  expect(said(out)).toContain("Proposed the week's meals");
  expect((d.cards[0] as MealsPlanCardData).days[2]!.dinner.mode).toBe("delivery");
});

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
