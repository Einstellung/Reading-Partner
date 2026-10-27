// The prep page (src/info/meals/screen/prep-view.ts, docs/671 备餐页): what is
// cooked, what to have ready and the containers, the packing, where everything
// goes, the evenings, and Done, derived from a stored planner plan.
// Run: scripts/t.sh tests/info/meals/screen/prep-view.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import { prepView, shopGroup } from "../../../../src/info/meals/screen/prep-view";
import { state as weekState } from "../fixtures/week";
import { dayBefore, eveningBefore, plannerState, PREP_DATE, START } from "./batch-cook-fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

const view = (s = plannerState(), session: string | null = "s1", today = START) => prepView(s, session, today, "other");

test("section 1: the pot, how it is cooked, the meals that eat it with the one eaten as it is cooked, and the rice batch", () => {
  const v = view()!;
  expect(v).toMatchObject({ session: "s1", date: START, title: "Prep · Mon, 11/2", done: false });
  expect(v.minutes).toMatch(/^\d+ min hands-on · about \d+ min$/);
  expect(v.pots).toHaveLength(1);
  const pot = v.pots[0]!;
  expect(pot).toMatchObject({ batch: "chili", name: "Chicken and kidney bean chili", cuisine: "American" });
  expect(pot.how).toMatch(/^Stove · \d+ min hands-on · about \d+ min$/);
  expect(pot.method.length).toBeGreaterThan(0);
  // The afternoon session's dinner is eaten from the pot as it is cooked.
  expect(pot.meals).toEqual([
    { text: "Day 1 Dinner", now: true },
    { text: "Day 2 Lunch", now: false },
  ]);
  expect(pot.meal?.mode).toBe("make");
  expect(pot.items.some((i) => i.foodId === "chicken_thigh" && i.role === "protein")).toBe(true);
  expect(pot.portion).toMatch(/^\d+ kcal · protein \d+ g a portion$/);
  expect(v.rice?.name).toContain("Brown rice");
});

test("section 2: have ready, grouped, in packs and pieces, never grams to weigh, each saying which pot it is for", () => {
  const v = view()!;
  expect(v.shop.map((g) => g.group)).toEqual(["protein", "veg", "dry", "seasoning"]);
  const rows = v.shop.flatMap((g) => g.rows);
  const chicken = rows.find((r) => r.key === "chicken_thigh")!;
  expect(chicken.dishes).toBe("for Chicken and kidney bean chili");
  expect(chicken.qty).toMatch(/pack/);
  expect(v.shop.find((g) => g.group === "seasoning")!.rows.every((r) => r.qty === "on hand")).toBe(true);
  // The batch rice is had ready with the pots.
  expect(rows.some((r) => r.key === "brown_rice_cooked")).toBe(true);
  expect(rows.every((r) => !/^\d+ g$/.test(r.qty))).toBe(true);
  // The containers: food boxes for a reader who boxes, and one for the rice.
  expect(v.containers.map((c) => c.name)).toEqual(expect.arrayContaining(["Food boxes", "Lidded container for rice"]));
});

test("sections 4 and 5: a boxed pot portion per later meal, and where each thing goes", () => {
  const v = view()!;
  expect(v.boxes).toHaveLength(1);
  expect(v.boxes[0]).toMatchObject({ meal: "Day 2 Lunch" });
  expect(v.boxes[0]!.what).toContain("Chicken and kidney bean chili");
  expect(v.fridgeLede.length).toBeGreaterThan(0);
  expect(v.places.map((p) => p.place)).toEqual(expect.arrayContaining(["fridge", "freezer", "cupboard"]));
  expect(v.places.find((p) => p.place === "fridge")!.rows[0]!.name).toContain("Chicken and kidney bean chili");
});

test("a reader who does not box: no packing section and no food boxes, the pot kept in one container", () => {
  const v = view(plannerState({ profile: { boxes: false } }))!;
  expect(v.boxes).toEqual([]);
  expect(v.containers.map((c) => c.name)).not.toContain("Food boxes");
  expect(v.pots).toHaveLength(1);
});

test("a prep on the day before Day 1: dated that day, the prep day's dinner eaten from the pot", () => {
  const v = view(plannerState({ draft: dayBefore() }), "s1", PREP_DATE)!;
  expect(v.date).toBe(PREP_DATE);
  expect(v.title).toBe("Prep · Sun, 11/1");
  expect(v.pots[0]!.meals[0]).toEqual({ text: "Prep day Dinner", now: true });
  expect(v.done).toBe(false);
  // Opened again on Day 1 it reads as done: its day is past.
  expect(view(plannerState({ draft: dayBefore() }), "s1", START)!.done).toBe(true);
});

test("section 6: the evening before carries the soy milk for Day 1's breakfast", () => {
  const v = view(plannerState({ draft: eveningBefore() }), "s1", PREP_DATE)!;
  expect(v.nights.length).toBeGreaterThan(0);
  expect(v.nights[0]!.title).toBe("Evening of the prep day");
  expect(v.nights[0]!.lines.length).toBeGreaterThan(0);
});

test("section 7: Done is the stored mark", () => {
  expect(view(plannerState({ preppedAt: 5 }))!.done).toBe(true);
});

test("no page for a session that is not the plan's, a plan without a prep, or a reader with no profile", () => {
  expect(view(plannerState(), "s9")).toBeNull();
  expect(view(plannerState(), null)?.session).toBe("s1");
  expect(view(weekState(), null)).toBeNull();
  expect(view({ ...plannerState(), charter: null }, null)).toBeNull();
});

test("shopGroup: seasonings and oil by role, produce as vegetables, fresh proteins apart from dry goods", () => {
  const f = (id: string) => foodById(id)!;
  expect(shopGroup(f("chicken_thigh"), "protein")).toBe("protein");
  expect(shopGroup(f("onion"), "fixed")).toBe("veg");
  expect(shopGroup(f("canned_kidney_beans"), "staple")).toBe("dry");
  expect(shopGroup(f("ground_cumin"), "seasoning")).toBe("seasoning");
});
