// What the briefing page decides before it renders
// (src/ui/components/info/briefing-view.ts): which shape the briefing is, what
// an empty day looks like, and which lab a line belongs to.
// Run: bun test.

import { expect, test } from "bun:test";
import type { Briefing, LabCover } from "../../../src/info/collect/types";
import {
  NOTHING_CHANGED,
  briefingCovers,
  isEmptyDay,
  isLabBriefing,
  labTag,
  quietLine,
} from "../../../src/ui/components/info/briefing-view";

function cover(labId: string, name: string): LabCover {
  return { labId, name, cover: `${name} moved.`, judgments: [] };
}

function briefingWith(over: Partial<Briefing>): Briefing {
  return {
    date: "2026-09-09",
    generatedAt: 0,
    mustRead: [],
    outOfLane: [],
    oneLiners: [],
    items: {},
    ...over,
  } as Briefing;
}

// A day with no labs at all is a briefing from before labs existed; a day with
// an empty lab list is one where every lab ran and found nothing. The page says
// different things about them, so presence and length are different questions.
test("no labs at all is a legacy briefing, not an empty day", () => {
  const legacy = briefingWith({ overview: "A quiet day." });
  expect(isLabBriefing(legacy)).toBe(false);
  expect(isEmptyDay(legacy)).toBe(false);
  expect(briefingCovers(legacy)).toEqual([]);
});

test("an empty lab list is an empty day", () => {
  const empty = briefingWith({ labs: [] });
  expect(isLabBriefing(empty)).toBe(true);
  expect(isEmptyDay(empty)).toBe(true);
  expect(NOTHING_CHANGED).toBe("Nothing changed today.");
});

test("labs that changed are the covers", () => {
  const b = briefingWith({ labs: [cover("lab-1", "Robotics")] });
  expect(isEmptyDay(b)).toBe(false);
  expect(briefingCovers(b).map((c) => c.name)).toEqual(["Robotics"]);
});

// Who looked and had nothing to say. Only worth a line when there is someone to
// name.
test("the quiet line names the labs that ran and stayed quiet", () => {
  expect(quietLine(briefingWith({ labs: [], quiet: ["Robotics", "Chips"] }))).toBe(
    "Checked: Robotics · Chips",
  );
  expect(quietLine(briefingWith({ labs: [], quiet: [] }))).toBe(null);
  expect(quietLine(briefingWith({ labs: [] }))).toBe(null);
});

// The tag is the lab's current name, read off the briefing by id. An item with
// no lab, or one naming a lab this briefing has no cover for, gets no tag —
// better than a tag that names nothing.
test("the lab tag is looked up by id and is empty when there is nothing to name", () => {
  const b = briefingWith({ labs: [cover("lab-1", "Robotics")] });
  expect(labTag(b, "lab-1")).toBe("Robotics");
  expect(labTag(b, "lab-9")).toBe("");
  expect(labTag(b, undefined)).toBe("");
  expect(labTag(briefingWith({ overview: "x" }), "lab-1")).toBe("");
});
