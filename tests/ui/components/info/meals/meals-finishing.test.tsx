// The eating-day finishing steps on the meals screens (docs/671), drawn from a
// stand-in source: the line under a dish on the week and day cards, tonight's
// notes on today only, and the recipe page that shows the steps instead of
// asking for a recipe. With nothing to finish every screen draws as before.
// Run: scripts/t.sh tests/ui/components/info/meals/meals-finishing.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../../src/i18n";
import type { Finishing } from "../../../../../src/info/meals/finish/types";
import { addDays } from "../../../../../src/info/meals/plan/week";
import { useDom } from "../../../../support/dom";
import { MON, state } from "../../../../info/meals/fixtures/week";

const { cleanup, render } = await useDom();

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const { MealsDay } = await import("../../../../../src/ui/components/info/meals/MealsDay");
const { MealsHome } = await import("../../../../../src/ui/components/info/meals/MealsPage");
const { MealsRecipe } = await import("../../../../../src/ui/components/info/meals/MealsRecipe");
const { finishSource } = await import("../../../../../src/info/meals/finish/finish-view");

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => {
  cleanup();
  setLocale(before);
});

const STEPS: Finishing = {
  line: "Heat the salmon box 3 min, stir-fry bok choy 4 min",
  need: ["Salmon box", "Rice box", "Bok choy", "Oil"],
  steps: ["Heat the salmon box for 3 minutes.", "Stir-fry the bok choy for 4 minutes.", "Serve with the rice."],
};
const TONIGHT = "Tonight: move tomorrow's cod from the freezer to the fridge";

const dinnerOnly = () => finishSource((view) => (view.key === "dinner" ? STEPS : null), () => [TONIGHT]);
const nothing = () => finishSource(() => null, () => []);
const noop = () => {};

function day(finish: ReturnType<typeof finishSource>, date = MON) {
  return render(
    <MealsDay
      state={state()}
      photos={{}}
      today={MON}
      date={date}
      onBack={noop}
      onAsk={noop}
      onOpenMethod={noop}
      onOpenRecipe={noop}
      finish={finish}
    />,
  );
}

test("the day page puts the line under the dish of a boxed meal and tonight's notes at the top", () => {
  const { container } = day(dinnerOnly());
  const text = container.textContent ?? "";
  expect(text).toContain(STEPS.line);
  expect(text.indexOf(TONIGHT)).toBeGreaterThanOrEqual(0);
  // The notes come before every meal card.
  expect(text.indexOf(TONIGHT)).toBeLessThan(text.indexOf(STEPS.line));
  expect(container.querySelectorAll("p").length).toBeGreaterThan(0);
});

test("tonight's notes are not drawn on a day other than today", () => {
  const { container } = day(dinnerOnly(), addDays(MON, 1));
  expect(container.textContent).not.toContain(TONIGHT);
});

test("with nothing to finish the day page is drawn as before", () => {
  const plain = day(nothing()).container.innerHTML;
  cleanup();
  const stub = day(finishSource()).container.innerHTML;
  expect(stub).toBe(plain);
  expect(plain).not.toContain(STEPS.line);
});

test("the week page's day card carries the line and today's notes", () => {
  const { container } = render(
    <MealsHome
      state={state()}
      photos={{}}
      today={MON}
      onPlan={noop}
      onOpenPrep={noop}
      onAsk={noop}
      onOpenShopping={noop}
      onOpenDay={noop}
      onOpenMethod={noop}
      onReplayOnboarding={noop}
      finish={dinnerOnly()}
    />,
  );
  const cards = [...container.querySelectorAll("button")].filter((b) => b.textContent?.includes(STEPS.line));
  // Today's card and tomorrow's each have a dinner with steps; the notes are on today's only.
  expect(cards.length).toBe(2);
  expect(cards[0]!.textContent).toContain(TONIGHT);
  expect(cards[1]!.textContent).not.toContain(TONIGHT);
});

function recipe(finish: ReturnType<typeof finishSource>) {
  return render(
    <MealsRecipe state={state()} photos={{}} today={MON} date={MON} meal="dinner" onBack={noop} finish={finish} />,
  );
}

test("a boxed meal's page shows what to have out and the numbered steps, and no recipe is asked for", () => {
  const { container } = recipe(dinnerOnly());
  const text = container.textContent ?? "";
  expect(text).toContain("Have out");
  expect(text).toContain("Salmon box, Rice box, Bok choy, Oil");
  const steps = [...container.querySelectorAll("ol > li")].map((li) => li.textContent);
  expect(steps).toEqual(STEPS.steps.map((s, i) => `${i + 1}${s}`));
  // The recipe's own steps area (the call's skeleton, its failure or its steps) is not there.
  expect(text).not.toContain("How");
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  // The ingredient table stays.
  expect(container.querySelector("table")).not.toBeNull();
});

test("a meal with nothing to finish gets the recipe page as before", () => {
  const { container } = recipe(nothing());
  const text = container.textContent ?? "";
  expect(text).not.toContain("Have out");
  expect(text).toContain("How");
});
