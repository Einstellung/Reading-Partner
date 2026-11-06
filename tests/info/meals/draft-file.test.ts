// The unsaved draft as a file (src/info/meals/draft-file.ts, draft-store.ts;
// docs/platform/687 三餐): written and read back whole, merged to the copy
// written later, the card redrawn from a version that arrived by sync, the
// Apply taken from the file, and the draft readable by the read tools.
// Run: scripts/t.sh tests/info/meals/draft-file.test.ts

import { expect, test } from "bun:test";
import { applyDraftFile, type MealsPorts } from "../../../src/info/meals/apply";
import {
  appliedDraftFile,
  draftCardFromFile,
  draftCardOf,
  draftFileBody,
  joinDraftFiles,
  MEALS_DRAFT_FILE,
  nextDraftFile,
  type MealsDraftFile,
} from "../../../src/info/meals/draft-file";
import { loadMealsDraft, saveMealsDraft, watchMealsDraft, type MealsDraftIo } from "../../../src/info/meals/draft-store";
import type { MealsState, ShoppingState, WeekPlan } from "../../../src/info/meals/plan/types";
import type { PlanDraft } from "../../../src/info/meals/planner/draft";
import type { DraftRead } from "../../../src/info/meals/read";
import { buildMealsReadTools } from "../../../src/info/meals/read-tools";
import { mergeFile } from "../../../src/platform/sync/merge";
import { strategyFor } from "../../../src/platform/sync/merge/contract";
import { dispatchPull } from "../../../src/platform/sync/pull-routes";
import { shopping } from "./fixtures/week";
import { checked, LIB, memoryDrafts } from "./planner/card-fixture";
import { goodDraft, PROFILE, START } from "./planner/fixture";

const STATE: MealsState = { charter: { profile: PROFILE, text: "", updatedAt: 1 }, plan: null, shopping: shopping(), deviations: [] };

function memoryIo(): MealsDraftIo & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (file, validate) => {
      const text = files.get(file);
      if (text === undefined) return { status: "missing" };
      const value = validate(JSON.parse(text));
      return value ? { status: "ok", value } : { status: "corrupt", savedAs: null };
    },
    write: async (file, contents) => {
      files.set(file, contents);
    },
    quarantine: async () => null,
    reportCorrupt: () => {},
  };
}

function revised(): PlanDraft {
  const d = goodDraft();
  d.days[2]!.dinner = { main: { dish: "lemon_seared_cod", staple: "whole_wheat_pasta" }, sides: [] };
  return d;
}

/** Version 1 of the good draft, as propose_meal_plan writes it. */
function first(): MealsDraftFile {
  const result = checked();
  return nextDraftFile(null, { draft: result.draft, picks: goodDraft(), startDate: START, threadId: "meals", newId: "42", now: 10 });
}

test("the file is written whole and read back, and every write is heard, here or by a pull", async () => {
  const io = memoryIo();
  expect(await loadMealsDraft(io)).toBeNull();
  let heard = 0;
  const off = watchMealsDraft(() => (heard += 1));
  const file = first();
  await saveMealsDraft(file, io);
  expect(await loadMealsDraft(io)).toEqual(file);
  expect(heard).toBe(1);
  dispatchPull([MEALS_DRAFT_FILE]);
  expect(heard).toBe(2);
  off();
  dispatchPull([MEALS_DRAFT_FILE]);
  expect(heard).toBe(2);
});

test("sync keeps the copy written later, whichever device merges", () => {
  expect(strategyFor(MEALS_DRAFT_FILE)).toBe("lattice");
  const older = first();
  const newer = nextDraftFile(older, { draft: checked(revised()).draft, startDate: START, threadId: "meals", newId: "x", now: 20 });
  const enc = (f: MealsDraftFile) => new TextEncoder().encode(draftFileBody(f));
  for (const [local, remote] of [
    [older, newer],
    [newer, older],
  ] as const) {
    const out = mergeFile({ path: MEALS_DRAFT_FILE, base: enc(older), local: enc(local), remote: enc(remote) });
    expect(JSON.parse(new TextDecoder().decode(out.merged))).toEqual(JSON.parse(draftFileBody(newer)));
  }
  expect(joinDraftFiles(JSON.parse(draftFileBody(older)), JSON.parse(draftFileBody(older)))).toBeNull();
});

test("the card is drawn from the file; a version that arrived by sync redraws it with the changed meal marked", () => {
  const v1 = first();
  const card = draftCardOf(v1, checked(), LIB);
  expect(card).toMatchObject({ draftId: "42", version: 1, phase: "proposed", startDate: START, threadId: "meals" });
  expect(card.days.some((d) => d.lunch.changed || d.dinner.changed)).toBe(false);
  // Nothing new: the card stays.
  expect(draftCardFromFile(v1, card, STATE, "other")).toBeNull();

  const v2 = nextDraftFile(v1, { draft: checked(revised()).draft, startDate: START, threadId: "meals", newId: "x", now: 20 });
  const next = draftCardFromFile(v2, card, STATE, "other")!;
  expect(next).toMatchObject({ draftId: "42", version: 2, phase: "proposed" });
  expect(next.days[2]!.dinner.changed).toBe(true);
  expect(next.days[0]!.lunch.changed).toBe(false);

  // Applied on the other device: the card collapses, and an applied card is never redrawn.
  const applied = draftCardFromFile(appliedDraftFile(v1, 30), card, STATE, "other")!;
  expect(applied.phase).toBe("applied");
  expect(draftCardFromFile(v2, applied, STATE, "other")).toBeNull();
  // Another draft's file leaves this card alone.
  expect(draftCardFromFile({ ...v2, draftId: "other" }, card, STATE, "other")).toBeNull();
});

function ports(drafts: ReturnType<typeof memoryDrafts>, saved: { plan: WeekPlan; shopping: ShoppingState }[]): MealsPorts {
  return {
    current: async () => STATE,
    saveCharter: async () => {},
    savePlan: async (plan, list) => {
      saved.push({ plan, shopping: list });
    },
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 100,
    today: () => START,
    changed: () => {},
    drafts,
  };
}

test("Apply takes the draft from the file and marks it applied; a second Apply, or another draft's, does nothing", async () => {
  const drafts = memoryDrafts(first());
  const saved: { plan: WeekPlan; shopping: ShoppingState }[] = [];
  expect(await applyDraftFile("someone-else", ports(drafts, saved))).toBeNull();
  const out = (await applyDraftFile("42", ports(drafts, saved)))!;
  await out.pending;
  expect(out.ok).toBe(true);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.plan.planner?.draft).toEqual(first().draft);
  expect(drafts.file).toMatchObject({ draftId: "42", phase: "applied", updatedAt: 100 });
  expect(await applyDraftFile("42", ports(drafts, saved))).toBeNull();
  expect(saved).toHaveLength(1);
});

test("the read tools read the draft: by id and by the card's names, or not found", async () => {
  const read = async (file: MealsDraftFile | null) => {
    const tool = buildMealsReadTools({ state: async () => STATE, today: () => START, region: () => "other", draft: async () => file }).find(
      (t) => t.name === "meals_read_draft",
    )!;
    return JSON.parse(String(await tool.execute({}))) as DraftRead;
  };
  expect(await read(null)).toEqual({ found: false });
  const file = first();
  const out = await read(file);
  expect(out).toMatchObject({ found: true, draftId: "42", version: 1, phase: "proposed", startDate: START });
  expect(out.draft).toEqual(file.draft);
  expect(out.card?.days).toHaveLength(3);
  expect(out.card?.days[0]!.date).toBe(START);
  expect(out.card?.pots.length).toBeGreaterThan(0);
});
