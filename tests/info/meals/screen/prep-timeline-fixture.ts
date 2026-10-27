// A session's written steps for the chili pot (batch-cook-fixture.ts), as the
// prep page's timeline tests read them: chop, brown, simmer (hands then a long
// wait) and a wash-up that fits into the wait. With the program's packing step
// the plan is 65 minutes, 43 of them hands-on.

import type { PrepRun } from "../../../../src/info/meals/plan/types";
import type { PrepStep } from "../../../../src/info/meals/timeline/steps";

export const STEPS_KEY = "prep-k1";
export const T0 = Date.UTC(2026, 10, 1, 14, 0);

export const CHILI_STEPS: PrepStep[] = [
  { id: "1", text: "Chop the onion and the peppers", device: "counter", pot: "chili", active: 10, wait: 0, after: [] },
  { id: "2", text: "Brown the chicken in the big pot", device: "stove", pot: "chili", active: 10, wait: 0, after: ["1"] },
  { id: "3", text: "Add the beans and tomatoes, then simmer", device: "stove", pot: "chili", active: 5, wait: 30, after: ["2"] },
  { id: "4", text: "Wash the boards and knives", device: "counter", pot: null, active: 8, wait: 0, after: [] },
];

/** Started at T0; step 1 done at minute 9, step 2 started then. */
export function runOnStep2(extra: PrepRun["steps"] = {}): PrepRun {
  return { key: STEPS_KEY, startedAt: T0, steps: { "1": { started: 0, handsDone: 9, done: 9 }, "2": { started: 9 }, ...extra } };
}

export const at = (minute: number) => T0 + minute * 60_000 + 20_000;
