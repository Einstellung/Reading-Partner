// The number lines the meals screens print (docs/73 屏幕), so the .tsx files
// hand over a view and get a string back instead of rounding anything
// themselves.

import { t } from "../../../i18n";
import type { MealCells, Nutrition } from "../nutrition/solve";
import type { DayView, MealView } from "./view";

const n0 = (x: number) => Math.round(x);
const KCAL = () => t("meals.unit.kcal");
const G = () => t("meals.unit.g");

/** "412 kcal · P 31 g · 5 min" under a meal on a day card. Null for a meal with no grams. */
export function mealNumbersLine(m: MealView): string | null {
  if (!m.totals) return null;
  const minutes = m.minutes !== null ? ` · ${m.minutes} ${t("meals.unit.min")}` : "";
  return `${n0(m.totals.kcal)} ${KCAL()} · ${t("meals.abbr.protein")} ${n0(m.totals.protein)} ${G()}${minutes}`;
}

/** "412 kcal · P 31 g · F 12 g · C 45 g" on a meal's own card. */
export function macroLine(n: Nutrition): string {
  return [
    `${n0(n.kcal)} ${KCAL()}`,
    `${t("meals.abbr.protein")} ${n0(n.protein)} ${G()}`,
    `${t("meals.abbr.fat")} ${n0(n.fat)} ${G()}`,
    `${t("meals.abbr.carbs")} ${n0(n.carbs)} ${G()}`,
  ].join(" · ");
}

/** "1980 / 2000 kcal · P 140 / 145 g" under a day's heading. Null without targets. */
export function dayTotalsLine(d: DayView): string | null {
  if (!d.targets) return null;
  return `${n0(d.totals.kcal)} / ${d.targets.kcal} ${KCAL()} · ${t("meals.abbr.protein")} ${n0(d.totals.protein)} / ${d.targets.protein} ${G()}`;
}

/** "Fat 60 g · Carbs 210 g (guide 56 / 230 g)" on the day screen. */
export function guideLine(d: DayView): string | null {
  if (!d.targets) return null;
  return t("meals.guideLine", {
    fat: n0(d.totals.fat),
    carbs: n0(d.totals.carbs),
    fatTarget: d.targets.fat,
    carbsTarget: d.targets.carbs,
  });
}

export interface Meter {
  label: string;
  // 0–100, how much of the bar is filled.
  pct: number;
  value: string;
}

/** The calorie and protein bars on the day screen, planned against target. */
export function dayMeters(d: DayView): Meter[] {
  if (!d.targets) return [];
  const pct = (v: number, t: number) => (t > 0 ? Math.max(0, Math.min(100, (v / t) * 100)) : 0);
  return [
    {
      label: t("meals.calories"),
      pct: pct(d.totals.kcal, d.targets.kcal),
      value: `${n0(d.totals.kcal)} / ${d.targets.kcal} ${KCAL()}`,
    },
    {
      label: t("meals.protein"),
      pct: pct(d.totals.protein, d.targets.protein),
      value: `${n0(d.totals.protein)} / ${d.targets.protein} ${G()}`,
    },
  ];
}

/** A week row's right column: the day's kcal and protein, two lines. */
export function weekRowNumbers(d: DayView): [string, string] | null {
  if (!d.meals.some((m) => m.totals)) return null;
  return [`${n0(d.totals.kcal)} ${KCAL()}`, `${t("meals.abbr.protein")} ${n0(d.totals.protein)} ${G()}`];
}

export interface CellMark {
  short: string;
  long: string;
  on: boolean;
}

/** The three squares a meal carries: protein, veg, carbs. */
export function cellMarks(c: MealCells): CellMark[] {
  return [
    { short: "P", long: t("meals.cellProtein"), on: c.protein },
    { short: "V", long: t("meals.cellVeg"), on: c.produce },
    { short: "C", long: t("meals.cellCarb"), on: c.carbs },
  ];
}

export function cellsAriaLabel(c: MealCells): string {
  const yn = (b: boolean) => (b ? t("meals.yes") : t("meals.no"));
  return t("meals.cellsAriaLabel", { protein: yn(c.protein), veg: yn(c.produce), carbs: yn(c.carbs) });
}

/** A meal's label on the day screen: "Dinner · after training" for the main meal eaten after training. */
export function mealHeading(m: MealView): string {
  return m.postWorkout ? t("meals.mealAfterTraining", { label: m.label }) : m.label;
}

/** An ingredient row's protein, to one decimal. */
export function proteinCell(g: number): string {
  return g.toFixed(1);
}
