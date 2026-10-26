// The planning tools (src/info/meals/tools.ts): propose_meal_plan draws a
// draft card, sends back what fails, gives up after MAX_DRAFT_ROUNDS refusals
// in a turn, and revises the card in place; apply_meal_plan is the card's
// 「就这样」 in words.
// Run: scripts/t.sh tests/info/meals/plan-tools.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { validateToolCall } from "@earendil-works/pi-ai";
import { getLocale, setLocale, type Locale } from "../../../src/i18n";
import type { AgentTool, ToolResult } from "../../../src/legion/durable/contract";
import type { Applied } from "../../../src/info/meals/apply";
import { draftCardId, type MealsCard, type MealsDraftCardData } from "../../../src/info/meals/cards";
import { MAX_DRAFT_ROUNDS, type PlanDraft } from "../../../src/info/meals/planner/draft";
import { buildApplyMealPlanTool, buildProposeMealPlanTool, type MealsToolDeps } from "../../../src/info/meals/tools";
import type { MealsState } from "../../../src/info/meals/plan/types";
import { cardRow, latestCardOf, upsertCardRow } from "../../../src/ui/components/chat/chatParts";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";
import { shopping } from "./fixtures/week";
import { goodDraft, PROFILE, START } from "./planner/fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

// A conversation as the host keeps it: a draft card goes in under its card id,
// and one already there is replaced in place (use-info-call.ts showMealsCard).
interface Thread {
  deps: MealsToolDeps;
  messages: ThreadMessage[];
  raised: MealsCard[];
}

function thread(over: Partial<MealsToolDeps> = {}): Thread {
  const state: MealsState = { charter: { profile: PROFILE, text: "", updatedAt: 1 }, plan: null, shopping: shopping(), deviations: [] };
  const th: Thread = { messages: [], raised: [], deps: null as unknown as MealsToolDeps };
  let clock = 1000;
  th.deps = {
    threadId: "meals",
    state: async () => state,
    today: () => START,
    now: () => clock++,
    region: () => "other",
    onMealsCard: (card) => {
      th.raised.push(card);
      if (card.kind !== "meals-draft") return;
      const id = draftCardId(card.draftId);
      th.messages = latestCardOf(th.messages, "meals-draft")?.cardId === id ? upsertCardRow(th.messages, id, card) : [...th.messages, cardRow(id, card)];
    },
    currentDraft: () => {
      const hit = latestCardOf(th.messages, "meals-draft");
      return hit && hit.payload.phase === "proposed" ? hit.payload : null;
    },
    ...over,
  };
  return th;
}

const args = (draft: PlanDraft = goodDraft()) => JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;

async function call(tool: AgentTool, a: Record<string, unknown>): Promise<ToolResult> {
  const out = await tool.execute(a);
  return typeof out === "string" ? { text: out } : out;
}

function broken(): PlanDraft {
  const d = goodDraft();
  d.days[0]!.lunch = { main: { dish: "no_such_dish", staple: "brown_rice" }, sides: [] };
  return d;
}

test("the good draft passes the tool's own schema", () => {
  const tool = buildProposeMealPlanTool(thread().deps);
  const { name, description, parameters } = tool;
  const valid = validateToolCall([{ name, description, parameters }], { type: "toolCall", id: "c", name, arguments: args() as Record<string, any> });
  expect(valid.days).toHaveLength(3);
});

test("a passing draft draws a card from today and saves nothing", async () => {
  const th = thread();
  const out = await call(buildProposeMealPlanTool(th.deps), args());
  expect(th.raised).toHaveLength(1);
  const card = th.raised[0] as MealsDraftCardData;
  expect(card).toMatchObject({ kind: "meals-draft", version: 1, startDate: START, phase: "proposed", threadId: "meals" });
  expect(out.text).toContain("A draft card now shows the 3-day plan starting today");
  expect(out.text).toContain("Nothing is saved until they confirm it");
  // The program's own snack on day 3 is told to the model to pass on.
  expect(out.text).toContain("The program changed on its own");
  expect(out.receipt?.summary).toBe(card.pots.map((p) => p.name.en).join(" · "));
});

test("mains and pots alone draw a card: the program fills breakfasts, staples, sides and fruit", async () => {
  const th = thread();
  const picks = JSON.parse(JSON.stringify(goodDraft())) as { days: Record<string, unknown>[] };
  for (const day of picks.days) {
    delete day.breakfast;
    delete day.fruit;
    for (const slot of ["lunch", "dinner"]) {
      const meal = day[slot] as { main: Record<string, unknown>; sides?: unknown };
      delete meal.sides;
      delete meal.main.staple;
    }
  }
  const out = await call(buildProposeMealPlanTool(th.deps), picks);
  expect(out.text).toContain("A draft card now shows the 3-day plan");
  const card = th.raised[0] as MealsDraftCardData;
  expect(card.days.every((d) => d.breakfast.en.length > 0)).toBe(true);
});

test("a revision in the same conversation replaces the card in place as its next version", async () => {
  const th = thread();
  await call(buildProposeMealPlanTool(th.deps), args());
  const revisedDraft = goodDraft();
  revisedDraft.days[2]!.dinner = { main: { dish: "lemon_seared_cod", staple: "whole_wheat_pasta" }, sides: [] };
  // A later turn builds the tool again; the card on screen is what it revises.
  const out = await call(buildProposeMealPlanTool(th.deps), args(revisedDraft));
  const [first, second] = th.raised as MealsDraftCardData[];
  expect(second!.draftId).toBe(first!.draftId);
  expect(second!.version).toBe(2);
  expect(second!.days[2]!.dinner.changed).toBe(true);
  expect(out.text).toContain("now shows version 2");
  // One row in the conversation, carrying the new version.
  expect(th.messages).toHaveLength(1);
  expect(latestCardOf(th.messages, "meals-draft")?.payload.version).toBe(2);
});

test("a draft applied already is not revised: the next one is a new card", async () => {
  const th = thread();
  await call(buildProposeMealPlanTool(th.deps), args());
  const id = latestCardOf(th.messages, "meals-draft")!.cardId;
  const card = latestCardOf(th.messages, "meals-draft")!.payload;
  th.messages = upsertCardRow(th.messages, id, { ...card, phase: "applied" });
  await call(buildProposeMealPlanTool(th.deps), args());
  const next = th.raised[1] as MealsDraftCardData;
  expect(next.version).toBe(1);
  expect(next.draftId).not.toBe(card.draftId);
  expect(th.messages).toHaveLength(2);
});

test("a failing draft is sent back with what fails and draws nothing", async () => {
  const th = thread();
  const out = await call(buildProposeMealPlanTool(th.deps), args(broken()));
  expect(out.receipt).toBeNull();
  expect(out.text).toContain("Nothing was shown");
  expect(out.text).toContain("no_such_dish");
  expect(out.text).toContain("Fix those and call propose_meal_plan again");
  expect(th.raised).toEqual([]);
});

test(`after ${MAX_DRAFT_ROUNDS} refusals in a turn the tool stops, even for a draft that would pass`, async () => {
  const th = thread();
  const tool = buildProposeMealPlanTool(th.deps);
  for (let i = 1; i < MAX_DRAFT_ROUNDS; i++) expect((await call(tool, args(broken()))).text).toContain("Fix those");
  const last = await call(tool, args(broken()));
  expect(last.text).toContain(`That is ${MAX_DRAFT_ROUNDS} refused drafts this turn`);
  const after = await call(tool, args());
  expect(after.receipt).toBeNull();
  expect(after.text).toContain("Stop drafting");
  expect(th.raised).toEqual([]);
  // The next turn builds the tool again and starts counting from nothing.
  await call(buildProposeMealPlanTool(th.deps), args());
  expect(th.raised).toHaveLength(1);
});

test("apply_meal_plan confirms the card on screen, and says so when there is none or it failed", async () => {
  const applied: Applied = { ok: true, note: "[The reader confirmed the draft.]" };
  const ok = await call(buildApplyMealPlanTool(thread({ applyDraft: async () => applied }).deps), {});
  expect(ok.text).toBe("[The reader confirmed the draft.] Say it in one line.");
  expect(ok.receipt).not.toBeNull();

  for (const over of [{}, { applyDraft: async () => null }]) {
    const none = await call(buildApplyMealPlanTool(thread(over).deps), {});
    expect(none.receipt).toBeNull();
    expect(none.text).toContain("No draft card is waiting");
  }

  const failed = await call(buildApplyMealPlanTool(thread({ applyDraft: async () => ({ ok: false, note: "" }) }).deps), {});
  expect(failed.receipt).toBeNull();
  expect(failed.text).toContain("could not be saved");
});
