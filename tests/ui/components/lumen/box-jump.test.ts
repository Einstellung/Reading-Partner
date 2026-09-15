// Where a card goes when it is tapped (docs/68).
//
// Run: bun test.

import { expect, test } from "bun:test";

import { NO_READER_HERE, planJump, type Place } from "../../../../src/ui/components/lumen/box-jump";

const DESK: Place = { shell: "desktop", inReader: false, openBookId: null };
const PHONE: Place = { shell: "phone", inReader: false, openBookId: null };

test("a book nobody has open is opened first, then the page, then the mark", () => {
  const jump = planJump(
    { place: "book", bookId: "b1", threadId: "t1", annotationId: "a1", page: 37 },
    DESK,
  );
  expect(jump.unreachable).toBeNull();
  expect(jump.steps).toEqual([
    { step: "open-book", bookId: "b1" },
    { step: "go-to-page", page: 37 },
    { step: "open-annotation", annotationId: "a1" },
  ]);
});

test("the book already open is not reopened", () => {
  const jump = planJump(
    { place: "book", bookId: "b1", threadId: "t1", page: 12 },
    { shell: "desktop", inReader: true, openBookId: "b1" },
  );
  expect(jump.steps).toEqual([
    { step: "go-to-page", page: 12 },
    { step: "open-thread", bookId: "b1", threadId: "t1" },
  ]);
});

test("another book open is still another book", () => {
  const jump = planJump(
    { place: "book", bookId: "b2", threadId: "t9" },
    { shell: "desktop", inReader: true, openBookId: "b1" },
  );
  expect(jump.steps).toEqual([
    { step: "open-book", bookId: "b2" },
    { step: "open-thread", bookId: "b2", threadId: "t9" },
  ]);
});

test("no page on the item means no page step", () => {
  const jump = planJump({ place: "book", bookId: "b1", threadId: "t1" }, DESK);
  expect(jump.steps.some((step) => step.step === "go-to-page")).toBe(false);
});

test("the phone has no reader to jump into, and says so", () => {
  const jump = planJump({ place: "book", bookId: "b1", threadId: "t1", page: 3 }, PHONE);
  expect(jump.steps).toEqual([]);
  expect(jump.unreachable).toBe(NO_READER_HERE);
});

test("the door and the briefing go to their own place in either shell", () => {
  for (const place of [DESK, PHONE]) {
    expect(planJump({ place: "door", date: "2026-09-15" }, place)).toEqual({
      steps: [{ step: "go-to-door", date: "2026-09-15" }],
      unreachable: null,
    });
    expect(planJump({ place: "briefing", date: "2026-09-15" }, place)).toEqual({
      steps: [{ step: "go-to-briefing", date: "2026-09-15" }],
      unreachable: null,
    });
  }
});
