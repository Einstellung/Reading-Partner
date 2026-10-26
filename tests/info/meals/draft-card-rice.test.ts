// The plan's rice on the draft card's prep block (build-draft-card.ts,
// draft-card-view.ts): when the rice is cooked at the prep session it is
// listed after the pots; a plan with no rice batch at the session lists none.
// Run: scripts/t.sh tests/info/meals/draft-card-rice.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale } from "../../../src/i18n";
import { buildDraftCard } from "../../../src/info/meals/build-draft-card";
import type { MealsDraftCardData } from "../../../src/info/meals/cards";
import { draftCardView, type DraftRow } from "../../../src/info/meals/draft-card-view";
import { checkDraft } from "../../../src/info/meals/planner/checks";
import type { PlanDraft } from "../../../src/info/meals/planner/draft";
import { planLibrary } from "../../../src/info/meals/planner/library";
import type { RiceBatch } from "../../../src/info/meals/planner/storage";
import { PROFILE, START, START_WEEKDAY, goodDraft, targetsFor } from "./planner/fixture";

const initial = getLocale();
beforeEach(() => setLocale("zh-CN"));
afterEach(() => setLocale(initial));

function card(draft: PlanDraft, rice?: (r: RiceBatch) => RiceBatch | null): MealsDraftCardData {
  const lib = planLibrary(PROFILE);
  const result = checkDraft(draft, { profile: PROFILE, targets: targetsFor(), startWeekday: START_WEEKDAY, people: 1, library: lib });
  if (!result.plan || !result.storage?.rice) throw new Error(`draft fails: ${JSON.stringify(result.problems)}`);
  if (rice) result.storage.rice = rice(result.storage.rice);
  return buildDraftCard({ result, lib, startDate: START, threadId: "t", previous: null, newId: "d1" });
}

const prepRow = (c: MealsDraftCardData) =>
  draftCardView(c)
    .days.flatMap((d) => d.rows)
    .find((r): r is Extract<DraftRow, { kind: "prep" }> => r.kind === "prep");

test("the rice cooked at the prep session is listed after the pots", () => {
  const c = card(goodDraft());
  expect(c.session?.rice).toEqual({ zh: "糙米饭", en: "Brown rice" });
  const row = prepRow(c)!;
  expect(row.pots.map((p) => p.letter)).toEqual(["A"]);
  expect(row.rice).toBe("糙米饭 一锅");
});

test("the rice line is worded in the reader's language", () => {
  const c = card(goodDraft());
  setLocale("en");
  expect(prepRow(c)!.rice).toBe("Brown rice, one rice-cooker batch");
});

test("a plan with no rice batch, or one cooked at a meal rather than the session, lists no rice at it", () => {
  for (const c of [card(goodDraft(), () => null), card(goodDraft(), (r) => ({ ...r, cookedAt: { day: 2, slot: "dinner" } }))]) {
    expect(c.session?.rice).toBeUndefined();
    expect(prepRow(c)!.rice).toBeNull();
  }
});

test("a card stored before the rice field draws no rice", () => {
  const c = card(goodDraft());
  const { rice: _rice, ...old } = c.session!;
  expect(prepRow({ ...c, session: old })!.rice).toBeNull();
});
