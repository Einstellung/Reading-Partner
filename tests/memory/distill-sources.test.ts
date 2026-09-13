// The conversations distillation reads that are not a book's (docs/58, docs/61):
// who may register one, what a registered unit owes, and how a unit stands
// against a book's threads when the sweep picks the one job it will run.
//
// Run: bun test tests/memory/distill-sources.test.ts

import { afterEach, expect, test } from "bun:test";
import {
  collectSourceArrears,
  findSourceUnit,
} from "../../src/memory/distill/collect";
import {
  distillSourceOf,
  distillSources,
  registerDistillSource,
} from "../../src/memory/distill/sources";
import {
  MIN_DISTILL_GAP_MS,
  selectDistillJob,
  type SourceUnit,
  type TopicArrears,
} from "../../src/memory/observations/arrears";

const NOW = Date.parse("2026-09-08T10:00:00Z");

const undos: Array<() => void> = [];

afterEach(() => {
  while (undos.length) undos.pop()?.();
});

function register(units: SourceUnit[] | (() => Promise<SourceUnit[]>)): void {
  undos.push(
    registerDistillSource({
      kind: "info-thread",
      listUnits: typeof units === "function" ? units : async () => units,
      cursor: "distilledMessages",
      afterEnd: "keep",
    }),
  );
}

function unit(id: string, said: number, topicId = "brief"): SourceUnit {
  const messages = [];
  for (let i = 0; i < said; i++) {
    messages.push({ role: "user" as const, text: `q${i}`, ts: 100 + i * 2 });
    messages.push({ role: "ai" as const, text: `a${i}`, ts: 101 + i * 2 });
  }
  return { cursor: "distilledMessages", id, topicId, label: "Info briefing 2026-09-08", messages };
}

// A book's marks, the other shape a source may register.
function bookMarks(id: string, n: number, topicId = "brief"): SourceUnit {
  return {
    cursor: "distilledMarks",
    id,
    topicId,
    label: "survey.pdf",
    marks: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      page: i,
      text: `passage ${i}`,
      createdAt: 100 + i,
    })),
  };
}

// The cursors a topic's meta.json would answer with.
function cursors(messages: Record<string, number> = {}, marks: Record<string, number> = {}) {
  return () => ({
    messages: (threadId: string) => messages[threadId] ?? 0,
    marks: (bookId: string) => marks[bookId] ?? null,
  });
}

function topic(over: Partial<TopicArrears> = {}): TopicArrears {
  return {
    topicId: "brief",
    topicName: "Brief",
    lastDistilledAt: null,
    units: [],
    ...over,
  };
}

test("a source is registered by kind, and a second registration replaces it", () => {
  register([unit("briefing-2026-09-07", 1)]);
  const first = distillSourceOf("info-thread");
  register([unit("briefing-2026-09-08", 1)]);
  expect(distillSources().filter((s) => s.kind === "info-thread")).toHaveLength(1);
  expect(distillSourceOf("info-thread")).not.toBe(first);
});

test("only a kind the catalogue calls raw material may be registered", () => {
  expect(() =>
    registerDistillSource({
      // A real row, and one with no `distill`: the library is not a transcript.
      kind: "library",
      listUnits: async () => [],
      cursor: "distilledMessages",
      afterEnd: "keep",
    }),
  ).toThrow(/not raw material/);
});

test("a unit owes what the reader said past its own cursor", async () => {
  register([unit("briefing-2026-09-08", 3), unit("2026-09-08:item-9", 1)]);
  const owed = await collectSourceArrears(cursors({ "briefing-2026-09-08": 4 }));
  expect(owed.get("brief")?.map((a) => [a.unit.id, a.owed])).toEqual([
    // Four messages folded in already, so one of the three questions is left.
    ["briefing-2026-09-08", 1],
    ["2026-09-08:item-9", 1],
  ]);
});

test("a unit whose reply is still being written is left out", async () => {
  register([unit("briefing-2026-09-08", 2)]);
  const owed = await collectSourceArrears(cursors(), {
    isBusy: (id) => id === "briefing-2026-09-08",
  });
  expect(owed.size).toBe(0);
});

test("a source that cannot be listed costs the sweep nothing", async () => {
  register(async () => {
    throw new Error("EIO");
  });
  expect(await collectSourceArrears(cursors())).toEqual(new Map());
  expect(await findSourceUnit("briefing-2026-09-08")).toBe(null);
});

test("a unit is found by its thread id, and an unlisted one is not guessed at", async () => {
  register([unit("briefing-2026-09-08", 1)]);
  expect((await findSourceUnit("briefing-2026-09-08"))?.source).toBe("info-thread");
  // "onboarding" is not listed by the info source (its id repeats across days).
  expect(await findSourceUnit("onboarding")).toBe(null);
});

// --- marks are a source's material too ---

test("a book's marks are owed against the timestamp their own map holds", async () => {
  undos.push(
    registerDistillSource({
      kind: "annotations",
      listUnits: async () => [bookMarks("book-1", 5)],
      cursor: "distilledMarks",
      afterEnd: "keep",
    }),
  );
  const fresh = await collectSourceArrears(cursors());
  expect(fresh.get("brief")?.map((a) => [a.unit.id, a.owed])).toEqual([["book-1", 5]]);
  // Two marks folded in already, by the timestamp of the second.
  const some = await collectSourceArrears(cursors({}, { "book-1": 101 }));
  expect(some.get("brief")?.map((a) => [a.unit.id, a.owed])).toEqual([["book-1", 3]]);
});

// --- the sweep's choice ---

test("a topic that owns no book is swept for its conversations", () => {
  const job = selectDistillJob(
    [topic({ units: [{ source: "info-thread", unit: unit("briefing-2026-09-08", 2), owed: 2 }] })],
    NOW,
  );
  expect(job).toMatchObject({ topicId: "brief", source: "info-thread" });
});

test("a unit owing nothing is not a job", () => {
  const job = selectDistillJob(
    [topic({ units: [{ source: "info-thread", unit: unit("briefing-2026-09-08", 2), owed: 0 }] })],
    NOW,
  );
  expect(job).toBe(null);
});

test("the same gap holds a source unit back as holds a book's thread back", () => {
  const arrears = topic({
    lastDistilledAt: NOW - MIN_DISTILL_GAP_MS + 1,
    units: [{ source: "info-thread", unit: unit("briefing-2026-09-08", 2), owed: 2 }],
  });
  expect(selectDistillJob([arrears], NOW)).toBe(null);
  expect(
    selectDistillJob([{ ...arrears, lastDistilledAt: NOW - MIN_DISTILL_GAP_MS }], NOW),
  ).toMatchObject({ source: "info-thread" });
});

test("the most-owed conversation wins, whichever source it came from", () => {
  const reading = {
    source: "reading-thread",
    unit: unit("thread-1", 1, "brief"),
    owed: 1,
  };
  const briefing = { source: "info-thread", unit: unit("briefing-2026-09-08", 3), owed: 3 };
  expect(selectDistillJob([topic({ units: [reading, briefing] })], NOW)).toMatchObject({
    source: "info-thread",
  });
  // A tie is broken on the unit id, so a sweep is reproducible.
  expect(
    selectDistillJob([topic({ units: [reading, { ...briefing, owed: 1 }] })], NOW),
  ).toMatchObject({ source: "info-thread", unit: { id: "briefing-2026-09-08" } });
});
