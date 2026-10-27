// Batch cooking on a real DOM (docs/671 备餐页): the Meals page's top card in
// each state and where its buttons go, the prep row on the prep day's card,
// the prep page with its sections and Done, the phone tile, and where Apply
// lands. Run: scripts/t.sh tests/ui/components/info/meals/meals-batch-cook.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../../src/i18n";
import type { MealsState } from "../../../../../src/info/meals/plan/types";
import { addDays } from "../../../../../src/info/meals/plan/week";
import { appliedAction, batchCookEntry, entryCardView, entryTileView, type EntryAction } from "../../../../../src/info/meals/screen/batch-cook";
import { useDom } from "../../../../support/dom";
import { state as weekState } from "../../../../info/meals/fixtures/week";
import { LAST, plannerState, START } from "../../../../info/meals/screen/batch-cook-fixture";

const { act, cleanup, fireEvent, render } = await useDom();

// Imported after the window is up, for the reason launch-placeholder.test.tsx
// gives: react-dom decides once, at evaluation, whether it is in a browser.
const { BatchCookCard } = await import("../../../../../src/ui/components/info/meals/MealsBatchCook");
const { MealsHome } = await import("../../../../../src/ui/components/info/meals/MealsPage");
const { MealsPrep } = await import("../../../../../src/ui/components/info/meals/MealsPrep");
const { leaveForAppliedPlan } = await import("../../../../../src/ui/components/info/use-info-call");

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => {
  cleanup();
  setLocale(before);
});

function card(s: MealsState, today: string, hour = 9) {
  const actions: EntryAction[] = [];
  const view = entryCardView(batchCookEntry(s, today, hour), today)!;
  const r = render(<BatchCookCard view={view} onAction={(a) => actions.push(a)} />);
  return { ...r, actions };
}

test("no plan: the card says so and its one button plans a batch cook", async () => {
  const { getByRole, actions, container } = card({ ...weekState(), plan: null }, START);
  expect(container.textContent).toContain("No batch cook planned");
  await act(async () => fireEvent.click(getByRole("button", { name: "Plan a batch cook" })));
  expect(actions).toEqual([{ kind: "plan" }]);
});

test("a prep ahead: when and how long, the title and Open the prep go to the prep, Re-plan to the chat", async () => {
  const { getByRole, getAllByRole, actions, container } = card(plannerState(), START);
  expect(container.textContent).toContain("Today, afternoon");
  expect(container.textContent).toContain("Chicken and kidney bean chili");
  expect(getAllByRole("button")).toHaveLength(3);
  await act(async () => fireEvent.click(getByRole("button", { name: "Open the prep" })));
  await act(async () => fireEvent.click(getByRole("button", { name: "Re-plan" })));
  await act(async () => fireEvent.click(getAllByRole("button")[0]!));
  expect(actions).toEqual([{ kind: "prep", session: "s1" }, { kind: "plan" }, { kind: "prep", session: "s1" }]);
});

test("prep done: the next meal opens its day, with the prep list and the next batch cook beside it", async () => {
  const { getByRole, getAllByRole, actions, container } = card(plannerState({ preppedAt: 5 }), START, 15);
  expect(container.textContent).toContain("Up next");
  expect(container.textContent).toContain("Today · Dinner");
  await act(async () => fireEvent.click(getAllByRole("button")[0]!));
  await act(async () => fireEvent.click(getByRole("button", { name: "Prep list" })));
  await act(async () => fireEvent.click(getByRole("button", { name: "Plan the next batch cook" })));
  expect(actions).toEqual([{ kind: "day", date: START }, { kind: "prep", session: "s1" }, { kind: "plan" }]);
});

test("a used-up plan: plan the next batch cook", async () => {
  const { getByRole, actions, container } = card(plannerState(), addDays(LAST, 1));
  expect(container.textContent).toContain("This plan is used up");
  await act(async () => fireEvent.click(getByRole("button", { name: "Plan the next batch cook" })));
  expect(actions).toEqual([{ kind: "plan" }]);
});

function mealsHome(s: MealsState | null, opened: string[] = []) {
  const noop = () => {};
  return render(
    <MealsHome
      state={s}
      photos={{}}
      today={START}
      hour={9}
      onPlan={noop}
      onOpenPrep={(id) => opened.push(id)}
      onAsk={noop}
      onOpenShopping={noop}
      onOpenDay={noop}
      onOpenMethod={noop}
      onReplayOnboarding={noop}
    />,
  );
}

// The page's blocks in order: the column's children, the sticky header first.
function blocksAfterHeader(container: HTMLElement): Element[] {
  const column = container.firstElementChild!;
  return [...column.children].slice(1);
}

test("the Meals page prep row sits on the prep day's card", async () => {
  const opened: string[] = [];
  const { getAllByRole } = mealsHome(plannerState(), opened);
  const row = getAllByRole("button").find((b) => b.textContent?.startsWith("Prep · afternoon"));
  expect(row).toBeTruthy();
  await act(async () => fireEvent.click(row!));
  expect(opened).toEqual(["s1"]);
});

test("the batch-cook card is the first block under the header, ahead of the chips and the targets", () => {
  // Setup: no plan yet.
  const setup = mealsHome({ ...weekState(), plan: null });
  const first = blocksAfterHeader(setup.container)[0]!;
  expect(first.querySelector('section[aria-label="Batch cook"]')).toBeTruthy();
  expect(setup.getByRole("button", { name: "Replay onboarding" })).toBeTruthy();
  expect(first.compareDocumentPosition(setup.getByRole("button", { name: "Replay onboarding" })) & 4).toBe(4);
  cleanup();

  // Prep: a prep ahead, with the targets card and the day cards under it.
  const prep = mealsHome(plannerState());
  const blocks = blocksAfterHeader(prep.container);
  expect(blocks[0]!.querySelector('section[aria-label="Batch cook"]')).toBeTruthy();
  const chips = prep.getByRole("button", { name: "Replay onboarding" });
  expect(blocks[0]!.compareDocumentPosition(chips) & 4).toBe(4);
  const targets = prep.container.textContent!.indexOf("Calories");
  expect(targets).toBeGreaterThan(prep.container.textContent!.indexOf("Batch cook"));
});

function prepPage(s: MealsState | null, session: string | null, today = START) {
  const calls: string[] = [];
  const r = render(
    <MealsPrep
      state={s}
      photos={{}}
      today={today}
      session={session}
      onBack={() => calls.push("back")}
      onAsk={() => calls.push("ask")}
      onDone={() => calls.push("done")}
    />,
  );
  return { ...r, calls };
}

test("the prep page draws its sections in order, and Done reports the tap", async () => {
  const { container, getByRole, calls } = prepPage(plannerState(), "s1");
  const heads = [...container.querySelectorAll("h2")].map((h) => h.textContent);
  expect(heads).toEqual(["What you cook", "Have ready", "Timeline", "Packing", "Into the fridge", "Breakfast and the evenings"]);
  expect(container.textContent).toContain("Prep · Mon, 11/2");
  expect(container.textContent).toContain("Chicken and kidney bean chili");
  expect(container.textContent).toContain("Containers");
  await act(async () => fireEvent.click(getByRole("button", { name: "Done cooking" })));
  expect(calls).toEqual(["done"]);
});

test("a reader who does not box gets no packing section", () => {
  const { container } = prepPage(plannerState({ profile: { boxes: false } }), "s1");
  expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).not.toContain("Packing");
});

test("a prep already done says so instead of the button", () => {
  const { container, queryByRole } = prepPage(plannerState({ preppedAt: 5 }), "s1");
  expect(queryByRole("button", { name: "Done cooking" })).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Prep done.");
});

test("an unknown session or a plan with no prep: one line, and back still works", async () => {
  for (const s of [plannerState(), weekState()]) {
    const { container, getByRole, calls, unmount } = prepPage(s, "s9");
    expect(container.textContent).toContain("This plan has no prep to show.");
    await act(async () => fireEvent.click(getByRole("button", { name: "Back" })));
    expect(calls).toEqual(["back"]);
    unmount();
  }
  // Still loading: no line yet.
  expect(prepPage(null, "s1").container.textContent).not.toContain("This plan has no prep to show.");
});

test("the phone tile's words for each state", () => {
  const tile = (s: MealsState, today: string, hour = 9) => entryTileView(batchCookEntry(s, today, hour), today);
  expect(tile({ ...weekState(), plan: null }, START)?.mid).toBe("Plan a batch cook");
  expect(tile(plannerState(), START)?.mid).toBe("Prep: Today, afternoon");
  expect(tile(plannerState({ preppedAt: 5 }), START, 15)?.foot).toBe("Today · Dinner");
  expect(tile(plannerState(), addDays(LAST, 1))?.mid).toBe("Plan the next batch cook");
});

test("Apply lands on the prep page, or on the Meals page when the plan cooks nothing ahead, and the call steps aside", () => {
  expect(appliedAction("s1")).toEqual({ kind: "prep", session: "s1" });
  expect(appliedAction(null)).toEqual({ kind: "meals" });
  const log: string[] = [];
  const to = { open: (s: string | null) => log.push(`open:${s}`), swap: () => log.push("swap"), hangUp: () => log.push("hangUp") };
  leaveForAppliedPlan("s1", false, to);
  leaveForAppliedPlan(null, true, to);
  expect(log).toEqual(["open:s1", "hangUp", "open:null", "swap"]);
});
