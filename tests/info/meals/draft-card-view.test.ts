// What the draft card draws (src/info/meals/draft-card-view.ts): the row order
// with the prep block in its slot, tags and sub-lines, the label column, and
// the short form once applied.
// Run: scripts/t.sh tests/info/meals/draft-card-view.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, t, type Locale } from "../../../src/i18n";
import type { MealsDraftCardData } from "../../../src/info/meals/cards";
import { draftAppliedView, draftCardView, pickName, prepWhen, type DraftRow } from "../../../src/info/meals/draft-card-view";
import { draftCard } from "./planner/card-fixture";
import { goodDraft } from "./planner/fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const keys = (rows: readonly DraftRow[]) => rows.map((r) => r.key);
const withPart = (card: MealsDraftCardData, part: "morning" | "afternoon" | "evening"): MealsDraftCardData => ({
  ...card,
  session: card.session ? { ...card.session, part } : null,
});

test("the prep block goes before lunch in the morning, before dinner in the afternoon, after dinner in the evening", () => {
  const card = draftCard();
  expect(keys(draftCardView(card).days[0]!.rows)).toEqual(["breakfast", "lunch", "prep", "dinner", "fruit"]);
  expect(keys(draftCardView(withPart(card, "morning")).days[0]!.rows)).toEqual(["breakfast", "prep", "lunch", "dinner", "fruit"]);
  expect(keys(draftCardView(withPart(card, "evening")).days[0]!.rows)).toEqual(["breakfast", "lunch", "dinner", "prep", "fruit"]);
  // Only the session's day has one; the night reminders close their day.
  expect(keys(draftCardView(card).days[1]!.rows)).toEqual(["breakfast", "lunch", "dinner", "fruit", "night"]);
});

test("the prep row names its pots by chip and its minutes", () => {
  const prep = draftCardView(draftCard()).days[0]!.rows.find((r) => r.kind === "prep");
  expect(prep).toMatchObject({
    kind: "prep",
    label: t("meals.draft.row.prep"),
    lead: t("meals.draft.prepAt", { part: t("meals.draft.part.afternoon") }),
    pots: [{ letter: "A", label: "锅 A", tone: 0 }],
    time: t("meals.draft.prepTime", { active: 15, total: 60 }),
  });
});

test("a pot meal has its chip, the meal at the prep session says so, and a fresh main says it is made fresh", () => {
  const draft = goodDraft();
  draft.days[0]!.dinner.sides = ["tomato_cucumber_salad"];
  const day1 = draftCardView(draftCard(draft)).days[0]!.rows;
  const lunch = day1.find((r) => r.key === "lunch");
  const dinner = day1.find((r) => r.key === "dinner");
  if (lunch?.kind !== "meal" || dinner?.kind !== "meal") throw new Error("meal rows expected");
  expect(lunch.pot).toBeNull();
  expect(lunch.name).toBe("宫保鸡丁");
  expect(lunch.tags.map((tag) => tag.text)).toEqual(["现做"]);
  expect(lunch.subs).toEqual([{ text: "配糙米饭", indent: false }]);
  expect(dinner.pot).toMatchObject({ letter: "A", tone: 0 });
  expect(dinner.tags.map((tag) => tag.text)).toEqual(["做完就吃"]);
  // A side under a pot meal lines up under the name, past the chip.
  expect(dinner.subs).toHaveLength(1);
  expect(dinner.subs[0]!.indent).toBe(true);
});

test("a revised meal is tagged and its row marked; the head shows the version", () => {
  const first = draftCard();
  const revisedDraft = goodDraft();
  revisedDraft.days[2]!.dinner = { main: { dish: "lemon_seared_cod", staple: "whole_wheat_pasta" }, sides: [] };
  const view = draftCardView(draftCard(revisedDraft, first));
  expect(view.version).toBe("第 2 版");
  expect(draftCardView(first).version).toBeNull();
  const dinner = view.days[2]!.rows.find((r) => r.key === "dinner");
  if (dinner?.kind !== "meal") throw new Error("meal row expected");
  expect(dinner.changed).toBe(true);
  expect(dinner.tags).toContainEqual({ text: "已改", changed: true });
  expect(view.days[2]!.rows.filter((r) => (r.kind === "meal" || r.kind === "plain") && r.changed)).toHaveLength(1);
});

test("Chinese labels take the narrow column; every other language the wide one", () => {
  const card = draftCard();
  expect(draftCardView(card).wideLabels).toBe(false);
  for (const locale of ["en", "ja", "de"] as Locale[]) {
    setLocale(locale);
    expect(draftCardView(card).wideLabels).toBe(true);
  }
});

test("names follow the reader's language: Chinese in Chinese, English elsewhere", () => {
  const name = { zh: "宫保鸡丁", en: "Kung pao chicken" };
  expect(pickName(name)).toBe("宫保鸡丁");
  setLocale("en");
  expect(pickName(name)).toBe("Kung pao chicken");
  expect(draftCardView(draftCard()).pots[0]!.name).toBe("Chicken and kidney bean chili");
});

test("the applied card says how many days and pots and when the prep is", () => {
  const card = { ...draftCard(), phase: "applied" as const };
  const view = draftAppliedView(card);
  expect(prepWhen(card)).not.toBe("");
  expect(view.meta).toBe([t("meals.draft.days", { count: 3 }), t("meals.draft.pots", { count: 1 }), prepWhen(card)].join(" · "));
  expect(view.title).toBe(t("meals.draft.applied"));

  const noPrep = { ...card, pots: [], session: null };
  expect(prepWhen(noPrep)).toBe("");
  expect(draftAppliedView(noPrep).meta).toBe(t("meals.draft.days", { count: 3 }));
});
