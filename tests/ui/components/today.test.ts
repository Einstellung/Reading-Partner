// The lines on the Today screen (src/ui/components/info/today.ts). Every one is
// derived from something already on disk, so every one of them is assertable.
// Run: bun test.

import { expect, test } from "bun:test";
import type { Briefing, LabCover } from "../../../src/info/collect/types";
import {
  briefingCardBody,
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

function cover(labId: string, name: string, text: string): LabCover {
  return { labId, name, cover: text, judgments: [] };
}

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

// The card says how much of the day is behind it: how many labs moved, and how
// much of what they found is worth opening. Not how many headlines were thrown
// away — a reader with no time is not owed that number.
test("the footer counts the labs that moved and what is worth opening", () => {
  const b = briefingWith({
    labs: [cover("lab-1", "Robotics", "Arms got cheaper."), cover("lab-2", "Chips", "TSMC slipped.")],
    mustRead: [{ itemId: "a", reason: "r" }],
    outOfLane: [{ itemId: "b", reason: "r" }],
    oneLiners: [{ itemId: "c", line: "l" }],
    filtered: [{ itemId: "d", category: "vendor PR" }],
  });
  expect(briefingFooterLine(b)).toBe("2 labs changed · 2 worth reading");
  expect(briefingFooterLine(b)).not.toContain("filtered");
});

test("one lab is a lab", () => {
  const b = briefingWith({ labs: [cover("lab-1", "Robotics", "Arms got cheaper.")] });
  expect(briefingFooterLine(b)).toBe("1 lab changed · 0 worth reading");
});

// A day where every lab ran and none of them changed. Nothing is worth reading
// by definition, and saying "0 worth reading" would be a second way of saying
// the same nothing.
test("an empty day counts the labs and stops", () => {
  const b = briefingWith({ labs: [], quiet: ["Robotics", "Chips"] });
  expect(briefingFooterLine(b)).toBe("0 labs changed");
  expect(briefingCardBody(b)).toBe("Nothing changed today.");
});

// A briefing made before labs existed has no lab count to give.
test("a legacy briefing counts only what is worth reading", () => {
  const b = briefingWith({
    overview: "A quiet day in AI.",
    mustRead: [{ itemId: "a", reason: "r" }],
    oneLiners: [{ itemId: "c", line: "l" }],
  });
  expect(briefingFooterLine(b)).toBe("1 worth reading");
  expect(briefingCardBody(b)).toBe("A quiet day in AI.");
});

// The card has room for two covers. A third is not summarized, it is elided:
// the page below has all of them.
test("the card body is the first two covers, and says when there are more", () => {
  const two = briefingWith({ labs: [cover("l1", "A", "One."), cover("l2", "B", "Two.")] });
  expect(briefingCardBody(two)).toBe("One. Two.");

  const three = briefingWith({
    labs: [cover("l1", "A", "One."), cover("l2", "B", "Two."), cover("l3", "C", "Three.")],
  });
  expect(briefingCardBody(three)).toBe("One. Two. …");
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
