// What a topic's Talks list says before you open a talk
// (src/reading/talks/list.ts), and which materials a new talk starts with
// ticked. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  defaultMaterialSelection,
  talkRows,
  talkSummary,
  type MaterialCandidate,
} from "../../../src/reading/talks/list";
import type { Talk, TalkDecision } from "../../../src/reading/talks/types";

function talk(over: Partial<Talk> = {}): Talk {
  return {
    version: 1,
    id: "100",
    name: "A talk",
    topicId: "topic-1",
    materials: [{ bookId: "b1", title: "Eye and Brain" }],
    createdAt: 100,
    updatedAt: 100,
    decisions: [],
    ...over,
  };
}

function decision(chapter: number): TalkDecision {
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

// The two ends meet on the talk id: the talk file says how far the rehearsal
// got, the deck the caller looked up says whether a deck came out of it.
test("a talk with a deck says so and carries the file to open", () => {
  const [row] = talkRows([talk()], new Map([["100", "slides/100-a-talk.html"]]));
  expect(row.stage).toBe("deck");
  expect(row.deckFile).toBe("slides/100-a-talk.html");
  expect(talkSummary(row)).toBe("1 material · deck ready");
});

test("a talk with no deck is still being prepared", () => {
  const [row] = talkRows([talk({ decisions: [decision(1), decision(2)] })], NO_DECKS);
  expect(row.stage).toBe("preparing");
  expect(row.deckFile).toBeNull();
  expect(talkSummary(row)).toBe("1 material · 2 chapters settled");
});

test("a talk nothing has been settled in says that, not zero", () => {
  const [row] = talkRows([talk()], NO_DECKS);
  expect(talkSummary(row)).toBe("1 material · not started");
});

// A deck built before talks had ids belongs to no talk, so it never reaches the
// map; another talk's deck must not be matched to this one either.
test("a deck under a different id claims nothing", () => {
  const rows = talkRows([talk()], new Map([["999", "slides/999-other.html"]]));
  expect(rows[0].stage).toBe("preparing");
  expect(rows[0].deckFile).toBeNull();
});

// The one being prepared now is the one worked on last, not the one made first.
test("the list is ordered by when each talk was last worked on", () => {
  const rows = talkRows(
    [
      talk({ id: "1", createdAt: 1, updatedAt: 5 }),
      talk({ id: "2", createdAt: 2, updatedAt: 50 }),
      talk({ id: "3", createdAt: 3, updatedAt: 9 }),
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

test("a new talk starts with the marked materials ticked", () => {
  expect(
    defaultMaterialSelection([candidate("a", 12), candidate("b", 0), candidate("c", 3)]),
  ).toEqual(["a", "c"]);
});

// An empty dialog would give the reader no way forward.
test("nothing marked in the topic offers everything rather than nothing", () => {
  expect(defaultMaterialSelection([candidate("a", 0), candidate("b", 0)])).toEqual(["a", "b"]);
  expect(defaultMaterialSelection([])).toEqual([]);
});
