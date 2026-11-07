// Which library dish a meal's page opens with (src/info/meals/recipe/meal-dish.ts):
// the pot's dish for a meal of a batch, the dish itself for a main or breakfast
// made fresh, nothing for a meal that is not of a library dish. The fixture is
// the two-day plan of pot-cooking.test.ts: adobo (both lunches), chili (day 1
// dinner), tomato-braised cod on day 2 dinner, a yogurt breakfast on day 1.
// Run: scripts/t.sh tests/info/meals/recipe/meal-dish.test.ts

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { parseMealsFile } from "../../../../src/info/meals/plan/store";
import type { MealKey, MealsState } from "../../../../src/info/meals/plan/types";
import { mealDish } from "../../../../src/info/meals/recipe/meal-dish";
import { dayViewOn, type MealView } from "../../../../src/info/meals/screen/view";

const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "../fixtures", name), "utf8"));
const TODAY = "2026-11-07";

let was: Locale;
let state: MealsState;
beforeAll(() => {
  was = getLocale();
  setLocale("zh-CN");
  const parsed = parseMealsFile(read("adobo-plan.json"));
  if (!parsed) throw new Error("fixture does not parse");
  state = parsed;
});
afterAll(() => setLocale(was));

function view(date: string, key: MealKey): MealView {
  const v = dayViewOn(state, date, TODAY, "CN")?.meals.find((m) => m.key === key);
  if (!v) throw new Error(`no ${key} on ${date}`);
  return v;
}

const dishOf = (date: string, key: MealKey, language: "zh-CN" | "en" = "zh-CN") =>
  mealDish(view(date, key), state.plan, date, state.charter!.profile, language);

test("a lunch of a batch pot opens with the pot's dish: name, cuisine, taste and method", () => {
  expect(dishOf(TODAY, "lunch")).toEqual({
    id: "chicken_adobo",
    name: "菲律宾酱油醋焖鸡（adobo）",
    cuisine: "东南亚菜",
    taste: "咸酸口，醋焖过后酸味变柔和，蒜香和黑胡椒明显，酱汁偏稀适合拌饭。",
    summary: "鸡腿肉与洋葱、酱油、米醋和蒜蓉酱一起焖 25 分钟",
  });
  expect(dishOf("2026-11-08", "lunch")?.id).toBe("chicken_adobo");
  expect(dishOf(TODAY, "dinner")?.id).toBe("beef_black_bean_chili");
});

test("a main made fresh opens with its own library dish", () => {
  const d = dishOf("2026-11-08", "dinner");
  expect(d).toMatchObject({ id: "tomato_braised_cod", name: "番茄炖鳕鱼" });
  expect(d?.taste).toBe("番茄酸甜，牛至带草香，鳕鱼肉细嫩易散，酱汁清爽。");
});

test("a breakfast from the library opens with its dish", () => {
  expect(dishOf(TODAY, "breakfast")?.id).toBe("yogurt_blueberry_toast_egg");
});

test("the English side reads the English fields", () => {
  const d = dishOf("2026-11-08", "dinner", "en");
  expect(d?.name).toBe("Tomato-braised cod");
  expect(d?.taste).toBe("Sweet-tart tomato with oregano; delicate cod that flakes easily in a light sauce.");
  expect(d?.summary).toMatch(/^Tomato, onion and zucchini/);
});

test("a snack, a date the plan does not cover, a changed meal and a meal that is not made give nothing", () => {
  const profile = state.charter!.profile;
  const dinner = view("2026-11-08", "dinner");
  expect(dishOf(TODAY, "snack")).toBeNull();
  expect(mealDish(dinner, state.plan, "2026-11-20", profile, "zh-CN")).toBeNull();
  expect(mealDish({ ...dinner, meal: { ...dinner.meal, searchName: "grandma's soup" } }, state.plan, "2026-11-08", profile, "zh-CN")).toBeNull();
  expect(mealDish({ ...dinner, mode: "out" }, state.plan, "2026-11-08", profile, "zh-CN")).toBeNull();
  expect(mealDish(dinner, null, "2026-11-08", profile, "zh-CN")).toBeNull();
});
