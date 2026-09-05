// Dating a statement from its evidence (src/memory/statements/dates.ts), pure.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  anchorSpan,
  isObservationId,
  laterDay,
  unionSpans,
} from "../../src/memory/statements/dates";
import { localDate } from "../../src/memory/observations/files";

const JULY_17 = new Date("2026-07-17T12:00:00Z").getTime();
const JULY_20 = new Date("2026-07-20T12:00:00Z").getTime();

test("an observation id is told from a message anchor by its shape", () => {
  expect(isObservationId("m-0123456789abcdef")).toBe(true);
  // The narrow width still on disk until the 0.12 migration has run everywhere.
  expect(isObservationId("m-0123abcd")).toBe(true);
  expect(isObservationId("t-0123456789abcdef")).toBe(false);
  expect(isObservationId("thread-1:1750000000000")).toBe(false);
  expect(isObservationId("m-0123456789abcdef@thread-1:1750000000000")).toBe(false);
  expect(isObservationId("m-zzzz")).toBe(false);
});

test("all three anchor forms that carry a timestamp date to that day", () => {
  const day = localDate(JULY_17);
  expect(anchorSpan(`thread-1:${JULY_17}`)).toEqual({ first: day, last: day });
  expect(anchorSpan(`t-0123456789abcdef@thread-1:${JULY_17}`)).toEqual({ first: day, last: day });
});

// The id-only form names a turn without saying when it was, and nothing in a
// pure function can find out. Null here becomes a refusal in the store rather
// than today's date on a statement about last month.
test("an anchor with no timestamp has no day", () => {
  expect(anchorSpan("t-0123456789abcdef")).toBeNull();
  expect(anchorSpan("")).toBeNull();
  expect(anchorSpan("thread-1:")).toBeNull();
  expect(anchorSpan("thread-1:0")).toBeNull();
});

test("the span of several pieces of evidence runs from the earliest to the latest", () => {
  expect(
    unionSpans([
      { first: "2026-07-17", last: "2026-07-18" },
      { first: "2026-07-02", last: "2026-07-03" },
      { first: "2026-08-01", last: "2026-08-01" },
    ]),
  ).toEqual({ first: "2026-07-02", last: "2026-08-01" });
  expect(unionSpans([])).toBeNull();
});

test("the later day wins, so lastSupported never moves backwards", () => {
  expect(laterDay("2026-07-17", "2026-07-02")).toBe("2026-07-17");
  expect(laterDay("2026-07-02", "2026-07-17")).toBe("2026-07-17");
  expect(laterDay("2026-07-17", "2026-07-17")).toBe("2026-07-17");
  // Not the same day at UTC+8 as at UTC, which is why the anchor path uses the
  // device's own clock.
  expect(localDate(JULY_20)).toMatch(/^2026-07-(20|21)$/);
});
