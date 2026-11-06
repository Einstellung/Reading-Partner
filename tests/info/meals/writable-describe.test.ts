// What an edit_data change says about itself (docs/platform/687): the describe
// lines of the meals entries, which the confirmation card shows the reader and
// the model reads back, and the planner's sentences with dates beside the day
// numbers. Also the labels of the tools in the trace, which come from i18n.
// Run: scripts/t.sh tests/info/meals/writable-describe.test.ts

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, getLocale, setLocale, t, type Locale } from "../../../src/i18n";
import { buildEditTools } from "../../../src/housekeeper/write";
import { buildMealsReadTools } from "../../../src/info/meals/read-tools";
import { parseMealsFile } from "../../../src/info/meals/plan/store";
import type { MealsState } from "../../../src/info/meals/plan/types";
import { mealsDishesEntry, mealsDraftEntry, mealsPlanEntry, datedDays, type DishesCopy, type MealsWriteDeps } from "../../../src/info/meals/writable";
import type { MealsPorts } from "../../../src/info/meals/apply";
import { SEED_DISHES } from "../../../src/info/meals/dishes/seed";

const meals: unknown = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/replay-1031-meals.json"), "utf8"));

const before = getLocale();
beforeEach(() => setLocale("en"));
afterEach(() => setLocale(before));

function plan(): MealsState {
  const state = parseMealsFile(meals);
  if (!state) throw new Error("fixture does not parse");
  return state;
}

/** The plan with `change` applied to its planner draft (a plain JSON object). */
function withDraft(state: MealsState, change: (draft: any) => void): MealsState {
  const copy = JSON.parse(JSON.stringify(state)) as MealsState;
  change(copy.plan!.planner!.draft);
  return copy;
}

const deps = {} as MealsWriteDeps;

describe("the plan entry's describe lines", () => {
  const entry = mealsPlanEntry(deps);
  const start = plan().plan!.planner!.start; // 2026-10-31, three days

  test("fewer days: the range the plan ran and now runs, by date", () => {
    const was = plan();
    const now = withDraft(was, (d) => {
      d.days = d.days.slice(0, 2);
    });
    const lines = entry.describe(was, now);
    expect(lines).toContain("The plan runs from October 31 to November 1, where it ran from October 31 to November 2");
  });

  test("the same in Chinese, with the dates in the reader's form", () => {
    setLocale("zh-CN");
    const was = plan();
    const now = withDraft(was, (d) => {
      d.days = d.days.slice(0, 2);
    });
    const lines = entry.describe(was, now);
    expect(lines).toContain("计划从10月31日到11月2日改为10月31日到11月1日");
  });

  test("a pot's raw weight is named with the pot and its dish", () => {
    const was = plan();
    const now = withDraft(was, (d) => {
      d.batches.find((b: any) => b.id === "chicken").rawG = 600;
    });
    const lines = entry.describe(was, now);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Pot chicken: .+, raw weight 600 g$/);
  });

  test("a changed lunch carries its date, not a day number", () => {
    const was = plan();
    const now = withDraft(was, (d) => {
      d.days[1].lunch.main = d.days[1].dinner.main;
    });
    const lines = entry.describe(was, now);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^November 1 Lunch: /);
    expect(lines.join("\n")).not.toContain("Day ");
  });

  test("a moved prep session says where it is now", () => {
    const was = plan();
    const now = withDraft(was, (d) => {
      d.sessions[0].day = 2;
    });
    expect(entry.describe(was, now)).toEqual(["Prep session prep: November 1, morning"]);
    expect(start).toBe("2026-10-31");
  });

  test("a note is named by date and meal", () => {
    const was = plan();
    const now = JSON.parse(JSON.stringify(was)) as MealsState;
    now.plan!.days[0]!.lunch.note = "less salt";
    expect(entry.describe(was, now)).toEqual([`${new Intl.DateTimeFormat("en", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${now.plan!.days[0]!.date}T00:00:00Z`))} Lunch note: less salt`]);
  });
});

describe("the draft entry's describe lines", () => {
  test("moving the first day says from which date to which", () => {
    const entry = mealsDraftEntry({ ports: {} as MealsPorts } as MealsWriteDeps);
    const file: any = { draft: plan().plan!.planner!.draft, startDate: "2026-11-06" };
    const lines = entry.describe(file, { ...file, startDate: "2026-11-07" });
    expect(lines).toContain("The first day moves from November 6 to November 7");
  });
});

describe("the dishes entry's describe lines", () => {
  test("added, changed and removed", () => {
    const entry = mealsDishesEntry(deps);
    const seed = SEED_DISHES[0]!;
    const was: DishesCopy = { dishes: { old: { ...seed, id: "old", name: "Old" }, kept: { ...seed, id: "kept", name: "Kept" } }, seed: {} };
    const now: DishesCopy = {
      dishes: { kept: { ...seed, id: "kept", name: "Kept 2" }, fresh: { ...seed, id: "fresh", name: "Fresh" } },
      seed: {},
    };
    expect(entry.describe(was, now)).toEqual(["Changed dish Kept 2 (kept)", "Added dish Fresh (fresh)", "Removed dish Old (old)"]);
  });
});

describe("the planner's sentences in edit_data", () => {
  test("a day number gets its date beside it", () => {
    expect(datedDays("Day 2 sodium is 2102 mg; at most 2000.", "2026-11-06")).toBe("2026-11-07 (Day 2) sodium is 2102 mg; at most 2000.");
  });

  test("the prep day is the day before Day 1, and says so", () => {
    expect(datedDays("Session a is on Day 0 (the prep day) morning", "2026-11-06")).toBe("Session a is on 2026-11-05 (Day 0, the prep day) morning");
    expect(datedDays("Day 0 dinner (the prep day) eats from a pot", "2026-11-06")).toBe("2026-11-05 (Day 0) dinner (the prep day) eats from a pot");
    expect(datedDays("Session a is on day 0 morning", "2026-11-06")).toBe("Session a is on 2026-11-05 (day 0) morning");
  });

  test("text without a day number, and a number of days, are left alone", () => {
    const text = "a 3-day plan has at most 2 red meat meals, 4 days after";
    expect(datedDays(text, "2026-11-06")).toBe(text);
  });
});

describe("tool labels in the trace come from the catalogs", () => {
  const readTools = () =>
    buildMealsReadTools({ state: async () => plan(), today: () => "2026-11-01", region: () => "other" });

  test("every meals read tool has a label in every language, none of them the English text elsewhere", () => {
    const english = new Map<string, string>();
    setLocale("en");
    for (const tool of readTools()) english.set(tool.name, tool.label({}));
    for (const locale of LOCALES as readonly Locale[]) {
      setLocale(locale);
      for (const tool of readTools()) {
        const label = tool.label({});
        expect(label).not.toBe("");
        if (locale !== "en") expect(label).not.toBe(english.get(tool.name));
      }
    }
  });

  test("the draft read in Chinese is Chinese", () => {
    setLocale("zh-CN");
    const draft = readTools().find((x) => x.name === "meals_read_draft")!;
    expect(draft.label({})).toBe(t("meals.tool.readDraft"));
    expect(draft.label({})).toBe("正在看计划草稿");
  });

  test("edit_data and undo_edit name what they do, not that they are running, in every language", () => {
    const [edit, undo] = buildEditTools([], { initiator: {} });
    setLocale("en");
    expect(edit!.label({})).toBe("Edit by program");
    expect(undo!.label({})).toBe("Undo of the last edit");
    setLocale("zh-CN");
    expect(edit!.label({})).toBe("用程序改数据");
    for (const locale of LOCALES as readonly Locale[]) {
      setLocale(locale);
      expect(edit!.label({})).toBe(t("chat.editData.label"));
      expect(undo!.label({})).toBe(t("chat.undoEdit.label"));
    }
  });
});
