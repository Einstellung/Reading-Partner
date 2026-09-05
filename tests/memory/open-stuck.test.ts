// Open stuck points (src/memory/observations/open-stuck.ts): which of a book's
// stuck points nothing has recorded the reader getting past. Run: bun test.

import { expect, test } from "bun:test";
import { openStuckPoints } from "../../src/memory/observations/open-stuck";
import type { Observation } from "../../src/memory/observations/types";

const BOOK = "book-a";
const OTHER = "book-b";

function observation(over: Partial<Observation> & { id: string }): Observation {
  return {
    type: "stuck-point",
    summary: "stuck on the attention formula",
    body: "",
    created: "2026-08-01",
    updated: "2026-08-01",
    anchors: { annotationIds: [], messageIds: [] },
    bookId: BOOK,
    ...over,
  };
}

const STUCK = "m-1111111111111111";
const OTHER_STUCK = "m-2222222222222222";

test("a stuck point with nothing pointing at it is open", () => {
  const stuck = observation({ id: STUCK });
  expect(openStuckPoints([stuck], BOOK)).toEqual([stuck]);
});

test("a later understood-concept naming it closes it", () => {
  const stuck = observation({ id: STUCK });
  const got = observation({
    id: "m-3333333333333333",
    type: "understood-concept",
    summary: "explained softmax scaling back to me",
    body: `Came back to ${STUCK} and got it.`,
    created: "2026-08-04",
  });
  expect(openStuckPoints([stuck, got], BOOK)).toEqual([]);
});

test("an understood-concept written the same day closes it too", () => {
  const stuck = observation({ id: STUCK });
  const got = observation({
    id: "m-3333333333333333",
    type: "understood-concept",
    body: `${STUCK} is closed.`,
    created: stuck.created,
  });
  expect(openStuckPoints([stuck, got], BOOK)).toEqual([]);
});

test("an earlier understood-concept naming it leaves it open", () => {
  const stuck = observation({ id: STUCK, created: "2026-08-10" });
  const older = observation({
    id: "m-3333333333333333",
    type: "understood-concept",
    body: `Had ${STUCK} down in July.`,
    created: "2026-07-20",
  });
  expect(openStuckPoints([stuck, older], BOOK)).toEqual([stuck]);
});

test("only an understood-concept closes one — being explained again does not", () => {
  const stuck = observation({ id: STUCK });
  const retold = observation({
    id: "m-3333333333333333",
    type: "reading-position",
    body: `Went over ${STUCK} again on p.40.`,
    created: "2026-08-09",
  });
  const belief = observation({
    id: "m-4444444444444444",
    type: "belief",
    body: `Thinks ${STUCK} is settled.`,
    created: "2026-08-09",
  });
  expect(openStuckPoints([stuck, retold, belief], BOOK)).toEqual([stuck]);
});

test("another book's stuck points are not this book's, and neither are undated ones", () => {
  const mine = observation({ id: STUCK });
  const theirs = observation({ id: OTHER_STUCK, bookId: OTHER });
  const bookless = observation({ id: "m-5555555555555555", bookId: undefined });
  expect(openStuckPoints([mine, theirs, bookless], BOOK)).toEqual([mine]);
  expect(openStuckPoints([mine, theirs, bookless], OTHER)).toEqual([theirs]);
  expect(openStuckPoints([mine, theirs], "")).toEqual([]);
});

// An id names one observation wherever it is stored, so the understanding that
// closes a stuck point does not have to have happened in the same book.
test("an understood-concept from another book still closes it", () => {
  const stuck = observation({ id: STUCK });
  const elsewhere = observation({
    id: "m-3333333333333333",
    type: "understood-concept",
    bookId: OTHER,
    body: `The other book's chapter 2 finally landed ${STUCK}.`,
    created: "2026-08-06",
  });
  expect(openStuckPoints([stuck, elsewhere], BOOK)).toEqual([]);
});

test("the order they were handed in is the order they come back", () => {
  const first = observation({ id: STUCK, updated: "2026-08-09" });
  const second = observation({ id: OTHER_STUCK, updated: "2026-08-02" });
  expect(openStuckPoints([first, second], BOOK).map((o) => o.id)).toEqual([STUCK, OTHER_STUCK]);
});
