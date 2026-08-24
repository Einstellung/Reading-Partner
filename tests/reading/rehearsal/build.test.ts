// Events into one run (src/reading/rehearsal/build.ts): which page a sentence
// belongs to, what a page the reader came back to looks like, and what the
// timestamps mean when a source reports out of order. Run: bun test.

import { expect, test } from "bun:test";
import { buildRun } from "../../../src/reading/rehearsal/build";
import type { RehearsalEvent } from "../../../src/reading/rehearsal/types";

function slide(at: number, index: number, title = `Page ${index}`): RehearsalEvent {
  return { kind: "slide", at, index, slideKind: "content", title };
}

function said(at: number, text: string, duration = 1_000): RehearsalEvent {
  return { kind: "utterance", at, endedAt: at + duration, text };
}

function run(events: RehearsalEvent[], startedAt = 0) {
  return buildRun({
    id: "run-1",
    ordinal: 1,
    talkId: "talk-1",
    deckFile: "slides/talk-1-my-talk.html",
    startedAt,
    events,
  });
}

test("a run with no events at all is a run with no pages", () => {
  const built = run([]);
  expect(built.pages).toEqual([]);
  expect(built.endedAt).toBeNull();
  expect(built.id).toBe("run-1");
  expect(built.deckFile).toBe("slides/talk-1-my-talk.html");
});

test("pages with nothing said to them are still pages, in index order", () => {
  const built = run([slide(10, 0), slide(20, 1), slide(30, 2), { kind: "end", at: 40 }]);
  expect(built.pages.map((p) => p.index)).toEqual([0, 1, 2]);
  expect(built.pages.map((p) => p.transcript)).toEqual(["", "", ""]);
  expect(built.pages.map((p) => p.enteredAt)).toEqual([10, 20, 30]);
  expect(built.pages.map((p) => p.leftAt)).toEqual([20, 30, 40]);
  expect(built.endedAt).toBe(40);
});

test("what was said lands on the page that was up when it started", () => {
  const built = run([
    slide(10, 0),
    said(11, "Here is the question this book asks."),
    slide(20, 1),
    said(21, "And here is the answer."),
    { kind: "end", at: 30 },
  ]);
  expect(built.pages[0].transcript).toBe("Here is the question this book asks.");
  expect(built.pages[1].transcript).toBe("And here is the answer.");
});

// The reader keeps talking through the page turn. The sentence began on the
// page they were explaining, so that is where it counts.
test("a sentence that runs past the page turn belongs to the page it began on", () => {
  const built = run([
    slide(10, 0),
    said(15, "which brings us to the next chapter", 8_000),
    slide(18, 1),
    said(24, "so that is the mechanism"),
    { kind: "end", at: 30 },
  ]);
  expect(built.pages[0].transcript).toBe("which brings us to the next chapter");
  expect(built.pages[1].transcript).toBe("so that is the mechanism");
});

test("anything said before the first slide leaves no trace", () => {
  const built = run([
    said(1, "testing, one two"),
    said(2, "right, starting now"),
    slide(10, 0),
    said(11, "Good evening."),
    { kind: "end", at: 20 },
  ]);
  expect(built.pages).toHaveLength(1);
  expect(built.pages[0].transcript).toBe("Good evening.");
  expect(built.pages[0].enteredAt).toBe(10);
});

test("a page the reader came back to is one page, with both visits in it", () => {
  const built = run([
    slide(10, 0),
    said(11, "first pass"),
    slide(20, 1),
    said(21, "on to page two"),
    slide(30, 0),
    said(31, "back to this one"),
    slide(40, 1),
    { kind: "end", at: 50 },
  ]);
  expect(built.pages).toHaveLength(2);
  expect(built.pages[0].index).toBe(0);
  expect(built.pages[0].enteredAt).toBe(10);
  expect(built.pages[0].leftAt).toBe(40);
  expect(built.pages[0].transcript).toBe("first pass\nback to this one");
  expect(built.pages[1].leftAt).toBe(50);
});

test("a page revisited and never left again ends the run open", () => {
  const built = run([slide(10, 0), slide(20, 1), slide(30, 0)]);
  expect(built.pages[0].leftAt).toBeNull();
  expect(built.pages[1].leftAt).toBe(30);
  expect(built.endedAt).toBeNull();
});

// The deck re-sends the current page on resize. Two of the same index in a row
// is one visit, not a departure and an arrival a millisecond apart.
test("the same page reported twice in a row is not a page turn", () => {
  const built = run([
    slide(10, 0),
    said(11, "as I was saying"),
    slide(14, 0),
    said(15, "and so"),
    slide(20, 1),
    { kind: "end", at: 30 },
  ]);
  expect(built.pages).toHaveLength(2);
  expect(built.pages[0].enteredAt).toBe(10);
  expect(built.pages[0].leftAt).toBe(20);
  expect(built.pages[0].transcript).toBe("as I was saying\nand so");
});

test("a later report of the same page is what the page is called", () => {
  const built = run([
    slide(10, 0, "Draft title"),
    slide(20, 1),
    slide(30, 0, "The title now"),
    { kind: "end", at: 40 },
  ]);
  expect(built.pages[0].title).toBe("The title now");
});

test("pages the run never reached are absent, not empty", () => {
  const built = run([slide(10, 0), slide(20, 3), { kind: "end", at: 30 }]);
  expect(built.pages.map((p) => p.index)).toEqual([0, 3]);
});

// A transcript source that batches, or a clock that is not the deck's, can hand
// the events over in an order the timestamps disagree with.
test("events out of order are put back in order before anything is decided", () => {
  const inOrder = [
    slide(10, 0),
    said(12, "one"),
    slide(20, 1),
    said(22, "two"),
    { kind: "end", at: 30 } as RehearsalEvent,
  ];
  const shuffled = [inOrder[3], inOrder[1], inOrder[4], inOrder[2], inOrder[0]];
  expect(run(shuffled)).toEqual(run(inOrder));
});

// The page change happened before anything said at that instant, and the run
// ended after everything said at it.
test("at one millisecond the page turn comes first and the end comes last", () => {
  const built = run([
    slide(10, 0),
    said(20, "this is about page two"),
    slide(20, 1),
    { kind: "end", at: 20 },
  ]);
  expect(built.pages[0].transcript).toBe("");
  expect(built.pages[1].transcript).toBe("this is about page two");
  expect(built.pages[1].leftAt).toBe(20);
});

test("nothing after the end is part of the run", () => {
  const built = run([
    slide(10, 0),
    { kind: "end", at: 20 },
    slide(30, 1),
    said(31, "oh, one more"),
  ]);
  expect(built.pages.map((p) => p.index)).toEqual([0]);
  expect(built.endedAt).toBe(20);
});

test("a run that was never ended has no end and an open last page", () => {
  const built = run([slide(10, 0), said(11, "and then the app was closed")]);
  expect(built.endedAt).toBeNull();
  expect(built.pages[0].leftAt).toBeNull();
});

// A source that heard nothing must not open a blank line in the middle of what
// the reader actually said.
test("empty utterances neither add a line nor a blank one", () => {
  const built = run([slide(10, 0), said(11, "one"), said(12, "   "), said(13, "two")]);
  expect(built.pages[0].transcript).toBe("one\ntwo");
});

test("a run with no transcript source at all still records the shape of the talk", () => {
  const built = run([slide(10, 0), slide(70_000, 1), { kind: "end", at: 130_000 }]);
  expect(built.pages.map((p) => [p.enteredAt, p.leftAt])).toEqual([
    [10, 70_000],
    [70_000, 130_000],
  ]);
  expect(built.pages.every((p) => p.transcript === "")).toBe(true);
});
