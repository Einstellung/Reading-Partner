// The lines on the Today screen (src/ui/components/info/today.ts). Every one is
// derived from something already on disk, so every one of them is assertable.
// Run: bun test.

import { expect, test } from "bun:test";
import type { Briefing } from "../../../src/info/briefing/types";
import {
  briefingEyebrow,
  briefingFooterLine,
  continueMetaLine,
  todayDateLine,
} from "../../../src/ui/components/info/today";

test("the date line names the weekday and the day, and not the year", () => {
  const line = todayDateLine(new Date(2026, 8, 5), "en-GB");
  expect(line).toBe("Saturday 5 September");
  expect(line).not.toContain("2026");
});

test("the continue line is the topic, the page and the marks", () => {
  expect(continueMetaLine("agent loops", { page: 61, pages: 144, marks: 23 })).toBe(
    "agent loops · p. 61 of 144 · 23 marks",
  );
});

// A book that was never opened has no position and nothing marked. The topic is
// still worth saying, and there is no dangling separator after it.
test("a book with nothing read yet is just its topic", () => {
  expect(continueMetaLine("agent loops", undefined)).toBe("agent loops");
  expect(continueMetaLine("agent loops", { marks: 0 })).toBe("agent loops");
});

test("one mark is a mark, one page with no length is just the page", () => {
  expect(continueMetaLine("t", { page: 2, marks: 1 })).toBe("t · p. 2 · 1 mark");
});

function briefingWith(over: Partial<Briefing>): Briefing {
  return {
    date: "2026-09-05",
    generatedAt: 0,
    overview: "",
    mustRead: [],
    outOfLane: [],
    oneLiners: [],
    filtered: [],
    items: {},
    ...over,
  } as Briefing;
}

test("the footer counts what the card is not showing", () => {
  const b = briefingWith({
    outOfLane: [{ itemId: "a" }] as Briefing["outOfLane"],
    oneLiners: [{ itemId: "b" }, { itemId: "c" }] as Briefing["oneLiners"],
    filtered: [{ itemId: "d" }, { itemId: "e" }, { itemId: "f" }] as Briefing["filtered"],
  });
  expect(briefingFooterLine(b)).toBe("1 out of your lane · 2 one-liners · 3 filtered");
});

test("one one-liner is a one-liner", () => {
  const b = briefingWith({ oneLiners: [{ itemId: "b" }] as Briefing["oneLiners"] });
  expect(briefingFooterLine(b)).toBe("0 out of your lane · 1 one-liner · 0 filtered");
});

// A briefing built today says the time; one built earlier says the date too,
// because a reader can be looking at yesterday's without being told.
test("the eyebrow says when the briefing was built", () => {
  const now = new Date(2026, 8, 5, 12, 0);
  const today = briefingWith({ generatedAt: new Date(2026, 8, 5, 8, 14).getTime() });
  expect(briefingEyebrow(today, now)).toContain("Today's briefing · built ");
  expect(briefingEyebrow(today, now)).toContain("8:14");

  const yesterday = briefingWith({ generatedAt: new Date(2026, 8, 4, 8, 14).getTime() });
  expect(briefingEyebrow(yesterday, now)).toContain("2026");
});

test("with no briefing the eyebrow says only what the card is", () => {
  expect(briefingEyebrow(null)).toBe("Today's briefing");
});
