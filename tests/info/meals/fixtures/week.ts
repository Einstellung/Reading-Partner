// One week of four meals a day, shared by the meals tests: made meals from the
// food table with roles, a flavour that never repeats across two main meals in
// a row, fish twice, and one each of the other modes. The grams are solved by
// the program (solvedWeek), never written here.

import type { Profile } from "../../../../src/info/meals/nutrition/targets";
import type { TemplateItem } from "../../../../src/info/meals/nutrition/solve";
import { solvePlan, targetsOf } from "../../../../src/info/meals/plan/solve-week";
import type {
  DayPlan,
  Flavour,
  Meal,
  MealsCharter,
  MealsState,
  ShoppingState,
  WeekPlan,
} from "../../../../src/info/meals/plan/types";
import { EMPTY_SHOPPING, MEAL_KEYS } from "../../../../src/info/meals/plan/types";
import { addDays } from "../../../../src/info/meals/plan/week";

// A Monday.
export const MON = "2026-09-21";

export function profile(over: Partial<Profile> = {}): Profile {
  return {
    consent: "manual",
    goal: "steady",
    sex: "f",
    age: 30,
    heightCm: 165,
    weightKg: 60,
    trainingDays: [1, 3, 5],
    trainTime: "evening",
    work: "sit",
    effort: "simple",
    people: 1,
    shops: ["Hema"],
    kitchen: ["microwave", "one pan"],
    dislikes: [],
    ...over,
  };
}

export function charter(over: Partial<Profile> = {}): MealsCharter {
  return { profile: profile(over), text: "Lunch is at my desk on weekdays.", updatedAt: 1 };
}

const P = (foodId: string): TemplateItem => ({ foodId, role: "protein" });
const C = (foodId: string): TemplateItem => ({ foodId, role: "staple" });
const F = (foodId: string): TemplateItem => ({ foodId, role: "fat" });
const X = (foodId: string, grams: number): TemplateItem => ({ foodId, role: "fixed", grams });

function make(name: string, searchName: string, flavour: Flavour, minutes: number, items: TemplateItem[]): Meal {
  return { mode: "make", name, searchName, flavour, minutes, method: `${name}: assemble and eat.`, items };
}

export const yogurtBowl = () =>
  make("希腊酸奶燕麦碗", "greek yogurt bowl", "sweet", 5, [P("greek_yogurt"), C("oats"), F("walnuts"), X("blueberries", 80)]);
export const eggToast = () =>
  make("鸡蛋全麦吐司", "egg toast", "plain", 8, [P("egg"), C("whole_wheat_toast"), X("cherry_tomato", 100)]);
export const shrimpRice = () =>
  make("虾仁杂粮饭", "shrimp rice bowl", "soy-ginger", 10, [
    P("frozen_shrimp"),
    C("microwave_grain_rice"),
    F("olive_oil"),
    X("frozen_mixed_veg", 150),
    X("light_soy_sauce", 15),
  ]);
export const tunaPita = () =>
  make("金枪鱼口袋饼", "tuna pita", "lemon-pepper", 8, [P("canned_tuna_water"), C("whole_wheat_pita"), F("olive_oil"), X("cucumber", 150)]);
export const chickenPotato = () =>
  make("鸡胸红薯沙拉", "chicken sweet potato salad", "vinaigrette", 10, [
    P("ready_chicken_breast"),
    C("sweet_potato"),
    F("olive_oil"),
    X("romaine", 150),
  ]);
export const salmonRice = () =>
  make("照烧三文鱼饭", "teriyaki salmon bowl", "teriyaki", 10, [
    P("salmon"),
    C("microwave_grain_rice"),
    X("bok_choy", 200),
    X("teriyaki_sauce", 20),
  ]);
export const yogurtBanana = () =>
  make("酸奶香蕉", "yogurt banana", "sweet", 2, [P("greek_yogurt"), X("banana", 150), F("almonds")]);

/** The week as the model drafted it: templates, no grams. */
export function draftWeek(): WeekPlan {
  const day = (i: number, d: Omit<DayPlan, "date">): DayPlan => ({ date: addDays(MON, i), ...d });
  return {
    id: `week-${MON}`,
    startDate: MON,
    createdAt: 1,
    revision: 1,
    days: [
      day(0, { breakfast: yogurtBowl(), lunch: shrimpRice(), dinner: salmonRice(), snack: yogurtBanana() }),
      day(1, { breakfast: eggToast(), lunch: tunaPita(), dinner: chickenPotato(), snack: yogurtBanana() }),
      day(2, { breakfast: yogurtBowl(), lunch: shrimpRice(), dinner: { mode: "delivery", place: "the usual place" }, snack: yogurtBanana() }),
      day(3, { breakfast: eggToast(), lunch: chickenPotato(), dinner: salmonRice(), snack: yogurtBanana() }),
      day(4, { breakfast: yogurtBowl(), lunch: tunaPita(), dinner: shrimpRice(), snack: yogurtBanana() }),
      day(5, { breakfast: { mode: "bought", place: "coffee on the way" }, lunch: chickenPotato(), dinner: salmonRice(), snack: { mode: "skip" } }),
      day(6, { breakfast: eggToast(), lunch: shrimpRice(), dinner: { mode: "skip", note: "late lunch" }, snack: yogurtBanana() }),
    ],
  };
}

/** The drafted week with its grams solved against the fixture profile. */
export function week(): WeekPlan {
  const c = charter();
  const targets = targetsOf(c, "other");
  if (!targets) throw new Error("fixture profile has no targets");
  return solvePlan(draftWeek(), targets, c.profile);
}

// --- a week with pots (docs/73 一锅) ------------------------------------------

/** A meal that eats from a pot, with the pot's food as its protein item, as assembly leaves it. */
export function potMeal(name: string, flavour: Flavour, pot: string, foodId: string, staple: string, veg: string): Meal {
  return { ...make(name, name, flavour, 10, [P(foodId), C(staple), X(veg, 200)]), pot };
}

/**
 * The fixture week with two pots: beef shank, 600 g cooked at Monday's dinner
 * for four meals (Tuesday and Wednesday from the fridge, Friday from the
 * freezer), and chicken breast, 400 g cooked at Thursday's lunch for three
 * (Saturday from the fridge, Sunday from the freezer).
 */
export function draftPotWeek(): WeekPlan {
  const plan = draftWeek();
  const d = (i: number) => plan.days[i] as DayPlan;
  const beef = "beef_shank_raw";
  const chicken = "chicken_breast";
  d(0).dinner = potMeal("卤牛腱配馒头", "garlic", "A", beef, "steamed_bun", "bok_choy");
  d(1).lunch = potMeal("牛腱拌面", "sesame", "A", beef, "dried_noodles", "bok_choy");
  d(2).lunch = potMeal("咖喱牛腱饭", "curry", "A", beef, "microwave_grain_rice", "frozen_mixed_veg");
  d(4).lunch = potMeal("黑椒牛腱饭", "black-pepper", "A", beef, "microwave_grain_rice", "frozen_mixed_veg");
  d(3).lunch = potMeal("蒜香鸡胸饭", "garlic", "B", chicken, "microwave_grain_rice", "bok_choy");
  d(5).lunch = potMeal("番茄鸡丝面", "tomato", "B", chicken, "dried_noodles", "frozen_mixed_veg");
  d(6).lunch = potMeal("照烧鸡丝饭", "teriyaki", "B", chicken, "microwave_grain_rice", "bok_choy");
  plan.pots = [
    { id: "A", foodId: beef, rawG: 600, cook: { date: MON, meal: "dinner" }, name: "卤牛腱", method: "电压力锅卤 40 分钟" },
    { id: "B", foodId: chicken, rawG: 400, cook: { date: addDays(MON, 3), meal: "lunch" }, name: "蒸鸡胸", method: "蒸 15 分钟，撕成丝" },
  ];
  return plan;
}

/** The pot week with its grams solved against the fixture profile. */
export function potWeek(): WeekPlan {
  const c = charter();
  const targets = targetsOf(c, "other");
  if (!targets) throw new Error("fixture profile has no targets");
  return solvePlan(draftPotWeek(), targets, c.profile);
}

export function shopping(over: Partial<ShoppingState> = {}): ShoppingState {
  return { ...EMPTY_SHOPPING, items: [], reader: [], dropped: {}, replaced: {}, checked: {}, ...over };
}

export function state(over: Partial<MealsState> = {}): MealsState {
  return { charter: charter(), plan: week(), shopping: shopping(), deviations: [], ...over };
}

/** A week as the model would send it: day numbers, food ids and roles, no grams it does not own. */
export function sent(plan: WeekPlan): Record<string, unknown>[] {
  return plan.days.map((day, i) => {
    const out: Record<string, unknown> = { day: i + 1 };
    for (const key of MEAL_KEYS) {
      const { solved: _solved, items, ...rest } = day[key];
      out[key] = items
        ? { ...rest, items: items.map((it) => ({ food: it.foodId, role: it.role, ...(it.grams ? { grams: it.grams } : {}) })) }
        : rest;
    }
    return out;
  });
}
