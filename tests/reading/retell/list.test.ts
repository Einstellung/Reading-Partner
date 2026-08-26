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

test("a retell says how many chapters it has settled", () => {
  const [row] = retellRows([retell({ decisions: [decision(1), decision(2)] })]);
  expect(row.settled).toBe(2);
  expect(retellSummary(row)).toBe("1 material · 2 chapters settled");
});

test("a retell nothing has been settled in says that, not zero", () => {
  const [row] = retellRows([retell()]);
  expect(retellSummary(row)).toBe("1 material · not started");
});

// The one being prepared now is the one worked on last, not the one made first.
test("the list is ordered by when each retell was last worked on", () => {
  const rows = retellRows(
    [
      retell({ id: "1", createdAt: 1, updatedAt: 5 }),
      retell({ id: "2", createdAt: 2, updatedAt: 50 }),
      retell({ id: "3", createdAt: 3, updatedAt: 9 }),
    ],
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
