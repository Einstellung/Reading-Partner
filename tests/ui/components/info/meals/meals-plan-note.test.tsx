// The note on the meals page when a written plan breaks a draft rule
// (MealsPlanNote.tsx, info/meals/screen/plan-note.ts): drawn with its lines,
// wiped away by its button, and not drawn again for the same problems.
// Run: scripts/t.sh tests/ui/components/info/meals/meals-plan-note.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../../src/i18n";
import { useDom } from "../../../../support/dom";
import { MON, state } from "../../../../info/meals/fixtures/week";

const { act, cleanup, fireEvent, render } = await useDom();

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const { MealsPlanNote } = await import("../../../../../src/ui/components/info/meals/MealsPlanNote");
const { MealsHome } = await import("../../../../../src/ui/components/info/meals/MealsPage");
const { createPlanNoteStore, planNote } = await import("../../../../../src/info/meals/screen/plan-note");

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => {
  cleanup();
  planNote.show(null);
  setLocale(before);
});

const CALCIUM = { start: MON, problems: [{ rule: "calcium" as const, day: 2 }] };

test("the note shows its lines and goes when it is wiped away, and the same problems do not bring it back", async () => {
  const store = createPlanNoteStore();
  store.show(CALCIUM);
  const { container, getByRole } = render(<MealsPlanNote today={MON} store={store} />);
  const note = getByRole("status");
  expect(note.textContent).toContain("No calcium source on Tuesday. Tell Lumen to add milk, yogurt, firm tofu or a green like bok choy.");

  await act(async () => {
    fireEvent.click(getByRole("button", { name: "Dismiss" }));
  });
  expect(container.querySelector('[role="status"]')).toBeNull();

  await act(async () => store.show({ start: MON, problems: [{ rule: "calcium", day: 2 }] }));
  expect(container.querySelector('[role="status"]')).toBeNull();

  await act(async () => store.show({ start: MON, problems: [{ rule: "calcium", day: 2 }, { rule: "fish" }] }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("No fish or shrimp in the plan.");
});

test("nothing is drawn when there is nothing to say", () => {
  const { container } = render(<MealsPlanNote today={MON} store={createPlanNoteStore()} />);
  expect(container.innerHTML).toBe("");
});

test("the week page carries the note the plan's writes left", async () => {
  planNote.show(CALCIUM);
  const noop = () => {};
  const { getByRole } = render(
    <MealsHome
      state={state()}
      photos={{}}
      today={MON}
      onPlanWeek={noop}
      onAsk={noop}
      onOpenShopping={noop}
      onOpenDay={noop}
      onOpenMethod={noop}
      onReplayOnboarding={noop}
    />,
  );
  expect(getByRole("status").textContent).toContain("No calcium source on Tuesday.");
});
