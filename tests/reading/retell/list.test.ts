// What a topic's Retells list says before you open a retell
// (src/reading/retell/list.ts), and which materials a new retell starts with
// ticked. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  defaultMaterialSelection,
  retellRows,
  retellSummary,
  type MaterialCandidate,
} from "../../../src/reading/retell/list";
import type { Retell, RetellDecision } from "../../../src/reading/retell/types";

function retell(over: Partial<Retell> = {}): Retell {
  return {
    version: 1,
    id: "100",
    name: "A retell",
    topicId: "topic-1",
    materials: [{ bookId: "b1", title: "Eye and Brain" }],
    createdAt: 100,
    updatedAt: 100,
    decisions: [],
    ...over,
  };
}

function decision(chapter: number): RetellDecision {
  return {
    bookId: "b1",
    chapter,
    title: `Chapter ${chapter}`,
    include: true,
    points: [],
    updatedAt: 1,
  };
}

const NO_DECKS: ReadonlyMap<string, string> = new Map();

// The two ends meet on the retell id: the retell file says how far the retell
// got, the deck the caller looked up says whether a deck came out of it.
test("a retell with a deck says so and carries the file to open", () => {
  const [row] = retellRows([retell()], new Map([["100", "slides/100-a-retell.html"]]));
  expect(row.stage).toBe("deck");
  expect(row.deckFile).toBe("slides/100-a-retell.html");
  expect(retellSummary(row)).toBe("1 material · deck ready");
});

test("a retell with no deck is still being prepared", () => {
  const [row] = retellRows([retell({ decisions: [decision(1), decision(2)] })], NO_DECKS);
  expect(row.stage).toBe("preparing");
  expect(row.deckFile).toBeNull();
  expect(retellSummary(row)).toBe("1 material · 2 chapters settled");
});

test("a retell nothing has been settled in says that, not zero", () => {
  const [row] = retellRows([retell()], NO_DECKS);
  expect(retellSummary(row)).toBe("1 material · not started");
});

// A deck built before retells had ids belongs to no retell, so it never reaches the
// map; another retell's deck must not be matched to this one either.
test("a deck under a different id claims nothing", () => {
  const rows = retellRows([retell()], new Map([["999", "slides/999-other.html"]]));
  expect(rows[0].stage).toBe("preparing");
  expect(rows[0].deckFile).toBeNull();
});

// The one being prepared now is the one worked on last, not the one made first.
test("the list is ordered by when each retell was last worked on", () => {
  const rows = retellRows(
    [
      retell({ id: "1", createdAt: 1, updatedAt: 5 }),
      retell({ id: "2", createdAt: 2, updatedAt: 50 }),
      retell({ id: "3", createdAt: 3, updatedAt: 9 }),
    ],
    NO_DECKS,
  );
  expect(rows.map((r) => r.id)).toEqual(["2", "3", "1"]);
});

const candidate = (bookId: string, marks: number): MaterialCandidate => ({
  bookId,
  title: bookId,
  marks,
});

test("a new retell starts with the marked materials ticked", () => {
  expect(
    defaultMaterialSelection([candidate("a", 12), candidate("b", 0), candidate("c", 3)]),
  ).toEqual(["a", "c"]);
});

// An empty dialog would give the reader no way forward.
test("nothing marked in the topic offers everything rather than nothing", () => {
  expect(defaultMaterialSelection([candidate("a", 0), candidate("b", 0)])).toEqual(["a", "b"]);
  expect(defaultMaterialSelection([])).toEqual([]);
});
