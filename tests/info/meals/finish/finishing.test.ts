// The eating-day steps of a meal eaten from a prepped box (docs/671 吃的那天):
// the reheat rules, the fixture plan's box meals in Chinese and English, the
// library's coverage of every side, staple and add-on, the tonight notes, the
// entry check of the steps, the recipe call they replace, and the shopping
// line of a spice.
// Run: scripts/t.sh tests/info/meals/finish/finishing.test.ts

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { checkDish, checkFinish } from "../../../../src/info/meals/dishes/check";
import { fallbackFinish, FOOD_FINISH } from "../../../../src/info/meals/dishes/food-finish";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import type { Dish, Equipment } from "../../../../src/info/meals/dishes/types";
import { eatsBox, finishingFor, foodWord, pickFinish, reheatStep } from "../../../../src/info/meals/finish/finishing";
import { tonightNotes } from "../../../../src/info/meals/finish/tonight";
import { FOODS, foodById } from "../../../../src/info/meals/nutrition/foods";
import { parseMealsFile } from "../../../../src/info/meals/plan/store";
import type { MealsState } from "../../../../src/info/meals/plan/types";
import type { PackLine } from "../../../../src/info/meals/planner/packs";
import { packQty } from "../../../../src/info/meals/planner/trip";
import { modelWritesRecipe, recipeKey, recipePot, recipeRequest } from "../../../../src/info/meals/recipe/recipe";
import { mealsView, type MealView } from "../../../../src/info/meals/screen/view";

const fixture = (): MealsState => {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/batch-plan.json"), "utf8"));
  const state = parseMealsFile(raw);
  if (!state) throw new Error("fixture does not parse");
  return state;
};

let was: Locale;
beforeAll(() => {
  was = getLocale();
});
afterAll(() => setLocale(was));

/** Every made meal of the fixture, drawn in `ui`. */
function meals(state: MealsState, ui: Locale): { date: string; view: MealView }[] {
  setLocale(ui);
  return mealsView(state, "2026-10-30", "CN").week.flatMap((d) => d.meals.map((view) => ({ date: d.date, view })));
}

const at = (list: { date: string; view: MealView }[], date: string, key: string) => {
  const hit = list.find((m) => m.date === date && m.view.key === key);
  if (!hit) throw new Error(`${date} ${key} missing`);
  return hit.view;
};

const MICROWAVE: ReadonlySet<Equipment> = new Set(["stove", "microwave"]);
const STOVE: ReadonlySet<Equipment> = new Set(["stove"]);

describe("reheating a box", () => {
  test("a meat box is 3 minutes in the microwave, stirred halfway, hot all through", () => {
    const r = reheatStep({ what: "鸡胸肉盒", kind: "meat", rice: false, kitchen: MICROWAVE, language: "zh-CN" });
    expect(r.minutes).toBe(3);
    expect(r.step).toContain("微波炉");
    expect(r.step).toContain("中途翻一下");
    expect(r.step).toContain("中间不凉");
    expect(r.step).not.toContain("米饭上洒");
    expect(r.line).toBe("热鸡胸肉盒 3 分钟");
  });

  test("with rice it is 4 minutes and the rice gets a splash of water; a stew 4; rice alone 2", () => {
    const both = reheatStep({ what: "the beef box", kind: "meat", rice: true, kitchen: MICROWAVE, language: "en" });
    expect(both.minutes).toBe(4);
    expect(both.step).toContain("a splash of water over the rice");
    expect(both.step.startsWith("Put the beef box in the microwave")).toBe(true);
    expect(reheatStep({ what: "x", kind: "stew", rice: false, kitchen: MICROWAVE, language: "en" }).minutes).toBe(4);
    expect(reheatStep({ what: "x", kind: null, rice: true, kitchen: MICROWAVE, language: "en" }).minutes).toBe(2);
  });

  test("with no microwave it goes in a covered pan with a splash of water", () => {
    const r = reheatStep({ what: "鸡胸肉盒", kind: "meat", rice: false, kitchen: STOVE, language: "zh-CN" });
    expect(r.minutes).toBe(6);
    expect(r.step).toContain("倒进锅里，加一点水，盖上盖子");
    expect(r.step).not.toContain("微波");
    const en = reheatStep({ what: "the beef box", kind: "stew", rice: true, kitchen: STOVE, language: "en" });
    expect(en.minutes).toBe(7);
    expect(en.step).toContain("a splash of water, cover and heat");
  });

  test("every language but Chinese reads in English", () => {
    const fr = reheatStep({ what: "the box", kind: "meat", rice: false, kitchen: MICROWAVE, language: "fr" });
    expect(fr.step).toBe(reheatStep({ what: "the box", kind: "meat", rice: false, kitchen: MICROWAVE, language: "en" }).step);
  });
});

describe("the fixture plan's box meals", () => {
  const state = fixture();
  const profile = state.charter!.profile;
  const HOME_ZH = new Set(["油", "盐", "黑胡椒粉", "菜籽油", "花生油", "橄榄油"]);

  for (const lang of ["zh-CN", "en"] as const) {
    test(`every box meal has a line, 2 to 4 steps and no grams (${lang})`, () => {
      const box = meals(state, lang).filter((m) => eatsBox(m.view));
      expect(box.map((m) => `${m.date} ${m.view.key}`)).toEqual([
        "2026-10-31 lunch",
        "2026-10-31 dinner",
        "2026-11-01 lunch",
        "2026-11-01 dinner",
        "2026-11-02 lunch",
      ]);
      for (const { view } of box) {
        const f = finishingFor(view, profile, lang)!;
        expect(f.line.length).toBeGreaterThan(0);
        expect(f.steps.length).toBeGreaterThanOrEqual(2);
        expect(f.steps.length).toBeLessThanOrEqual(4);
        for (const s of [f.line, ...f.steps, ...f.need]) {
          expect(s).not.toMatch(/\d+\s*(克|g\b)|温度计|thermometer|manual|说明书|\{/);
          expect(s.trim()).toBe(s);
          expect(s.length).toBeGreaterThan(0);
        }
      }
    });
  }

  test("the fresh fish dinner and the breakfasts keep their recipe page", () => {
    const list = meals(state, "zh-CN");
    expect(finishingFor(at(list, "2026-11-02", "dinner"), profile, "zh-CN")).toBeNull();
    expect(finishingFor(at(list, "2026-11-01", "breakfast"), profile, "zh-CN")).toBeNull();
  });

  test("a box with its rice and a fresh vegetable, in Chinese", () => {
    const f = finishingFor(at(meals(state, "zh-CN"), "2026-10-31", "dinner"), profile, "zh-CN")!;
    expect(f).toEqual({
      line: "热牛腱子和糙米饭盒 4 分钟，炒上海青 4 分钟",
      need: ["牛腱子和糙米饭 1 盒", "上海青", "油", "盐"],
      steps: [
        "上海青洗净切段，锅里放油，大火炒 3 到 4 分钟，加一点盐。",
        "牛腱子和糙米饭盒盖子留条缝放进微波炉，米饭上洒一点水，高火 4 分钟，中途翻一下，热到冒热气、中间不凉。",
        "装盘。",
      ],
    });
  });

  test("the same meal in English", () => {
    const f = finishingFor(at(meals(state, "en"), "2026-10-31", "dinner"), profile, "en")!;
    expect(f.line).toBe("Heat the beef and brown rice box 4 min, stir-fry the bok choy 4 min");
    expect(f.need).toEqual(["Beef and brown rice box", "Bok choy", "Cooking oil", "Salt"]);
    expect(f.steps[2]).toBe("Plate up.");
  });

  test("the household oil is the one the steps name", () => {
    const f = finishingFor(at(meals(state, "zh-CN"), "2026-10-31", "dinner"), { ...profile, cookingOil: "peanut_oil" }, "zh-CN")!;
    expect(f.steps[0]).toContain("锅里放花生油");
    expect(f.need).toContain("花生油");
    expect(f.need).not.toContain("油");
  });

  test("a wrap ends with filling the tortillas, and the staple is warmed", () => {
    const f = finishingFor(at(meals(state, "zh-CN"), "2026-11-01", "dinner"), profile, "zh-CN")!;
    expect(f.steps[0]).toContain("玉米饼皮");
    expect(f.steps[f.steps.length - 1]).toBe("把鸡胸肉和菜卷进玉米饼皮里。");
  });

  test("the meal at the prep session is ladled from the pot, not reheated", () => {
    const f = finishingFor(at(meals(state, "zh-CN"), "2026-10-31", "lunch"), profile, "zh-CN")!;
    expect(f.need[0]).toBe("鸡胸肉 1 份（锅里）");
    expect(f.steps.join("")).not.toContain("微波炉，");
    expect(f.line.startsWith("从锅里盛出")).toBe(true);
  });

  test("the need line names only the meal's own foods, then what is at home", () => {
    for (const { view } of meals(state, "zh-CN").filter((m) => eatsBox(m.view))) {
      const f = finishingFor(view, profile, "zh-CN")!;
      const rows = new Set(view.rows.map((r) => foodWord(foodById(r.foodId)!, true)));
      for (const n of f.need.slice(1)) {
        if (/份（|盒$/.test(n)) continue;
        expect(rows.has(n) || HOME_ZH.has(n), `${view.name}: ${n}`).toBe(true);
      }
    }
  });
});

describe("library coverage", () => {
  const sides = SEED_DISHES.filter((d) => d.role === "side");
  const staples = SEED_DISHES.filter((d) => d.role === "staple");
  const stapleIds = new Set(staples.map((d) => d.id));

  test("every side and staple carries valid eating-day steps", () => {
    expect(sides.length).toBe(16);
    expect(staples.length).toBe(13);
    for (const d of [...sides, ...staples]) {
      expect(d.finish, d.id).toBeDefined();
      expect(checkFinish(d.finish, d.ingredients.map((l) => l.food)), d.id).toEqual([]);
    }
  });

  test("every food entry is valid, and every add-on and staple food on a seed way has one", () => {
    for (const [id, finish] of Object.entries(FOOD_FINISH)) expect(checkFinish(finish, [id]), id).toEqual([]);
    for (const d of SEED_DISHES) {
      for (const w of d.ways ?? []) {
        for (const a of w.addOns) expect(FOOD_FINISH[a.food], `${d.id} ${a.food}`).toBeDefined();
        if (w.staple && !stapleIds.has(w.staple)) expect(FOOD_FINISH[w.staple], `${d.id} ${w.staple}`).toBeDefined();
      }
    }
  });

  test("the steps by kind are valid for every vegetable, frozen food and staple in the table", () => {
    const kinds = FOODS.filter((f) => f.roles.includes("veg") || f.roles.includes("staple") || f.category === "frozen");
    expect(kinds.length).toBeGreaterThan(20);
    for (const f of kinds) {
      const finish = fallbackFinish(f, { zh: foodWord(f, true), en: foodWord(f, false) });
      expect(finish.length, f.id).toBeGreaterThan(0);
      expect(checkFinish(finish, [f.id]), f.id).toEqual([]);
    }
  });

  test("the quickest way the kitchen fits is used", () => {
    const potato = SEED_DISHES.find((d) => d.id === "steamed_sweet_potato")!.finish!;
    expect(pickFinish(potato, new Set<Equipment>(["stove", "microwave", "steamer"]))!.equipment).toEqual(["microwave"]);
    expect(pickFinish(potato, new Set<Equipment>(["steamer"]))!.equipment).toEqual(["steamer"]);
  });
});

describe("the entry check of the steps", () => {
  const side = SEED_DISHES.find((d) => d.id === "garlic_bok_choy")!;
  const stapleIds = new Set(SEED_DISHES.filter((d) => d.role === "staple").map((d) => d.id));
  const rules = (d: Dish) => {
    const r = checkDish(d, { stapleDishIds: stapleIds });
    return r.ok ? [] : r.failures.filter((f) => f.rule === "finish").map((f) => f.message);
  };
  const one = side.finish![0]!;

  test("the seed side passes", () => expect(rules(side)).toEqual([]));

  test("empty, too many steps, zero minutes, a thermometer, an unknown placeholder", () => {
    expect(rules({ ...side, finish: [] })).toEqual(["eating-day steps: none"]);
    expect(rules({ ...side, finish: [{ ...one, steps: ["a", "b", "c", "d"], stepsEn: ["a", "b", "c", "d"] }] }).join()).toContain("4 steps");
    expect(rules({ ...side, finish: [{ ...one, minutes: 0 }] }).join()).toContain("positive number");
    expect(rules({ ...side, finish: [{ ...one, steps: ["用温度计量到 75 度"], stepsEn: ["check with a thermometer"] }] }).join()).toContain("thermometer");
    expect(rules({ ...side, finish: [{ ...one, steps: ["加{sauce}"], stepsEn: ["add {sauce}"] }] }).join()).toContain("{sauce}");
  });

  test("a food the dish does not carry, and no way for the default kitchen", () => {
    expect(rules({ ...side, finish: [{ ...one, steps: ["上海青加蚝油炒"], stepsEn: ["stir-fry with oyster sauce"] }] }).join()).toContain("oyster_sauce");
    expect(rules({ ...side, finish: [{ ...one, equipment: ["steamer"] }] }).join()).toContain("none fits");
    expect(rules({ ...SEED_DISHES.find((d) => d.role === "main")!, finish: [one] }).join()).toContain("only a side or a staple");
  });
});

describe("tonight", () => {
  test("the cod for tomorrow's dinner moves to the fridge the night before", () => {
    const state = fixture();
    expect(tonightNotes(state, "2026-11-01", "zh-CN", "CN")).toEqual(["今晚把明天晚餐用的鳕鱼从冷冻室移到冷藏室。"]);
    expect(tonightNotes(state, "2026-11-01", "en", "CN")).toEqual(["Move the cod for tomorrow's dinner from the freezer to the fridge tonight."]);
    expect(tonightNotes(state, "2026-10-31", "zh-CN", "CN")).toEqual([]);
    expect(tonightNotes(state, "2026-11-02", "zh-CN", "CN")).toEqual([]);
  });

  test("a meal that went differently needs nothing", () => {
    const state = fixture();
    const days = state.plan!.days.map((d) => (d.date === "2026-11-02" ? { ...d, dinner: { mode: "out" as const, place: "canteen" } } : d));
    expect(tonightNotes({ ...state, plan: { ...state.plan!, days } }, "2026-11-01", "zh-CN", "CN")).toEqual([]);
  });

  test("a soy milk breakfast tomorrow loads the maker tonight", () => {
    const state = fixture();
    const rec = state.plan!.planner!;
    const draft = rec.draft as { days: { breakfast: string }[] };
    const days = draft.days.map((d, i) => (i === 1 ? { ...d, breakfast: "soy_milk_maker_plain" } : d));
    const plan = { ...state.plan!, planner: { ...rec, draft: { ...draft, days } } };
    const notes = tonightNotes({ ...state, plan }, "2026-10-31", "en", "CN");
    expect(notes.some((n) => n.startsWith("Load the soy milk maker with") && n.includes("tomorrow's breakfast"))).toBe(true);
  });

  test("no plan, no notes", () => {
    expect(tonightNotes({ ...fixture(), plan: null }, "2026-11-01", "en", "CN")).toEqual([]);
  });
});

describe("the recipe call", () => {
  const state = fixture();
  const profile = state.charter!.profile;

  test("no model call for a box meal; a fresh meal and a breakfast still ask", () => {
    const list = meals(state, "zh-CN");
    for (const { view } of list.filter((m) => eatsBox(m.view))) {
      expect(modelWritesRecipe(view)).toBe(false);
      expect(recipeRequest(view, profile, "zh-CN")).toBeNull();
    }
    expect(recipeRequest(at(list, "2026-11-02", "dinner"), profile, "zh-CN")).not.toBeNull();
    expect(recipeRequest(at(list, "2026-11-01", "breakfast"), profile, "zh-CN")).not.toBeNull();
  });

  test("a meal that cooks a pot keeps its request and its stored key", () => {
    const list = meals(state, "zh-CN");
    const box = at(list, "2026-10-31", "dinner");
    const cooking: MealView = { ...box, pot: { ...box.pot!, cooks: true } };
    const req = recipeRequest(cooking, profile, "zh-CN")!;
    expect(req).not.toBeNull();
    const rows = cooking.rows.map((r) => ({ foodId: r.foodId, grams: r.grams }));
    expect(req.key).toBe(recipeKey(cooking.name, rows, profile.kitchen, "zh-CN", recipePot(cooking.pot)));
  });
});

describe("a spice on the shopping list", () => {
  const line = (food: string, grams: number, packG: number): PackLine => ({
    food,
    grams,
    buy: { by: "pack", count: 1, packG, kind: "jar" },
    firstDay: 1,
    lastDay: 3,
    freeze: false,
    frozen: false,
    leftover: null,
  });

  test("2 g of a spice is just the jar", () => {
    setLocale("en");
    const text = packQty(line("taco_seasoning", 2, 60));
    expect(text).not.toContain("needed");
    expect(text).toContain("60 g");
  });

  test("a large leftover of a food still names what is needed", () => {
    setLocale("en");
    expect(packQty(line("beef_shank_raw", 340, 600))).toContain("needed");
  });
});
