// The prep page's timeline on a real DOM (docs/671 备餐页 3, 时间线与语音): the
// steps being written, failed and ready; before the start, running with a
// current step, a step running late, and the prep done; the taps and the screen
// lock. Run: scripts/t.sh tests/ui/components/info/meals/meals-timeline.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../../src/i18n";
import type { MealsState, PrepRun } from "../../../../../src/info/meals/plan/types";
import { clockText, type PrepStepsStatus } from "../../../../../src/info/meals/screen/prep-timeline";
import { timelineView } from "../../../../../src/info/meals/timeline/view";
import { useDom } from "../../../../support/dom";
import { plannerState, START } from "../../../../info/meals/screen/batch-cook-fixture";
import { at, CHILI_STEPS, runOnStep2, STEPS_KEY, T0 } from "../../../../info/meals/screen/prep-timeline-fixture";

const { act, cleanup, fireEvent, render } = await useDom();
const { MealsPrep } = await import("../../../../../src/ui/components/info/meals/MealsPrep");
const { MealsHome } = await import("../../../../../src/ui/components/info/meals/MealsPage");

// A screen lock that counts what it was asked for and what it gave back.
const lock = { requested: 0, released: 0 };
let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
  lock.requested = 0;
  lock.released = 0;
  Object.defineProperty(globalThis.navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async () => {
        lock.requested++;
        return { released: false, release: async () => void lock.released++ };
      },
    },
  });
});
afterEach(() => {
  cleanup();
  setLocale(before);
  delete (globalThis.navigator as { wakeLock?: unknown }).wakeLock;
});

const READY: PrepStepsStatus = { kind: "ready", key: STEPS_KEY, at: 1, steps: CHILI_STEPS };

function withRun(run: PrepRun | null, preppedAt?: number): MealsState {
  const s = plannerState(preppedAt === undefined ? {} : { preppedAt });
  const plan = s.plan!;
  return { ...s, plan: { ...plan, planner: { ...plan.planner!, ...(run ? { prepRun: run } : {}) } } };
}

function page(state: MealsState, steps: PrepStepsStatus, now = T0, start = true) {
  const calls: unknown[] = [];
  const r = render(
    <MealsPrep
      state={state}
      photos={{}}
      today={START}
      session="s1"
      onBack={() => calls.push("back")}
      onAsk={() => calls.push("ask")}
      onDone={() => calls.push("done")}
      steps={steps}
      onRetrySteps={() => calls.push("retry")}
      onStart={async () => {
        calls.push("start");
        return start;
      }}
      onStep={(e) => calls.push(e)}
      clock={() => now}
    />,
  );
  const heads = () => [...r.container.querySelectorAll("h2")].map((h) => h.textContent);
  const row = (id: string) => r.container.querySelectorAll("ol li")[viewOrder(state, now).indexOf(id)] as HTMLElement;
  return { ...r, calls, heads, row };
}

const viewOrder = (state: MealsState, now: number) =>
  timelineView({ steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true, run: state.plan?.planner?.prepRun ?? null, now }).steps.map((s) => s.id);

const settle = () => act(async () => {});

test("steps being written: a calm line in section 3, and every other section drawn from the plan", () => {
  const { container, heads, queryByRole } = page(withRun(null), { kind: "writing" });
  expect(heads()).toEqual(["What you cook", "Have ready", "Timeline", "Packing", "Into the fridge", "Breakfast and the evenings"]);
  expect(container.textContent).toContain("Writing the steps…");
  expect(queryByRole("button", { name: "Start prep" })).toBeNull();
  expect(queryByRole("button", { name: "Done cooking" })).not.toBeNull();
});

test("steps that could not be written: the recipe page's line and Try again", async () => {
  const { container, getByRole, calls } = page(withRun(null), { kind: "failed" });
  expect(container.textContent).toContain("The steps could not be written.");
  await act(async () => fireEvent.click(getByRole("button", { name: "Try again" })));
  expect(calls).toEqual(["retry"]);
});

test("ready, before the start: the timeline's minutes in the top line, lanes, minutes per step, and Start asks for the screen lock", async () => {
  const { container, getByRole, calls, row } = page(withRun(null), READY);
  expect(container.textContent).toContain("43 min");
  expect(container.textContent).toContain("65 min");
  expect(container.querySelector('figure[aria-label="Steps by device"]')?.textContent).toContain("Counter");
  expect(row("1").textContent).toContain("Counter · 10 min hands-on");
  expect(row("3").textContent).toContain("5 min hands-on · wait 30 min");
  expect(container.textContent).not.toContain("Ends ");
  expect(container.querySelector('[aria-current="step"]')).toBeNull();
  await act(async () => fireEvent.click(getByRole("button", { name: "Start prep" })));
  await settle();
  expect(calls).toEqual(["start"]);
  expect(lock.requested).toBe(1);
});

test("a start that could not be written gives the screen lock back", async () => {
  const { getByRole } = page(withRun(null), READY, T0, false);
  await act(async () => fireEvent.click(getByRole("button", { name: "Start prep" })));
  await settle();
  expect([lock.requested, lock.released]).toEqual([1, 1]);
});

test("running: clock times, the current step marked with its taps, the end in the top bar, the screen kept on until leaving", async () => {
  const state = withRun(runOnStep2());
  const now = at(15);
  const v = timelineView({ steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true, run: runOnStep2(), now });
  const { container, getByRole, queryByRole, calls, row, unmount } = page(state, READY, now);
  await settle();
  const current = container.querySelector('[aria-current="step"]')!;
  expect(current.textContent).toContain("Brown the chicken");
  expect(current.textContent).toContain(`${clockText(T0 + 9 * 60_000)} – ${clockText(T0 + 19 * 60_000)}`);
  expect(current.textContent).toContain("Now");
  expect(row("1").getAttribute("data-state")).toBe("done");
  expect(container.textContent).toContain(`Ends ${clockText(v.endsAt!)}`);
  expect(container.textContent).toContain(`Started at ${clockText(T0)}`);
  expect(queryByRole("button", { name: "Start prep" })).toBeNull();
  expect(lock.requested).toBe(1);

  await act(async () => fireEvent.click(getByRole("button", { name: "Done" })));
  await act(async () => fireEvent.click(getByRole("button", { name: "Started" })));
  expect(calls).toEqual([
    { step: "2", event: "done" },
    { step: v.next, event: "started" },
  ]);
  unmount();
  expect(lock.released).toBe(1);
});

test("a step running late: it keeps going past its estimate, the steps after it move, and the chips say how much longer", async () => {
  const run = runOnStep2({ "2": { started: 9, handsUntil: 30 } });
  const state = withRun(run);
  const { getByRole, calls, row } = page(state, READY, at(25));
  expect(row("2").getAttribute("aria-current")).toBe("step");
  expect(row("2").textContent).toContain(`${clockText(T0 + 9 * 60_000)} – ${clockText(T0 + 30 * 60_000)}`);
  expect(row("3").textContent).toContain(clockText(T0 + 30 * 60_000));
  await act(async () => fireEvent.click(getByRole("button", { name: "+5 min" })));
  await act(async () => fireEvent.click(getByRole("button", { name: "+10 min" })));
  expect(calls).toEqual([
    { step: "2", event: "more", minutes: 5 },
    { step: "2", event: "more", minutes: 10 },
  ]);
});

test("prep done: every step reads done, nothing to tap, no end time, and the screen is not kept on", async () => {
  const { container, queryByRole } = page(withRun(runOnStep2(), 5), READY, at(15));
  await settle();
  const rows = [...container.querySelectorAll("ol li")];
  expect(rows.length).toBe(5);
  expect(rows.every((li) => li.getAttribute("data-state") === "done")).toBe(true);
  for (const name of ["Done", "Started", "+5 min", "Start prep", "Done cooking"]) expect(queryByRole("button", { name })).toBeNull();
  expect(container.textContent).not.toContain("Ends ");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Prep done.");
  expect(lock.requested).toBe(0);
});

test("Done cooking during a run lets the screen sleep before reporting the tap", async () => {
  const { getByRole, calls } = page(withRun(runOnStep2()), READY, at(15));
  await settle();
  await act(async () => fireEvent.click(getByRole("button", { name: "Done cooking" })));
  expect(calls).toEqual(["done"]);
  expect([lock.requested, lock.released]).toEqual([1, 1]);
});

test("the Meals page card and prep row show the written minutes once the steps exist", () => {
  const noop = () => {};
  const { container } = render(
    <MealsHome
      state={plannerState()}
      photos={{}}
      today={START}
      hour={9}
      written={{ activeMin: 43, totalMin: 65 }}
      onPlan={noop}
      onOpenPrep={noop}
      onAsk={noop}
      onOpenShopping={noop}
      onOpenDay={noop}
      onOpenMethod={noop}
      onReplayOnboarding={noop}
    />,
  );
  expect(container.textContent).toContain("43 min hands-on · 65 min in all");
});
