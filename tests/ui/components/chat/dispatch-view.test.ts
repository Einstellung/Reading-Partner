// The four things a dispatch ticket can say (docs/72), and the one that is
// about this device rather than about the work: a run started on the reader's
// other machine, or folded away by a sweep, is gone here and the ticket says so
// rather than claiming the work is still going.
//
// Run: bun test.

import { expect, test } from "bun:test";
import {
  createDispatchWatch,
  dispatchView,
  type DispatchSnapshot,
} from "../../../../src/ui/components/chat/dispatch-view";
import type { Run } from "../../../../src/legion/run";
import type { Receipt } from "../../../../src/ai/turn-view/tool-status";

const RECEIPT: Receipt = {
  label: "Sent off literature work",
  summary: "Find what has been published on inline caches.",
  link: { kind: "run", id: "run-7" },
};

function run(over: Partial<Run> = {}): Run {
  return {
    id: "run-7",
    kind: "literature",
    tier: "local",
    delegator: { kind: "soul" },
    brief: "legion/briefs/one.md",
    state: "running",
    attempts: 1,
    createdAt: 0,
    revision: 1,
    ...over,
  };
}

function snap(over: Partial<DispatchSnapshot> = {}): DispatchSnapshot {
  return { loaded: true, run: run(), output: null, ...over };
}

test("a run still going says the last line the worker wrote", () => {
  const view = dispatchView(RECEIPT, snap({ run: run({ progress: "Reading the third paper" }) }));
  expect(view).toEqual({
    title: "Sent off literature work",
    line: "Reading the third paper",
    state: "running",
  });
});

test("a run that has not said anything yet falls back to what it was asked", () => {
  expect(dispatchView(RECEIPT, snap()).line).toBe(RECEIPT.summary);
  expect(dispatchView(RECEIPT, snap({ run: run({ state: "pending" }) })).state).toBe("running");
});

test("a finished run says the first sentence of what came back", () => {
  const view = dispatchView(
    RECEIPT,
    snap({
      run: run({ state: "done", output: "legion/out/one.md", progress: "Writing it up" }),
      output: "Inline caches are back. Three papers argue it, one from 2023.",
    }),
  );
  expect(view).toEqual({
    title: "Sent off literature work",
    line: "Inline caches are back.",
    state: "done",
  });
});

test("a finished run whose output has not been read says the last progress instead", () => {
  const view = dispatchView(
    RECEIPT,
    snap({ run: run({ state: "done", output: "legion/out/one.md", progress: "Writing it up" }) }),
  );
  expect(view).toEqual({
    title: "Sent off literature work",
    line: "Writing it up",
    state: "done",
  });
});

test("a failed run says why, and a cancelled one says it was stopped", () => {
  const failed = dispatchView(
    RECEIPT,
    snap({ run: run({ state: "failed", progress: "Every source refused the query" }) }),
  );
  expect(failed.state).toBe("failed");
  expect(failed.line).toBe("Every source refused the query");
  const quiet = dispatchView(RECEIPT, snap({ run: run({ state: "failed" }) }));
  expect(quiet.line).toBe("It stopped without saying why.");
  expect(dispatchView(RECEIPT, snap({ run: run({ state: "cancelled" }) })).state).toBe("failed");
});

test("a run this device has no file for is gone, and a run not looked up yet is not", () => {
  expect(dispatchView(RECEIPT, snap({ run: null })).state).toBe("gone");
  // The ticket must not flash `gone` between the row being drawn and the first
  // read of the run store coming back.
  const waiting = dispatchView(RECEIPT, { loaded: false, run: null, output: null });
  expect(waiting.state).toBe("running");
  expect(waiting.line).toBe(RECEIPT.summary);
});

test("the watch hands React the same snapshot until the run actually changed", async () => {
  let current = run({ progress: "Reading" });
  const watch = createDispatchWatch({
    list: async () => [current],
    subscribe: () => () => {},
    readOutput: async () => "",
  });
  watch.subscribe(() => {});
  await watch.refresh();
  const first = watch.snapshot("run-7");
  await watch.refresh();
  expect(watch.snapshot("run-7")).toBe(first);
  current = run({ progress: "Reading the third paper", revision: 2 });
  await watch.refresh();
  expect(watch.snapshot("run-7")).not.toBe(first);
  expect(watch.snapshot("run-7").run?.progress).toBe("Reading the third paper");
});

test("a run nobody has heard of settles on gone once the store has answered", async () => {
  const watch = createDispatchWatch({
    list: async () => [],
    subscribe: () => () => {},
    readOutput: async () => "",
  });
  expect(watch.snapshot("run-9").loaded).toBe(false);
  watch.subscribe(() => {});
  await watch.refresh();
  expect(watch.snapshot("run-9")).toEqual({ loaded: true, run: null, output: null });
});
