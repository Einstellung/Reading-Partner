// How the pot a meal eats from is cooked, on that meal's page (docs/671): the
// prep session's stored steps of the meal's batch, the rice's when the meal's
// rice is the session's, the plan's line before the steps are written, and
// nothing for a meal that is not of a batch. The fixture is a two-day plan with
// an adobo pot (both lunches) and a chili pot (day 1 dinner) cooked at the day
// 1 morning prep with a pressure cooker of brown rice.
// Run: scripts/t.sh tests/info/meals/recipe/pot-cooking.test.ts

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { parseMealsFile } from "../../../../src/info/meals/plan/store";
import type { MealKey, MealsState } from "../../../../src/info/meals/plan/types";
import { potCooking, type PotCooking } from "../../../../src/info/meals/recipe/pot-cooking";
import type { PrepStepsStatus } from "../../../../src/info/meals/screen/prep-timeline";
import { dayViewOn, type MealView } from "../../../../src/info/meals/screen/view";
import type { PrepStep } from "../../../../src/info/meals/timeline/steps";

const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "../fixtures", name), "utf8"));
const STEPS: PrepStep[] = read("adobo-prep.json").steps;
const READY: PrepStepsStatus = { kind: "ready", key: "k", at: 1, steps: STEPS };
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

function meal(date: string, key: MealKey): MealView {
  const view = dayViewOn(state, date, TODAY, "CN")?.meals.find((m) => m.key === key);
  if (!view) throw new Error(`no ${key} on ${date}`);
  return view;
}

const cook = (date: string, key: MealKey, status: PrepStepsStatus = READY) =>
  potCooking(meal(date, key), status, state.charter!.profile, "zh-CN");

const CHICKEN = ["将鸡腿肉切块，洋葱切片。", "锅中加少许油，用中火炒软鸡肉和洋葱。", "加入酱油、白醋、蒜蓉、黑胡椒和少许水，盖锅用小火焖25分钟。", "切开最厚的鸡肉，确认内部不再呈粉红色且流出的肉汁清澈。"];
const RICE = [
  "淘洗约420克生糙米并沥水。",
  "将糙米和2.5杯水（625毫升）放入压力锅，盖好后高压煮22分钟，另预留约10分钟升压。",
  "让压力锅自然泄压10分钟。",
  "确认压力已完全释放后打开锅盖，用饭勺拨松糙米饭。",
];

test("the prep day's lunch, ladled from the pot, shows the chicken's steps and the rice cooked beside it", () => {
  expect(cook(TODAY, "lunch")).toEqual({
    kind: "steps",
    groups: [
      { name: "菲律宾酱油醋焖鸡（adobo）", steps: CHICKEN },
      { name: "糙米饭", steps: RICE },
    ],
  });
});

test("the next day's lunch eats a box of the same pot over rice noodles: the chicken's steps, no rice", () => {
  expect(cook("2026-11-08", "lunch")).toEqual({ kind: "steps", groups: [{ name: "菲律宾酱油醋焖鸡（adobo）", steps: CHICKEN }] });
});

test("a box with kept rice in it shows the rice's steps after its own pot's", () => {
  const out = cook(TODAY, "dinner");
  expect(out?.kind).toBe("steps");
  if (out?.kind !== "steps") return;
  expect(out.groups.map((g) => g.name)).toEqual(["牛肉黑豆炖菜（chili）", "糙米饭"]);
  expect(out.groups[0]!.steps[0]).toBe("将牛腱子切块，洋葱和红彩椒切丁，沥干黑豆。");
  expect(out.groups[0]!.steps[out.groups[0]!.steps.length - 1]).toBe("确认黑豆从外到里都软烂，牛肉也已炖软。");
});

test("before the prep steps are written or read, the pot's line from the plan stands in", () => {
  const method: PotCooking = { kind: "method", name: "菲律宾酱油醋焖鸡（adobo）", method: "鸡腿肉与洋葱、酱油、米醋和蒜蓉酱一起焖 25 分钟" };
  for (const status of [{ kind: "none" }, { kind: "reading" }, { kind: "failed" }] as PrepStepsStatus[]) {
    expect(cook("2026-11-08", "lunch", status)).toEqual(method);
  }
  // Steps written for other pots only (a session the plan has since changed) say nothing of this one.
  const other: PrepStepsStatus = { ...READY, steps: STEPS.filter((s) => s.pot !== "chicken") };
  expect(cook("2026-11-08", "lunch", other)).toEqual(method);
});

test("a step shared by several pots goes with the batch's own, in the session's order", () => {
  const shared: PrepStep = { id: "13", text: "Heat the oil.", device: "stove", pot: null, active: 1, wait: 0, after: [] };
  const out = cook("2026-11-08", "lunch", { ...READY, steps: [shared, ...STEPS] });
  expect(out?.kind === "steps" && out.groups[0]!.steps).toEqual([...CHICKEN, "Heat the oil."]);
});

test("a meal cooked fresh, not from a pot, has no pot section", () => {
  expect(cook("2026-11-08", "dinner")).toBeNull();
  expect(cook(TODAY, "breakfast")).toBeNull();
});
