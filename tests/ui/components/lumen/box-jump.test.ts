// Where a card goes when it is tapped (docs/68).
//
// Run: bun test.

import { expect, test } from "bun:test";

import {
  doorFocusKey,
  doorFocusSelector,
  notOnThisShellLine,
  planItemJump,
  planJump,
  type Place,
} from "../../../../src/ui/components/lumen/box-jump";

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

test("the phone opens the book's conversation in one step", () => {
  const jump = planJump({ place: "book", bookId: "b1", threadId: "t1", annotationId: "a1", page: 3 }, PHONE);
  expect(jump).toEqual({ steps: [{ step: "open-book-conversation", bookId: "b1", threadId: "t1" }], unreachable: null });
});

test("a coaching or retell card opens its view in its topic on the desk, and says why not on the phone", () => {
  expect(planJump({ place: "talk", outlineId: "o1" }, DESK)).toEqual({
    steps: [{ step: "open-coach", outlineId: "o1" }],
    unreachable: null,
  });
  expect(planJump({ place: "retell", retellId: "r1" }, DESK)).toEqual({
    steps: [{ step: "open-retell", retellId: "r1" }],
    unreachable: null,
  });
  for (const origin of [
    { place: "talk", outlineId: "o1" },
    { place: "retell", retellId: "r1" },
  ] as const) {
    expect(planJump(origin, PHONE)).toEqual({ steps: [], unreachable: notOnThisShellLine() });
  }
});

test("the door opens its conversation and the briefing goes to its page, in either shell", () => {
  for (const place of [DESK, PHONE]) {
    expect(planJump({ place: "door", date: "2026-09-15" }, place)).toEqual({
      steps: [{ step: "open-door-chat", date: "2026-09-15" }],
      unreachable: null,
    });
    expect(planJump({ place: "briefing", date: "2026-09-15" }, place)).toEqual({
      steps: [{ step: "go-to-briefing", date: "2026-09-15" }],
      unreachable: null,
    });
    expect(planJump({ place: "meals" }, place)).toEqual({
      steps: [{ step: "go-to-meals" }],
      unreachable: null,
    });
  }
});

test("a run's card from the door opens the door chat of its day at the reply that answered it", () => {
  const item = { origin: { place: "door" as const, date: "2026-10-09" }, kind: "ingest-url", body: "failed", runId: "run-7" };
  for (const place of [DESK, PHONE]) {
    expect(planItemJump(item, place)).toEqual({
      steps: [{ step: "open-door-chat", date: "2026-10-09", focus: { runId: "run-7" } }],
      unreachable: null,
    });
  }
  // A door card with no run (the reader's own turn) opens the conversation only.
  expect(planItemJump({ origin: item.origin, kind: "turn" }, PHONE).steps).toEqual([
    { step: "open-door-chat", date: "2026-10-09" },
  ]);
});

test("the focused row is found by the attribute its view draws, the value quoted", () => {
  expect(doorFocusSelector({ intakeId: "in-1" })).toBe('[data-intake-id="in-1"]');
  expect(doorFocusSelector({ runId: "run-7" })).toBe('[data-origin-run="run-7"]');
  expect(doorFocusSelector({ runId: 'a"b' })).toBe('[data-origin-run="a\\"b"]');
  expect(doorFocusKey({ intakeId: "in-1" })).not.toBe(doorFocusKey({ runId: "in-1" }));
  expect(doorFocusKey(undefined)).toBe("");
});
