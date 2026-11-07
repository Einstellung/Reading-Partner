// The meal page of a prep batch meal shows how its pot is cooked below the
// eating-day steps (docs/671); with no prep steps on disk the plan's line for
// the pot stands in. A meal cooked fresh has no such section.
// Run: scripts/t.sh tests/ui/components/info/meals/meals-pot-cooking.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale, setLocale, type Locale } from "../../../../../src/i18n";
import { parseMealsFile } from "../../../../../src/info/meals/plan/store";
import type { MealKey, MealsState } from "../../../../../src/info/meals/plan/types";
import { useDom } from "../../../../support/dom";

const { cleanup, render } = await useDom();

// Imported after the window is up (see meals-finishing.test.tsx).
const { MealsRecipe } = await import("../../../../../src/ui/components/info/meals/MealsRecipe");

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => {
  cleanup();
  setLocale(before);
});

function state(): MealsState {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "../../../../info/meals/fixtures/adobo-plan.json"), "utf8"));
  const parsed = parseMealsFile(raw);
  if (!parsed) throw new Error("fixture does not parse");
  return parsed;
}

const page = (date: string, meal: MealKey) =>
  render(<MealsRecipe state={state()} photos={{}} today="2026-11-07" date={date} meal={meal} onBack={() => {}} />);

test("a box meal's page keeps its eating-day steps and adds how the pot is cooked", () => {
  const text = page("2026-11-08", "lunch").container.textContent ?? "";
  expect(text).toContain("Have out");
  expect(text).toContain("How the pot is cooked");
  expect(text.indexOf("Have out")).toBeLessThan(text.indexOf("How the pot is cooked"));
});

test("a meal cooked fresh has no pot section", () => {
  const text = page("2026-11-08", "dinner").container.textContent ?? "";
  expect(text).not.toContain("How the pot is cooked");
});
