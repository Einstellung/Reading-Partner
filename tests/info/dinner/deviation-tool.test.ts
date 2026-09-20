// record_dinner_deviation (src/info/dinner/tools.ts): the one dinner tool that
// writes, because the reader saying what they ate is itself the instruction and
// there is nothing for them to approve. Run: scripts/t.sh tests/info/dinner
//
// The tool is the only part under test here; what applyDeviation moves is
// apply.test.ts's and week.test.ts's, so the ports are a recording double.

import { expect, test } from "bun:test";
import {
  buildRecordDeviationTool,
  resolveDeviationDate,
  type DinnerToolDeps,
} from "../../../src/info/dinner/tools";
import type { DinnerPorts } from "../../../src/info/dinner/apply";
import type { DinnerCard } from "../../../src/info/dinner/cards";
import {
  EMPTY_DINNER,
  type Deviation,
  type DinnerState,
  type ShoppingItem,
  type WeekPlan,
} from "../../../src/info/dinner/types";

const MON = "2026-09-21";
// Day three of the week, a delivery night to begin with.
const WED = "2026-09-23";

function week(): WeekPlan {
  return {
    id: `week-${MON}`,
    startDate: MON,
    days: [
      { date: "2026-09-21", mode: "cook", dishId: "dish-a" },
      { date: "2026-09-22", mode: "reheat", reheatOf: "2026-09-21", freshAdd: "leaves" },
      { date: "2026-09-23", mode: "cook", dishId: "dish-b" },
      { date: "2026-09-24", mode: "reheat", reheatOf: "2026-09-23", freshAdd: "salad" },
      { date: "2026-09-25", mode: "out" },
      { date: "2026-09-26", mode: "out" },
      { date: "2026-09-27", mode: "out" },
    ],
    dishes: [
      {
        id: "dish-a",
        name: "Traybake",
        oneLine: "one tray",
        base: "b",
        fresh: "f",
        keepsADay: true,
        handsOnMinutes: 10,
        ingredients: [],
      },
      {
        id: "dish-b",
        name: "Stew",
        oneLine: "one pot",
        base: "b",
        fresh: "f",
        keepsADay: true,
        handsOnMinutes: 12,
        ingredients: [],
      },
    ],
    createdAt: 1,
    revision: 1,
  };
}

interface Written {
  deviations: Deviation[];
  plans: WeekPlan[];
  reloads: number;
}

function harness(state: DinnerState) {
  const written: Written = { deviations: [], plans: [], reloads: 0 };
  const cards: DinnerCard[] = [];
  const ports: DinnerPorts = {
    current: async () => state,
    saveCharter: async () => {},
    savePlan: async () => {},
    saveDeviation: async (deviation, plan, _shopping: readonly ShoppingItem[]) => {
      written.deviations.push(deviation);
      written.plans.push(plan);
    },
    now: () => 500,
    today: () => WED,
    changed: () => {
      written.reloads++;
    },
  };
  const deps: DinnerToolDeps & { ports: DinnerPorts } = {
    threadId: "t",
    state: async () => state,
    today: () => WED,
    now: () => 500,
    onDinnerCard: (card) => cards.push(card),
    ports,
  };
  const tool = buildRecordDeviationTool(deps);
  // execute answers a string or a ToolResult; these tools always answer the
  // latter, and the test reads its text.
  const run = async (args: Record<string, unknown>): Promise<{ text: string }> =>
    (await tool.execute(args)) as { text: string };
  return { tool, run, written, cards };
}

test("a night a day number names is written, and the day left empty comes back", async () => {
  const { run, written, cards } = harness({ ...EMPTY_DINNER, plan: week() });
  const out = await run({
    day: "3",
    became: "delivery",
    place: "the noodle place",
    said: "ordered in tonight",
  });
  expect(written.deviations).toHaveLength(1);
  expect(written.deviations[0].date).toBe(WED);
  expect(written.deviations[0].became).toBe("delivery");
  expect(written.deviations[0].place).toBe("the noodle place");
  // Thursday was eating Wednesday's base, so it is the day the model is sent
  // back to — and the only one.
  expect(out.text).toContain("2026-09-24");
  expect(out.text).toContain("propose_dinner_plan");
  expect(written.reloads).toBe(1);
  // No card: the reader's own sentence is the gate.
  expect(cards).toEqual([]);
});

test("'today' and 'yesterday' are the two words a reader actually says", () => {
  expect(resolveDeviationDate("today", MON, WED)).toBe(WED);
  expect(resolveDeviationDate("yesterday", MON, WED)).toBe("2026-09-22");
  expect(resolveDeviationDate(" 1 ", MON, WED)).toBe(MON);
  expect(resolveDeviationDate("7", MON, WED)).toBe("2026-09-27");
});

test("a night outside the week is refused rather than guessed at", async () => {
  const { run, written } = harness({ ...EMPTY_DINNER, plan: week() });
  const out = await run({ day: "9", became: "out", said: "went out" });
  expect(out.text).toContain("not a night of this week");
  expect(written.deviations).toEqual([]);
  expect(resolveDeviationDate("8", MON, WED)).toBe(null);
  expect(resolveDeviationDate("saturday", MON, WED)).toBe(null);
});

test("a mode the program does not have is refused", async () => {
  const { run, written } = harness({ ...EMPTY_DINNER, plan: week() });
  const out = await run({ day: "today", became: "takeaway", said: "picked something up" });
  expect(out.text).toContain("became must be one of");
  expect(written.deviations).toEqual([]);
});

test("with no week planned there is nothing to record a change against", async () => {
  const { run, written } = harness({ ...EMPTY_DINNER });
  const out = await run({ day: "today", became: "out", said: "went out" });
  expect(out.text).toContain("no week planned");
  expect(written.deviations).toEqual([]);
  expect(written.reloads).toBe(0);
});

test("a night that leaves nothing orphaned says so instead of sending the model off", async () => {
  const { run, written } = harness({ ...EMPTY_DINNER, plan: week() });
  const out = await run({ day: "7", became: "delivery", said: "ordered in on Sunday" });
  expect(written.deviations).toHaveLength(1);
  expect(out.text).toContain("nothing to re-plan");
});
