// What one sync pass says about its failures and when it gives up
// (src/platform/sync/pass-failures.ts), and the bounded pool the data channel
// runs its transfers in. The engine tests reach these through whole passes;
// here they are pinned on their own. Run: bun test.

import { expect, test } from "bun:test";
import {
  MAX_CONSECUTIVE_FAILURES,
  messageOf,
  PassFailures,
  runPool,
} from "../../../src/platform/sync/pass-failures";

test("no failure has no message; one names itself; more are counted behind the first", () => {
  const f = new PassFailures();
  expect(f.message()).toBeNull();

  f.record("download a.json", new Error("offline"));
  expect(f.count).toBe(1);
  expect(f.message()).toBe("download a.json failed: offline");

  f.record("upload b.json", new Error("HTTP 500"));
  expect(f.count).toBe(2);
  expect(f.message()).toBe("2 items failed; first: download a.json failed: offline");
});

test("the first failure's line is capped at 160 characters with an ellipsis", () => {
  const f = new PassFailures();
  f.record("download a.json", new Error("x".repeat(500)));
  const line = f.message()!;
  expect(line).toHaveLength(160);
  expect(line.startsWith("download a.json failed: xxx")).toBe(true);
  expect(line.endsWith("…")).toBe(true);
});

test("a line at the cap is kept whole", () => {
  const prefix = "download a.json failed: ";
  const f = new PassFailures();
  f.record("download a.json", new Error("y".repeat(160 - prefix.length)));
  expect(f.message()).toBe(`${prefix}${"y".repeat(160 - prefix.length)}`);
});

test("a run of MAX_CONSECUTIVE_FAILURES halts the pass; a success in between resets the run, not the count", () => {
  const f = new PassFailures();
  for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) f.record(`item ${i}`, "x");
  expect(f.halted()).toBe(false);
  f.succeeded();
  for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) f.record(`again ${i}`, "x");
  expect(f.halted()).toBe(false);
  expect(f.count).toBe(2 * (MAX_CONSECUTIVE_FAILURES - 1));
  f.record("last", "x");
  expect(f.halted()).toBe(true);
});

test("an auth failure halts at once, is not counted, and is rethrown as the first one kept", () => {
  const f = new PassFailures();
  const first = Object.assign(new Error("token dead"), { name: "GoogleAuthError" });
  const second = Object.assign(new Error("token dead too"), { name: "GoogleAuthError" });
  expect(() => f.rethrowAuthFailure()).not.toThrow();
  f.recordAuth(first);
  f.recordAuth(second);
  expect(f.halted()).toBe(true);
  expect(f.count).toBe(0);
  expect(f.message()).toBeNull();
  expect(() => f.rethrowAuthFailure()).toThrow(first);
});

test("messageOf takes an Error's message and stringifies anything else", () => {
  expect(messageOf(new Error("boom"))).toBe("boom");
  expect(messageOf("plain")).toBe("plain");
  expect(messageOf(404)).toBe("404");
});

// A task that parks until released, so the test controls what is in flight.
function gate() {
  let inFlight = 0;
  let peak = 0;
  const started: number[] = [];
  const waiting: (() => void)[] = [];
  const task = async (n: number) => {
    started.push(n);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((r) => waiting.push(r));
    inFlight -= 1;
  };
  const releaseAll = async () => {
    while (waiting.length > 0) {
      waiting.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { task, started, peak: () => peak, releaseAll, waiting: () => waiting.length };
}

test("runPool never has more than `limit` tasks in flight and runs every item once", async () => {
  const g = gate();
  const items = Array.from({ length: 10 }, (_, i) => i);
  const done = runPool(items, 3, () => false, g.task);
  await Promise.resolve();
  expect(g.waiting()).toBe(3);
  await g.releaseAll();
  await done;
  expect(g.peak()).toBe(3);
  expect(g.started).toEqual(items);
});

test("runPool asks stop before each dispatch and lets the tasks already started finish", async () => {
  const g = gate();
  const items = Array.from({ length: 10 }, (_, i) => i);
  let stopped = false;
  const done = runPool(items, 3, () => stopped, g.task);
  await Promise.resolve();
  expect(g.started).toEqual([0, 1, 2]);
  stopped = true;
  await g.releaseAll();
  await done;
  expect(g.started).toEqual([0, 1, 2]);
});

test("runPool with nothing to do starts nothing, and a limit below one still runs serially", async () => {
  let calls = 0;
  await runPool([], 8, () => false, async () => {
    calls += 1;
  });
  expect(calls).toBe(0);

  const g = gate();
  const done = runPool([1, 2, 3], 0, () => false, g.task);
  await Promise.resolve();
  expect(g.waiting()).toBe(1);
  await g.releaseAll();
  await done;
  expect(g.peak()).toBe(1);
  expect(g.started).toEqual([1, 2, 3]);
});
