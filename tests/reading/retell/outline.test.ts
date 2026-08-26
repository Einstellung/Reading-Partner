// The retell's outline (src/reading/retell/outline.ts): laying several materials'
// chapters into the one numbered list the retell walks, translating a
// decision back to the book it is about, and the reader's edits to the order.
// Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  bucketRetellMarks,
  combineChapters,
  combinedSource,
  moveDecision,
  removeDecision,
  setIncluded,
  slotAt,
  slotFor,
  toRetellPlan,
  toRetellDecision,
  upsertDecision,
  type MaterialSkeleton,
} from "../../../src/reading/retell/outline";
import type { Retell, RetellDecision } from "../../../src/reading/retell/types";
import type { PlanDecision, Skeleton } from "../../../src/reading/retell/types";

function skeleton(titles: string[], source: Skeleton["source"] = "notes-plan"): Skeleton {
  return {
    source,
    chapters: titles.map((title, i) => ({
      index: i + 1,
      title,
      startPage: i * 10 + 1,
      endPage: i * 10 + 10,
      hasNote: false,
    })),
  };
}

const oneBook: MaterialSkeleton[] = [
  { bookId: "b1", title: "Eye and Brain", skeleton: skeleton(["Openings", "Middlegame"]) },
];

const twoBooks: MaterialSkeleton[] = [
  ...oneBook,
  { bookId: "b2", title: "Vision", skeleton: skeleton(["Retina"], "outline") },
];

function decision(over: Partial<RetellDecision> = {}): RetellDecision {
  return {
    bookId: "b1",
    chapter: 1,
    title: "Openings",
    include: true,
    points: ["the 1962 data does the work"],
    updatedAt: 100,
    ...over,
  };
}

function retell(over: Partial<Retell> = {}): Retell {
  return {
    version: 1,
    id: "t1",
    name: "A retell",
    topicId: "topic-1",
    materials: [
      { bookId: "b1", title: "Eye and Brain" },
      { bookId: "b2", title: "Vision" },
    ],
    createdAt: 1,
    updatedAt: 2,
    decisions: [],
    ...over,
  };
}

test("one material keeps its own chapter numbers and titles", () => {
  const { chapters, slots } = combineChapters(oneBook);
  expect(chapters.map((c) => c.index)).toEqual([1, 2]);
  expect(chapters.map((c) => c.title)).toEqual(["Openings", "Middlegame"]);
  expect(slots[1]).toMatchObject({ index: 2, bookId: "b1", chapter: 2 });
});

// A numbered list of forty lines has to say which book each one is from, or the
// reader and the model are looking at different chapter 3s.
test("several materials are laid end to end and each line names its book", () => {
  const { chapters, slots } = combineChapters(twoBooks);
  expect(chapters.map((c) => c.index)).toEqual([1, 2, 3]);
  expect(chapters[2].title).toBe("Vision — Retina");
  expect(slotAt(slots, 3)).toMatchObject({ bookId: "b2", chapter: 1 });
  expect(slotFor(slots, "b2", 1)?.index).toBe(3);
});

test("the combined list names the best source its materials have", () => {
  expect(combinedSource(twoBooks)).toBe("notes-plan");
  expect(combinedSource([twoBooks[1]])).toBe("outline");
  expect(combinedSource([])).toBe("whole-book");
});

// One pass over the combined list would file a mark on page 5 of the second
// book under the first book's chapter, because their page ranges overlap.
test("marks are bucketed per material, not across the combined page ranges", () => {
  const { slots } = combineChapters(twoBooks);
  const buckets = bucketRetellMarks(
    [
      { ...twoBooks[0], annotations: [{ page: 1, text: "from the first book" }] },
      { ...twoBooks[1], annotations: [{ page: 5, text: "from the second book" }] },
    ],
    slots,
  );
  expect(buckets.get(1)?.map((m) => m.text)).toEqual(["from the first book"]);
  expect(buckets.get(3)?.map((m) => m.text)).toEqual(["from the second book"]);
});

test("a decision recorded against a combined number comes back as a book's chapter", () => {
  const { slots } = combineChapters(twoBooks);
  const recorded: PlanDecision = {
    chapter: 3,
    title: "Vision — Retina",
    include: true,
    points: ["the ganglion density argument"],
    updatedAt: 5,
  };
  expect(toRetellDecision(slots, recorded)).toMatchObject({
    bookId: "b2",
    chapter: 1,
    // The book's name is on the entry already; the title stays the chapter's.
    title: "Retina",
  });
  expect(toRetellDecision(slots, { ...recorded, chapter: 9 })).toBeNull();
});

test("the record handed to the prompt is in the retell's order, numbered combined", () => {
  const { slots } = combineChapters(twoBooks);
  const t = retell({
    decisions: [decision({ bookId: "b2", chapter: 1, title: "Retina" }), decision()],
  });
  const plan = toRetellPlan(t, slots);
  expect(plan.decisions.map((d) => d.chapter)).toEqual([3, 1]);
});

// A material dropped from the retell leaves its decision on disk; it just has no
// number in this retell any more.
test("a decision whose material is not in the retell is left out of the record", () => {
  const { slots } = combineChapters(oneBook);
  const t = retell({ decisions: [decision({ bookId: "b2", chapter: 1 })] });
  expect(toRetellPlan(t, slots).decisions).toHaveLength(0);
});

test("recording a chapter again replaces it where it already sits", () => {
  const first = decision({ points: ["first take"] });
  const other = decision({ chapter: 2, title: "Middlegame" });
  const list = upsertDecision(upsertDecision([], first), other);
  const next = upsertDecision(list, decision({ points: ["second take"], updatedAt: 200 }));
  expect(next).toHaveLength(2);
  expect(next[0].points).toEqual(["second take"]);
  expect(next[1].chapter).toBe(2);
});

test("a new decision goes on the end, in the order the retell walks", () => {
  const list = upsertDecision([decision()], decision({ chapter: 2, title: "Middlegame" }));
  expect(list.map((d) => d.chapter)).toEqual([1, 2]);
});

test("an entry moves, and a move off either end changes nothing", () => {
  const list = [decision(), decision({ chapter: 2 }), decision({ chapter: 3 })];
  expect(moveDecision(list, 2, -1).map((d) => d.chapter)).toEqual([1, 3, 2]);
  expect(moveDecision(list, 0, -1).map((d) => d.chapter)).toEqual([1, 2, 3]);
  expect(moveDecision(list, 2, 1).map((d) => d.chapter)).toEqual([1, 2, 3]);
  // The input is untouched either way.
  expect(list.map((d) => d.chapter)).toEqual([1, 2, 3]);
});

// Cutting and removing are different: a cut chapter is a settled question the
// model must not ask again, a removed one goes back to being unreached.
test("cutting keeps the entry, removing takes it away", () => {
  const list = [decision(), decision({ chapter: 2 })];
  const cut = setIncluded(list, "b1", 1, false, 500);
  expect(cut[0].include).toBe(false);
  expect(cut[0].updatedAt).toBe(500);
  expect(cut).toHaveLength(2);
  expect(removeDecision(list, "b1", 1).map((d) => d.chapter)).toEqual([2]);
  // The same book's chapter, not another book's with the same number.
  expect(removeDecision(list, "b2", 1)).toHaveLength(2);
});

test("cutting a chapter that has no entry changes nothing", () => {
  const list = [decision()];
  expect(setIncluded(list, "b1", 9, false, 500)).toEqual(list);
});
