// The note on the meals page when a written plan breaks a draft rule
// (src/info/meals/screen/plan-note.ts): one plain line per rule, calcium first
// with its way out, a few lines at most, and a dismissal that holds until the
// problems change.
// Run: scripts/t.sh tests/info/meals/screen/plan-note.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import type { DraftRule } from "../../../../src/info/meals/planner/checks";
import {
  createPlanNoteStore,
  PLAN_NOTE_MAX_LINES,
  planNoteKey,
  planNoteLines,
  type PlanNoteCheck,
} from "../../../../src/info/meals/screen/plan-note";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

// 2026-11-02 is a Monday: Day 1 Monday, Day 2 Tuesday, Day 0 the Sunday before.
const START = "2026-11-02";
const check = (...problems: { rule: DraftRule; day?: number }[]): PlanNoteCheck => ({ start: START, problems });

test("no problems, no note", () => {
  expect(planNoteLines(null)).toEqual([]);
  expect(planNoteLines(check())).toEqual([]);
});

test("calcium says which days and one way to fix it, in words for the reader", () => {
  const lines = planNoteLines(check({ rule: "calcium", day: 2 }, { rule: "calcium", day: 4 }));
  expect(lines).toEqual([
    "No calcium source on Tuesday, Thursday. Tell Lumen to add milk, yogurt, firm tofu or a green like bok choy.",
  ]);
  // Not the model's sentence.
  expect(lines[0]).not.toContain("Day 2");
});

test("problems are grouped by rule, calcium first, the rest in the checker's order", () => {
  const lines = planNoteLines(
    check(
      { rule: "vegetables", day: 1 },
      { rule: "sodium", day: 3 },
      { rule: "vegetables", day: 3 },
      { rule: "calcium", day: 1 },
    ),
  );
  expect(lines).toEqual([
    "No calcium source on Monday. Tell Lumen to add milk, yogurt, firm tofu or a green like bok choy.",
    "Fewer vegetables than the plan aims for on Monday, Wednesday.",
    "More salt than the daily limit on Wednesday.",
  ]);
});

test("a rule about the whole plan has no days; an unlisted rule still gets an accurate line", () => {
  expect(planNoteLines(check({ rule: "fish" }))).toEqual(["No fish or shrimp in the plan."]);
  // Legumes carry the day their three-day window starts; the reader gets the window, not a day.
  expect(planNoteLines(check({ rule: "legumes", day: 1 }))).toEqual(["Three days in a row without beans, lentils or tofu."]);
  expect(planNoteLines(check({ rule: "ways_vary" }))).toEqual(["Something in the plan breaks a planning rule."]);
});

test("the note is capped: past the cap, the last line counts the rest", () => {
  const rules: DraftRule[] = ["calcium", "vegetables", "sodium", "protein", "fish"];
  const lines = planNoteLines(check(...rules.map((rule) => ({ rule, day: 1 }))));
  expect(lines).toHaveLength(PLAN_NOTE_MAX_LINES);
  expect(lines[0]).toStartWith("No calcium source");
  expect(lines[PLAN_NOTE_MAX_LINES - 1]).toBe("And 3 more things the plan falls short on; ask Lumen about them.");
  // Exactly at the cap, every rule has its own line.
  expect(planNoteLines(check(...rules.slice(0, PLAN_NOTE_MAX_LINES).map((rule) => ({ rule, day: 1 }))))).toHaveLength(PLAN_NOTE_MAX_LINES);
});

test("days already past are left out, and a rule left with none is dropped", () => {
  const c = check({ rule: "calcium", day: 1 }, { rule: "calcium", day: 3 }, { rule: "sodium", day: 1 });
  expect(planNoteLines(c, "2026-11-03")).toEqual([
    "No calcium source on Wednesday. Tell Lumen to add milk, yogurt, firm tofu or a green like bok choy.",
  ]);
});

test("in Chinese the days are listed the Chinese way", () => {
  setLocale("zh-CN");
  expect(planNoteLines(check({ rule: "calcium", day: 2 }, { rule: "calcium", day: 4 }))).toEqual([
    "星期二、星期四没有补钙的食物。跟卢明说一声，加牛奶、酸奶、老豆腐或小油菜这类绿叶菜。",
  ]);
});

test("the same problems make the same key, whatever their order", () => {
  const a = check({ rule: "calcium", day: 1 }, { rule: "sodium", day: 2 });
  const b = check({ rule: "sodium", day: 2 }, { rule: "calcium", day: 1 }, { rule: "calcium", day: 1 });
  expect(planNoteKey(a)).toBe(planNoteKey(b));
  expect(planNoteKey(a)).not.toBe(planNoteKey(check({ rule: "calcium", day: 2 })));
  expect(planNoteKey(check())).toBe("");
});

test("the store shows a check, hides it on dismiss, and only different problems bring it back", () => {
  const store = createPlanNoteStore();
  let heard = 0;
  const off = store.subscribe(() => heard++);
  const calcium = check({ rule: "calcium", day: 1 });

  store.show(calcium);
  expect(store.current()).toBe(calcium);
  store.dismiss();
  expect(store.current()).toBeNull();

  // The same problems again, say after another profile change: still dismissed.
  store.show(check({ rule: "calcium", day: 1 }));
  expect(store.current()).toBeNull();

  // Different problems: the note is back.
  const more = check({ rule: "calcium", day: 1 }, { rule: "sodium", day: 2 });
  store.show(more);
  expect(store.current()).toBe(more);

  // A write that comes back clean takes it down.
  store.show(check());
  expect(store.current()).toBeNull();
  expect(heard).toBe(4);
  off();
  store.show(more);
  expect(heard).toBe(4);
});
