// The gate in front of a night (src/memory/dream/gate.ts): one run at a time and
// one look a day per process. What stands the night down while the store is
// still laid out the old way is tested with the rule itself
// (tests/memory/observation-layout.test.ts). Run: bun test.

import { expect, test } from "bun:test";
import { createDreamGate } from "../../src/memory/dream/gate";

const DAY = "2026-09-05";

// One run through the gate, the way live.ts does it: enter, work, leave.
async function attempt(
  gate: ReturnType<typeof createDreamGate>,
  day: string,
  body: () => Promise<void>,
  finished = true,
): Promise<boolean> {
  if (!gate.enter(day)) return false;
  try {
    await body();
    return true;
  } finally {
    gate.leave(day, finished);
  }
}

test("two calls at once run the night once", async () => {
  const gate = createDreamGate();
  let runs = 0;
  const slow = async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
  };

  const [first, second] = await Promise.all([
    attempt(gate, DAY, slow),
    attempt(gate, DAY, slow),
  ]);

  expect(runs).toBe(1);
  expect(first).toBe(true);
  // Turned away, not queued: a queued second run is the four runs of 0.12.
  expect(second).toBe(false);
});

test("a second call on the same day in the same process does not run", async () => {
  const gate = createDreamGate();
  let runs = 0;
  const body = async () => {
    runs += 1;
  };

  expect(await attempt(gate, DAY, body)).toBe(true);
  expect(await attempt(gate, DAY, body)).toBe(false);
  expect(runs).toBe(1);
  // The day, not the process: tomorrow is a night of its own.
  expect(await attempt(gate, "2026-09-06", body)).toBe(true);
  expect(runs).toBe(2);
});

test("the day is used up even when the run failed", async () => {
  const gate = createDreamGate();
  let runs = 0;
  const body = async () => {
    runs += 1;
    throw new Error("the provider is down");
  };

  await expect(attempt(gate, DAY, body)).rejects.toThrow();
  expect(await attempt(gate, DAY, async () => void (runs += 1))).toBe(false);
  expect(runs).toBe(1);
});

test("a night that stood down leaves the day open", async () => {
  const gate = createDreamGate();
  let runs = 0;
  const body = async () => {
    runs += 1;
  };

  // What live.ts does when the migration is pending: it enters, reads nothing
  // and leaves the day unmarked, so the night can still happen once the reader
  // has pressed the button.
  expect(await attempt(gate, DAY, body, false)).toBe(true);
  expect(await attempt(gate, DAY, body)).toBe(true);
  expect(runs).toBe(2);
});


