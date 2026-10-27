// A standing dislike said in the chat (「我不吃西兰花」) reaches every draft the
// program fills, the draft card waiting in the chat and the saved plan, and
// update_meals_profile says exactly what the program changed and what only a
// new draft can change (docs/671 对话, 替换组). No model: the picks a model
// would send go straight into the tools.
// Run: scripts/t.sh tests/info/meals/dislike-applied.test.ts

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../src/i18n";
import { applyDraft, type MealsPorts, type PlanCheck } from "../../../src/info/meals/apply";
import type { MealsCard, MealsDraftCardData } from "../../../src/info/meals/cards";
import { SEED_DISHES } from "../../../src/info/meals/dishes/seed";
import { foodAllowed, foodById, type Food } from "../../../src/info/meals/nutrition/foods";
import { weekArtIds } from "../../../src/info/meals/photos/dish-art";
import { currentList } from "../../../src/info/meals/plan/shopping";
import { MEAL_KEYS, type MealsState, type WeekPlan } from "../../../src/info/meals/plan/types";
import type { Profile } from "../../../src/info/meals/nutrition/targets";
import { isBatchMain, parseDraft, type PlanDraft } from "../../../src/info/meals/planner/draft";
import { planLibrary } from "../../../src/info/meals/planner/library";
import {
  buildProposeMealPlanTool,
  buildUpdateProfileTool,
  mealsGuidance,
  readUnavailable,
  type MealsToolDeps,
} from "../../../src/info/meals/tools";
import type { ToolResult } from "../../../src/legion/durable/contract";
import { shopping } from "./fixtures/week";
import { goodDraft, PROFILE, START } from "./planner/fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

const BROCCOLI = ["broccoli", "frozen_broccoli"];

// --- the harness ------------------------------------------------------------------

interface Harness {
  ports: MealsPorts;
  now(): MealsState;
  cards: MealsCard[];
  checks: (PlanCheck | null)[];
  /** The draft card the chat shows: the last one raised or replaced. */
  card: MealsDraftCardData | null;
}

function harness(profile: Profile = PROFILE): Harness {
  let current: MealsState = {
    charter: { profile, text: "", updatedAt: 1 },
    plan: null,
    shopping: shopping(),
    deviations: [],
  };
  const h: Harness = { cards: [], checks: [], card: null, now: () => current, ports: null as unknown as MealsPorts };
  h.ports = {
    current: async () => current,
    saveCharter: async (charter, week) => {
      current = { ...current, charter, ...(week ? week : {}) };
    },
    savePlan: async (plan, list) => {
      current = { ...current, plan, shopping: list };
    },
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 100,
    today: () => START,
    changed: () => {},
  };
  return h;
}

function deps(h: Harness): MealsToolDeps & { ports: MealsPorts } {
  return {
    threadId: "meals",
    state: () => h.ports.current(),
    today: () => START,
    now: () => 7,
    region: () => "other",
    onMealsCard: (card) => {
      h.cards.push(card);
      if (card.kind === "meals-draft") h.card = card;
    },
    currentDraft: () => (h.card?.phase === "proposed" ? h.card : null),
    onPlanCheck: (check) => h.checks.push(check),
    ports: h.ports,
  };
}

/** What a model sends for a draft: the mains, pots and session, no breakfasts, sides or fruit. */
function picks(draft: PlanDraft): Record<string, unknown> {
  return {
    days: draft.days.map((d) => ({ lunch: { main: d.lunch.main }, dinner: { main: d.dinner.main } })),
    batches: draft.batches,
    sessions: draft.sessions,
  };
}

/**
 * The good draft with its two broccoli fish dinners changed for fish without
 * it: the only broccoli left is the chili pot's way 3 at Day 2 lunch, which the
 * program can change by itself.
 */
function wayOnlyDraft(): PlanDraft {
  const d = goodDraft();
  d.days[1]!.dinner = { main: { dish: "tomato_braised_cod", staple: "brown_rice" }, sides: [] };
  d.days[2]!.dinner = { main: { dish: "cajun_shrimp_zucchini", staple: "brown_rice" }, sides: [] };
  return d;
}

async function propose(h: Harness, draft: PlanDraft): Promise<ToolResult> {
  return (await buildProposeMealPlanTool(deps(h)).execute(picks(draft) as never)) as ToolResult;
}

async function dislike(h: Harness, words: string[]): Promise<string> {
  const res = (await buildUpdateProfileTool(deps(h)).execute({ dislikes: words } as never)) as ToolResult;
  return String(res.text);
}

// --- what a draft or a plan holds ---------------------------------------------------

/** Every food a draft eats: each dish's lines, the pots' ways as eaten, staples, sides, breakfasts and fruit. */
function draftFoods(draft: PlanDraft): Set<string> {
  const lib = planLibrary({ dislikes: [], kitchen: [], unavailable: [] });
  const out = new Set<string>();
  const dish = (id: string, way?: number) => {
    const d = lib.stored(id);
    if (!d) {
      if (foodById(id)) out.add(id);
      return;
    }
    for (const l of d.ingredients) out.add(l.food);
    const w = way ? d.ways?.[way - 1] : undefined;
    for (const l of w?.addOns ?? []) out.add(l.food);
    if (w?.staple) dish(w.staple);
  };
  const meals = [...draft.days.flatMap((d) => [d.lunch, d.dinner]), ...(draft.prepDinner ? [draft.prepDinner] : [])];
  for (const m of meals) {
    if (isBatchMain(m.main)) {
      const main = m.main;
      dish(draft.batches.find((b) => b.id === main.batch)?.dish ?? "", main.way);
    } else {
      dish(m.main.dish);
      if (m.main.staple) dish(m.main.staple);
    }
    for (const s of m.sides) dish(s);
  }
  for (const d of draft.days) {
    if (d.breakfast) dish(d.breakfast);
    for (const f of d.fruit) out.add(f);
  }
  return out;
}

/** The pictures of every library meal that shows broccoli: a way with it on the plate, a dish with it in the pan. */
const BROCCOLI_ART = new Set(
  SEED_DISHES.flatMap((d) => {
    const base = d.ingredients.some((l) => BROCCOLI.includes(l.food));
    const ways = (d.ways ?? []).flatMap((w, i) =>
      base || w.addOns.some((l) => BROCCOLI.includes(l.food)) ? [`${d.id}--w${i + 1}-${w.staple ?? "plain"}`] : [],
    );
    return [...ways, ...(base ? d.staples.map((s) => `${d.id}--${s}`) : [])];
  }),
);

function planHasNoBroccoli(plan: WeekPlan, list: MealsState["shopping"]) {
  for (const day of plan.days) {
    for (const k of MEAL_KEYS) {
      const meal = day[k];
      if (meal.mode !== "make") continue;
      expect((meal.items ?? []).map((i) => i.foodId).filter((f) => BROCCOLI.includes(f))).toEqual([]);
      expect(meal.name ?? "").not.toContain("西兰花");
      expect(meal.searchName ?? "").not.toContain("broccoli");
    }
  }
  expect(weekArtIds(plan).filter((id) => BROCCOLI_ART.has(id))).toEqual([]);
  expect(currentList(list).filter((i) => BROCCOLI.includes(i.foodId ?? ""))).toEqual([]);
  expect(draftFoods(parseDraft(plan.planner?.draft)).has("frozen_broccoli")).toBe(false);
}

function cardHasNoBroccoli(card: MealsDraftCardData) {
  const foods = draftFoods(card.draft);
  expect(BROCCOLI.filter((f) => foods.has(f))).toEqual([]);
  const shown = JSON.stringify([card.days, card.pots, card.prepDay ?? null]);
  expect(shown).not.toContain("西兰花");
  expect(shown.toLowerCase()).not.toContain("broccoli");
}

// --- the words they use ----------------------------------------------------------------

describe("a dislike by any of its names", () => {
  const fresh = foodById("broccoli") as Food;
  const frozen = foodById("frozen_broccoli") as Food;

  test("blocks broccoli fresh and frozen, by id, Chinese name, alias or English name", () => {
    for (const word of ["broccoli", "frozen_broccoli", "西兰花", "西蓝花", "青花菜", "冷冻西兰花", "Broccoli"]) {
      expect([word, foodAllowed(fresh, [word]), foodAllowed(frozen, [word])]).toEqual([word, false, false]);
    }
    expect(foodAllowed(foodById("spinach") as Food, ["broccoli"])).toBe(true);
  });

  test("leaves no dish with broccoli in the pan, and no way with it on the plate", () => {
    const lib = planLibrary({ dislikes: ["西兰花"], kitchen: [], unavailable: [] });
    for (const id of ["salmon_broccoli_skillet", "lemon_seared_cod", "steamed_broccoli_lemon", "oyster_broccoli"]) {
      expect([id, lib.blocked(id)?.food]).toEqual([id, "frozen_broccoli"]);
    }
    // The chili keeps the ways without it.
    expect(lib.blocked("chicken_bean_chili")).toBeNull();
    expect(lib.wayBlocked("chicken_bean_chili", 3)?.food).toBe("frozen_broccoli");
    expect(lib.wayBlocked("chicken_bean_chili", 1)).toBeNull();
  });
});

// --- a draft from scratch ------------------------------------------------------------------

describe("a draft drafted after the dislike", () => {
  test("refuses a main with broccoli", async () => {
    const h = harness({ ...PROFILE, dislikes: ["broccoli"] });
    const res = await propose(h, goodDraft());
    expect(h.cards).toEqual([]);
    expect(res.text).toContain("香煎三文鱼配西兰花");
    expect(res.text).toContain("which they dislike");
  });

  test("has no broccoli on the card, in the saved plan, on the list or in a picture", async () => {
    const h = harness({ ...PROFILE, dislikes: ["broccoli"] });
    const res = await propose(h, wayOnlyDraft());
    expect(h.cards).toHaveLength(1);
    cardHasNoBroccoli(h.card!);
    // The pot meal the model put on way 3 eats another way, and the model is told.
    expect(res.text).toContain("Day 2 lunch eats pot chili as way");
    const out = await applyDraft(h.card!, h.ports);
    await out.pending;
    expect(out.ok).toBe(true);
    planHasNoBroccoli(h.now().plan!, h.now().shopping);
  });

  test("the model's food listing and library leave broccoli out", () => {
    const h = harness({ ...PROFILE, dislikes: ["西兰花"] });
    const text = mealsGuidance(h.now(), START);
    const foods = text.slice(text.indexOf("FOODS ("));
    expect(foods).not.toMatch(/\bbroccoli 西兰花/);
    expect(foods).not.toContain("frozen_broccoli");
    expect(text).not.toContain("salmon_broccoli_skillet");
    expect(text).not.toContain("鸡丁豆子炖菜配土豆和西兰花");
  });
});

// --- the card waiting in the chat -------------------------------------------------------------

describe("the draft card when the dislike arrives", () => {
  test("is changed in place by the program when only its own picks have broccoli", async () => {
    const h = harness();
    await propose(h, wayOnlyDraft());
    const first = h.card!;
    expect(draftFoods(first.draft).has("frozen_broccoli")).toBe(true);

    const text = await dislike(h, ["西兰花"]);
    expect(h.cards).toHaveLength(2);
    const next = h.card!;
    expect(next.draftId).toBe(first.draftId);
    expect(next.version).toBe(2);
    cardHasNoBroccoli(next);
    // Day 2 lunch is the meal that changed, and the card marks it.
    expect(next.days[1]!.lunch.changed).toBe(true);
    expect(text).toContain("version 2");
    expect(text).toContain("Day 2 lunch");
    expect(text).not.toContain("still has");
  });

  test("is left as it is when a main they picked has broccoli, and the result says which and what to do", async () => {
    const h = harness();
    await propose(h, goodDraft());
    const first = h.card!;

    const text = await dislike(h, ["西兰花"]);
    // No card was raised or replaced: the program could not draft around the mains.
    expect(h.cards).toHaveLength(1);
    expect(h.card).toBe(first);
    expect(text).toContain("still has");
    expect(text).toContain("Day 2 dinner");
    expect(text).toContain("香煎三文鱼配西兰花");
    expect(text).toContain("Day 3 dinner");
    expect(text).toContain("propose_meal_plan");
    expect(text).not.toContain("now shows version");
    expect(text).not.toContain("re-solved");
  });
});

// --- the saved plan ------------------------------------------------------------------------

async function savedPlan(h: Harness, draft: PlanDraft): Promise<WeekPlan> {
  await propose(h, draft);
  const out = await applyDraft(h.card!, h.ports);
  await out.pending;
  h.card = null;
  return h.now().plan!;
}

describe("the saved plan when the dislike arrives", () => {
  test("is rewritten by the program when only its own picks have broccoli, and the result names the meals", async () => {
    const h = harness();
    const plan = await savedPlan(h, wayOnlyDraft());
    expect(draftFoods(parseDraft(plan.planner?.draft)).has("frozen_broccoli")).toBe(true);

    const text = await dislike(h, ["broccoli"]);
    const now = h.now();
    expect(now.charter?.profile.dislikes).toEqual(["broccoli"]);
    planHasNoBroccoli(now.plan!, now.shopping);
    expect(now.plan!.revision).toBe(plan.revision + 1);
    expect(text).toContain("saved plan");
    expect(text).toContain("2026-11-03 lunch");
    expect(text).not.toContain("still has");
    expect(h.checks[h.checks.length - 1]?.problems ?? []).toEqual([]);
  });

  test("is kept when a main they picked has broccoli, and the result says so in plain words", async () => {
    const h = harness();
    const plan = await savedPlan(h, goodDraft());

    const text = await dislike(h, ["西兰花"]);
    expect(h.now().plan!.days).toEqual(plan.days);
    expect(text).toContain("still has");
    expect(text).toContain("2026-11-03 dinner");
    expect(text).toContain("香煎三文鱼配西兰花");
    expect(text).toContain("did not change the saved plan");
    expect(text).not.toContain("re-solved");
    expect(h.checks[h.checks.length - 1]?.problems.map((p) => p.rule)).toContain("dish_blocked");
  });
});

// --- words the program cannot check ------------------------------------------------------------

describe("a dislike the food table has no name for", () => {
  test("is not stored, and the result says so", async () => {
    const h = harness({ ...PROFILE, dislikes: ["spicy", "内脏"] });
    const text = await dislike(h, ["spicy", "内脏", "西兰花", "dragon fruit jam"]);
    // An entry the profile already held stays; a new one nobody can check is not written.
    expect(h.now().charter?.profile.dislikes).toEqual(["spicy", "内脏", "西兰花"]);
    expect(text).toContain('"dragon fruit jam"');
    expect(text).toContain("not recorded");
  });

  test("a food they cannot get is read by id or name, and an unknown one is named back", () => {
    expect(readUnavailable(["冷冻西兰花", "frozen_broccoli", "dragon fruit jam"])).toEqual({
      ids: ["frozen_broccoli"],
      unknown: ["dragon fruit jam"],
    });
  });
});
