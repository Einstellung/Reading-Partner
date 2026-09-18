// What the soul is told it is still waiting on (docs/72). The rule is the box's
// rule: this conversation's runs only, and nothing at all when there are none,
// so a turn that has handed nothing off is byte for byte the turn it was
// (docs/09).
//
// Run: bun test.

import { expect, test } from "bun:test";
import { openRuns, runsForHere } from "../../src/soul/self";
import type { Run } from "../../src/legion/run";

function run(over: Partial<Run> & { id: string }): Run {
  return {
    kind: "literature",
    tier: "local",
    delegator: { kind: "soul" },
    brief: "legion/briefs/one.md",
    state: "running",
    attempts: 1,
    createdAt: 1_000,
    revision: 1,
    ...over,
  };
}

function toBook(bookId: string, threadId: string): string {
  return JSON.stringify({ place: "book", bookId, threadId });
}

const HERE = toBook("book-1", "thread-1");

test("only this thread's unfinished runs are counted", () => {
  const runs = [
    run({ id: "mine", deliverTo: HERE }),
    run({ id: "other-thread", deliverTo: toBook("book-1", "thread-2") }),
    run({ id: "done", state: "done", deliverTo: HERE }),
    run({ id: "failed", state: "failed", deliverTo: HERE }),
    run({ id: "cancelled", state: "cancelled", deliverTo: HERE }),
    run({ id: "pending", state: "pending", deliverTo: HERE }),
    run({ id: "nowhere" }),
    run({ id: "the door", deliverTo: JSON.stringify({ place: "door", date: "2026-09-18" }) }),
  ];
  expect(runsForHere(runs, "thread-1").map((r) => r.id)).toEqual(["mine", "pending"]);
});

test("a turn held over a book with no thread of its own falls back to the book", () => {
  const runs = [
    run({ id: "this book", deliverTo: toBook("book-1", "thread-9") }),
    run({ id: "another book", deliverTo: toBook("book-2", "thread-9") }),
  ];
  expect(runsForHere(runs, "", "book-1").map((r) => r.id)).toEqual(["this book"]);
  // No thread and no book is nothing to match on, not everything.
  expect(runsForHere(runs, "")).toEqual([]);
});

test("they are listed in the order they were sent", () => {
  const runs = [
    run({ id: "second", createdAt: 2_000, deliverTo: HERE }),
    run({ id: "first", createdAt: 1_000, deliverTo: HERE }),
  ];
  expect(runsForHere(runs, "thread-1").map((r) => r.id)).toEqual(["first", "second"]);
});

test("nothing out adds not one byte", async () => {
  expect(await openRuns("thread-1", "book-1", { runs: async () => [] })).toBe("");
  // Nor does a store that will not answer: a turn the reader is waiting on is
  // not the place to raise a disk problem.
  expect(
    await openRuns("thread-1", "book-1", {
      runs: async () => {
        throw new Error("no");
      },
    }),
  ).toBe("");
});

test("one line per run: the kind, what it was asked, how long ago, and where it is", async () => {
  const text = await openRuns("thread-1", undefined, {
    runs: async () => [
      run({
        id: "mine",
        kind: "literature-sweep",
        createdAt: Date.now() - 90 * 60_000,
        progress: "Reading the third paper",
        deliverTo: HERE,
      }),
    ],
    readBrief: async () => "\nFind what has been published on inline caches.\nThen say which.",
  });
  expect(text).toContain("still waiting on");
  expect(text).toContain(
    "[out] literature sweep — Find what has been published on inline caches. — sent 1 hour ago — Reading the third paper",
  );
});

test("a brief that will not read leaves the line with what is known", async () => {
  const text = await openRuns("thread-1", undefined, {
    runs: async () => [run({ id: "mine", deliverTo: HERE })],
    readBrief: async () => {
      throw new Error("gone");
    },
  });
  expect(text).toContain("[out] literature — sent ");
  expect(text).not.toContain("——");
});
