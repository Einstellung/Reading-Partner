// Reading a briefing file back and boxing a day into one
// (src/info/boxes/briefing.ts): the triage build's shape arrives normalized, and
// the day is cut by room in roster order. Run: bun test.

import { expect, test } from "bun:test";
import { boxBriefing, briefingOverview, parseBriefing } from "../../../src/info/boxes/briefing";
import type { CableDay } from "../../../src/info/cable/types";
import type { LabOutcome } from "../../../src/info/collect/run-state";
import type { InfoItem } from "../../../src/info/sources/item";

const DATE = "2026-09-09";

function item(id: string): InfoItem {
  return {
    id,
    source: "s",
    sourceName: "Source",
    title: `title ${id}`,
    url: `https://x/${id}`,
    publishedAt: "2026-09-09",
  };
}

function cable(id: string, labId: string, outside?: string) {
  return {
    id,
    date: DATE,
    title: `title ${id}`,
    url: `https://x/${id}`,
    source: "s",
    sourceName: "Source",
    publishedAt: "2026-09-09",
    hits: labId ? [{ labId, observables: [] }] : [],
    ...(outside ? { outside } : {}),
  };
}

function day(...cables: ReturnType<typeof cable>[]): CableDay {
  return { version: 1, date: DATE, cables };
}

function outcome(labId: string, name: string, over: Partial<LabOutcome> = {}): LabOutcome {
  return {
    labId,
    name,
    cover: { labId, name, cover: `${name} moved.`, judgments: [] },
    mustRead: [],
    oneLiners: [],
    ...over,
  };
}

// --- parseBriefing -----------------------------------------------------------

test("a v2 briefing reads back as it was written", () => {
  const b = parseBriefing({
    version: 2,
    date: DATE,
    generatedAt: 7,
    labs: [{ labId: "lab-a", name: "Robotics", cover: "Arms got cheaper.", judgments: ["j-1"] }],
    quiet: ["Chips"],
    mustRead: [{ itemId: "a", reason: "r", labId: "lab-a" }],
    oneLiners: [{ itemId: "b", line: "l" }],
    outOfLane: [{ itemId: "c", reason: "widening" }],
    items: { a: { title: "A", url: "u", source: "s", sourceName: "S", publishedAt: "p" } },
  });
  expect(b).not.toBeNull();
  expect(b!.labs[0].judgments).toEqual(["j-1"]);
  expect(b!.quiet).toEqual(["Chips"]);
  expect(b!.mustRead[0].labId).toBe("lab-a");
  expect(b!.oneLiners[0].labId).toBeUndefined();
  expect(b!.items.a.sourceName).toBe("S");
});

// A device still on the triage build publishes its own shape into sync range, so
// a phone upgraded today can pull yesterday's. Its overview becomes the day's one
// nameless cover and the discard pile goes.
test("a triage-era briefing arrives as one nameless cover, without its filtered pile", () => {
  const b = parseBriefing({
    date: DATE,
    generatedAt: 7,
    overview: "A quiet day in AI.",
    mustRead: [{ itemId: "a", reason: "r" }],
    oneLiners: [],
    outOfLane: [],
    filtered: [{ itemId: "z", category: "vendor PR" }],
    screen: { discovered: 400, kept: 9, dropped: 391, cappedOut: 0, droppedIds: ["z"] },
    items: { a: { title: "A", url: "u", source: "s", sourceName: "S", publishedAt: "p" } },
  });
  expect(b!.version).toBe(2);
  expect(b!.labs).toEqual([{ labId: "", name: "", cover: "A quiet day in AI.", judgments: [] }]);
  expect(b!.quiet).toEqual([]);
  expect(JSON.stringify(b)).not.toContain("vendor PR");
  expect(JSON.stringify(b)).not.toContain("391");
});

test("an empty day is not a legacy briefing: no covers and no overview to invent", () => {
  const b = parseBriefing({ version: 2, date: DATE, generatedAt: 7, labs: [], quiet: ["Chips"] });
  expect(b!.labs).toEqual([]);
  expect(b!.mustRead).toEqual([]);
  expect(b!.items).toEqual({});
});

test("bytes that are not a briefing read as null", () => {
  expect(parseBriefing(null)).toBeNull();
  expect(parseBriefing("a string")).toBeNull();
  expect(parseBriefing({ date: DATE })).toBeNull();
  expect(parseBriefing({ generatedAt: 1 })).toBeNull();
});

test("entries missing what they would be rendered by are dropped, not kept empty", () => {
  const b = parseBriefing({
    version: 2,
    date: DATE,
    generatedAt: 1,
    labs: [{ labId: "lab-a", name: "R", cover: "" }, { labId: "lab-b", name: "C", cover: "moved" }],
    mustRead: [{ itemId: "a" }, { reason: "r" }, { itemId: "b", reason: "r" }],
  });
  expect(b!.labs.map((l) => l.labId)).toEqual(["lab-b"]);
  expect(b!.mustRead.map((r) => r.itemId)).toEqual(["b"]);
});

test("the day in one line is the covers, in order", () => {
  const b = parseBriefing({
    version: 2,
    date: DATE,
    generatedAt: 1,
    labs: [
      { labId: "lab-a", name: "R", cover: "Arms got cheaper." },
      { labId: "lab-b", name: "C", cover: "TSMC slipped." },
    ],
  })!;
  expect(briefingOverview(b)).toBe("Arms got cheaper. TSMC slipped.");
  expect(briefingOverview({ ...b, labs: [] })).toBe("");
});

// --- boxBriefing -------------------------------------------------------------

const LABS = [
  { id: "lab-a", name: "Robotics" },
  { id: "lab-b", name: "Chips" },
];

test("the covers are the rooms that moved, in roster order; the rest are named quiet", () => {
  const b = boxBriefing({
    date: DATE,
    generatedAt: 5,
    labs: LABS,
    outcomes: [outcome("lab-b", "Chips"), outcome("lab-a", "Robotics", { cover: null })],
    cables: day(cable("x1", "lab-a"), cable("x2", "lab-b")),
    items: [item("x1"), item("x2")],
  });
  expect(b.labs.map((l) => l.name)).toEqual(["Chips"]);
  expect(b.quiet).toEqual(["Robotics"]);
  expect(b.version).toBe(2);
});

test("a room that never ran is quiet too, and its name comes off the roster", () => {
  const b = boxBriefing({
    date: DATE,
    generatedAt: 5,
    labs: LABS,
    outcomes: [outcome("lab-a", "Robotics")],
    cables: day(cable("x1", "lab-a")),
    items: [item("x1")],
  });
  expect(b.quiet).toEqual(["Chips"]);
});

test("the picks are concatenated in room order, and an item is claimed once", () => {
  const b = boxBriefing({
    date: DATE,
    generatedAt: 5,
    labs: LABS,
    outcomes: [
      outcome("lab-a", "Robotics", {
        mustRead: [{ itemId: "x1", reason: "robotics", labId: "lab-a" }],
        oneLiners: [{ itemId: "x2", line: "also robotics", labId: "lab-a" }],
      }),
      outcome("lab-b", "Chips", {
        // Both rooms read x1; the reader sees it once, under the first to ask.
        mustRead: [{ itemId: "x1", reason: "chips", labId: "lab-b" }],
        oneLiners: [{ itemId: "x3", line: "chips", labId: "lab-b" }],
      }),
    ],
    cables: day(cable("x1", "lab-a"), cable("x2", "lab-a"), cable("x3", "lab-b")),
    items: [item("x1"), item("x2"), item("x3")],
  });
  expect(b.mustRead.map((r) => [r.itemId, r.labId])).toEqual([["x1", "lab-a"]]);
  expect(b.oneLiners.map((r) => r.itemId)).toEqual(["x2", "x3"]);
  // Every referenced item carries meta, and nothing else does.
  expect(Object.keys(b.items).sort()).toEqual(["x1", "x2", "x3"]);
});

test("a pick naming a cable the day never filed is dropped", () => {
  const b = boxBriefing({
    date: DATE,
    generatedAt: 5,
    labs: LABS,
    outcomes: [
      outcome("lab-a", "Robotics", {
        mustRead: [{ itemId: "ghost", reason: "invented", labId: "lab-a" }],
      }),
    ],
    cables: day(cable("x1", "lab-a")),
    items: [item("x1")],
  });
  expect(b.mustRead).toEqual([]);
  expect(b.items).toEqual({});
});

test("the day's one outside cable is the out-of-lane pick", () => {
  const b = boxBriefing({
    date: DATE,
    generatedAt: 5,
    labs: LABS,
    outcomes: [],
    cables: day(cable("x1", "", "nobody follows this and it matters")),
    items: [item("x1")],
  });
  expect(b.outOfLane).toEqual([{ itemId: "x1", reason: "nobody follows this and it matters" }]);
  expect(b.items.x1.title).toBe("title x1");
});
