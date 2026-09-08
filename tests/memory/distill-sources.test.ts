// The conversations distillation reads that are not a book's (docs/58, docs/61):
// who may register one, what a registered unit owes, and how a unit stands
// against a book's threads when the sweep picks the one job it will run.
//
// Run: bun test tests/memory/distill-sources.test.ts

import { afterEach, expect, test } from "bun:test";
import {
  collectSourceArrears,
  findSourceUnit,
} from "../../src/memory/distill/info-thread";
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
  return { id, topicId, label: "Info briefing 2026-09-08", messages };
}

function topic(over: Partial<TopicArrears> = {}): TopicArrears {
  return {
    topicId: "brief",
    topicName: "Brief",
    lastDistilledAt: null,
    books: [],
    ...over,
  };
}

test("a source is registered by kind, and a second registration replaces it", () => {
  register([unit("briefing-2026-09-07", 1)]);
  expect(distillSources()).toHaveLength(1);
  register([unit("briefing-2026-09-08", 1)]);
  expect(distillSources()).toHaveLength(1);
  expect(distillSourceOf("info-thread")).not.toBe(null);
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
  const owed = await collectSourceArrears((_topicId, unitId) =>
    unitId === "briefing-2026-09-08" ? 4 : 0,
  );
  expect(owed.get("brief")?.map((a) => [a.unit.id, a.newMessages])).toEqual([
    // Four messages folded in already, so one of the three questions is left.
    ["briefing-2026-09-08", 1],
    ["2026-09-08:item-9", 1],
  ]);
});

test("a unit whose reply is still being written is left out", async () => {
  register([unit("briefing-2026-09-08", 2)]);
  const owed = await collectSourceArrears(() => 0, { isBusy: (id) => id === "briefing-2026-09-08" });
  expect(owed.size).toBe(0);
});

test("a source that cannot be listed costs the sweep nothing", async () => {
  register(async () => {
    throw new Error("EIO");
  });
  expect(await collectSourceArrears(() => 0)).toEqual(new Map());
  expect(await findSourceUnit("briefing-2026-09-08")).toBe(null);
});

test("a unit is found by its thread id, and an unlisted one is not guessed at", async () => {
  register([unit("briefing-2026-09-08", 1)]);
  expect((await findSourceUnit("briefing-2026-09-08"))?.source).toBe("info-thread");
  // "onboarding" is not listed by the info source (its id repeats across days).
  expect(await findSourceUnit("onboarding")).toBe(null);
});

// --- the sweep's choice ---

test("a topic that owns no book is swept for its conversations", () => {
  const job = selectDistillJob(
    [topic({ units: [{ source: "info-thread", unit: unit("briefing-2026-09-08", 2), newMessages: 2 }] })],
    NOW,
  );
  expect(job).toMatchObject({ kind: "source", topicId: "brief", source: "info-thread" });
});

test("a unit owing nothing is not a job", () => {
  const job = selectDistillJob(
    [topic({ units: [{ source: "info-thread", unit: unit("briefing-2026-09-08", 2), newMessages: 0 }] })],
    NOW,
  );
  expect(job).toBe(null);
});

test("the same gap holds a source unit back as holds a book's thread back", () => {
  const arrears = topic({
    lastDistilledAt: NOW - MIN_DISTILL_GAP_MS + 1,
    units: [{ source: "info-thread", unit: unit("briefing-2026-09-08", 2), newMessages: 2 }],
  });
  expect(selectDistillJob([arrears], NOW)).toBe(null);
  expect(selectDistillJob([{ ...arrears, lastDistilledAt: NOW - MIN_DISTILL_GAP_MS }], NOW)).toMatchObject({
    kind: "source",
  });
});

test("the most-owed conversation wins, whether it is a book's or a source's", () => {
  const book = {
    bookId: "book-1",
    bookName: "survey.pdf",
    marks: [],
    newMarks: 0,
    threads: [
      {
        threadId: "thread-1",
        annotationId: "",
        page: null,
        markedText: "",
        messages: [{ role: "user" as const, text: "why", ts: 1 }],
        newMessages: 1,
      },
    ],
  };
  const units = [{ source: "info-thread", unit: unit("briefing-2026-09-08", 3), newMessages: 3 }];
  expect(selectDistillJob([topic({ books: [book], units })], NOW)).toMatchObject({ kind: "source" });
  // A tie goes to the book, which is the order that held before sources existed.
  expect(
    selectDistillJob(
      [topic({ books: [book], units: [{ ...units[0], newMessages: 1 }] })],
      NOW,
    ),
  ).toMatchObject({ kind: "thread", thread: { threadId: "thread-1" } });
});
