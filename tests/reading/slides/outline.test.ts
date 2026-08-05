// The rehearsal outline as the deck planner's input (src/reading/slides/
// outline.ts): folding decision files into a talk outline, the two paths the
// plan stage can take, and what happens to a cut chapter and to a kept one the
// plan forgot. Run: bun test.

import { expect, test } from "bun:test";
import {
  applyTalkOutline,
  buildTalkOutline,
  citableWithOutline,
  outlinePlanSystemPrompt,
  outlinePlanUserMessage,
  readerPointsFor,
  type OutlineSource,
  type TalkOutline,
} from "../../../src/reading/slides/outline";
import { planUserMessage, validateDeckPlan, type PlanBook } from "../../../src/reading/slides/plan";
import type { DeckPlan } from "../../../src/reading/slides/plan";
import { createPlan, upsertDecision } from "../../../src/reading/rehearsal/plan";
import type { RehearsalDecision, RehearsalPlan } from "../../../src/reading/rehearsal/types";
import { languageInstruction } from "../../../src/platform/app/settings";

function decisions(bookId: string, list: Partial<RehearsalDecision>[]): RehearsalPlan {
  let plan = createPlan(bookId, 1);
  for (const d of list) {
    plan = upsertDecision(plan, {
      chapter: 1,
      title: "Chapter",
      include: true,
      points: [],
      updatedAt: 1,
      ...d,
    });
  }
  return plan;
}

const book: PlanBook = {
  bookId: "b1",
  title: "The Book",
  overview: "It argues X.",
  chapters: [
    { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: true },
    { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
    { index: 3, title: "Endings", startPage: 21, endPage: 30, hasNote: false },
  ],
  figures: [{ id: "3", caption: "The 1962 series" }],
};

const rehearsed: OutlineSource[] = [
  {
    bookId: "b1",
    title: "The Book",
    plan: decisions("b1", [
      {
        chapter: 1,
        title: "Openings",
        include: true,
        points: ["the 1962 data does the work", "  ", "and nothing else does"],
        figure: "3",
      },
      { chapter: 2, title: "Middlegame", include: false, points: [], note: "could not say much" },
      { chapter: 3, title: "Endings", include: true, points: ["it ends where it started"] },
    ]),
  },
];

function outline(): TalkOutline {
  return buildTalkOutline(rehearsed)!;
}

function deck(slides: DeckPlan["slides"]): DeckPlan {
  return { title: "A Talk", slides };
}

// The two paths. A book nobody rehearsed leaves the pipeline exactly where it
// was: the model designs the outline from the chapter list and the overview.
test("no decision file anywhere means no outline, which is the old plan path", () => {
  expect(buildTalkOutline([{ bookId: "b1", title: "The Book", plan: null }])).toBeNull();
  expect(
    buildTalkOutline([{ bookId: "b1", title: "The Book", plan: createPlan("b1", 1) }]),
  ).toBeNull();
});

test("decisions fold into included and cut, in chapter order, empty points dropped", () => {
  const o = outline();
  expect(o.books).toHaveLength(1);
  expect(o.books[0].included.map((e) => e.chapter)).toEqual([1, 3]);
  expect(o.books[0].included[0].points).toEqual([
    "the 1962 data does the work",
    "and nothing else does",
  ]);
  expect(o.books[0].included[0].figure).toBe("3");
  expect(o.books[0].cut).toEqual([
    { chapter: 2, title: "Middlegame", note: "could not say much" },
  ]);
});

test("the plan message carries the reader's points verbatim and names the cuts", () => {
  const msg = outlinePlanUserMessage([book], outline(), "15 minutes for engineers");
  expect(msg).toContain("the 1962 data does the work");
  expect(msg).toContain("Chapters CUT — no slide, no mention:");
  expect(msg).toContain("2. Middlegame — could not say much");
  expect(msg).toContain("15 minutes for engineers");
  // The old message's job — here is the book, invent an outline — is not this
  // message's job, so the overview is not the through-line any more.
  expect(msg).not.toContain("Whole-book overview");
});

// A talk can mix a rehearsed book with one that was never rehearsed; the second
// still gets its chapter list and overview to be planned from.
test("a book without decisions keeps its ordinary block inside a mixed talk", () => {
  const other: PlanBook = { ...book, bookId: "b2", title: "Other Book" };
  const msg = outlinePlanUserMessage([book, other], outline(), "");
  expect(msg).toContain('=== Book "The Book" (bookId: b1) — settled outline ===');
  expect(msg).toContain('=== Book "Other Book" (bookId: b2) ===');
  expect(msg).toContain("Whole-book overview");
  expect(msg).toContain(planUserMessage([other], "").split("\n\n")[0]);
});

test("the settled-outline prompt takes the output-language instruction like the other one", () => {
  const base = outlinePlanSystemPrompt("auto");
  expect(outlinePlanSystemPrompt("ru")).toBe(`${base}\n\n${languageInstruction("ru")}`);
  expect(outlinePlanSystemPrompt()).toBe(base);
});

// A rehearsed chapter is material whether or not the notes pass ever ran on it:
// the reader's points are what the slide says. Without this the plan validator
// would strip the citation for having no note.
test("a kept chapter with no chapter note is still citable", () => {
  const [checked] = citableWithOutline([book], outline());
  expect(checked.chapters.map((c) => c.hasNote)).toEqual([true, false, true]);
  // Untouched when there is no outline at all.
  expect(citableWithOutline([book], null)[0]).toBe(book);
});

// A book rehearsed off the PDF's own table of contents has decisions against
// chapters no notes plan ever enumerated; validation must not call them invented.
test("a kept chapter the notes pass never enumerated is added to the chapter list", () => {
  const bare: PlanBook = { ...book, chapters: [], overview: "" };
  const [checked] = citableWithOutline([bare], outline());
  expect(checked.chapters.map((c) => c.index)).toEqual([1, 3]);
  expect(checked.chapters.map((c) => c.title)).toEqual(["Openings", "Endings"]);
  expect(checked.chapters.every((c) => c.hasNote)).toBe(true);
  const out = validateDeckPlan(
    deck([{ title: "Openings", kind: "content", bookId: "b1", sourceChapters: [1] }]),
    [checked],
  );
  expect(out.slides[0].sourceChapters).toEqual([1]);
  expect(out.slides[0].planNotice).toBeUndefined();
});

test("a slide for a cut chapter does not survive", () => {
  const out = applyTalkOutline(
    deck([
      { title: "Open", kind: "title" },
      { title: "Openings", kind: "content", bookId: "b1", sourceChapters: [1] },
      { title: "Middlegame", kind: "content", bookId: "b1", sourceChapters: [2] },
      { title: "Endings", kind: "content", bookId: "b1", sourceChapters: [3] },
      { title: "Wrap", kind: "closing" },
    ]),
    outline(),
  );
  expect(out.slides.map((s) => s.title)).toEqual(["Open", "Openings", "Endings", "Wrap"]);
});

test("a cut chapter cited alongside a kept one is stripped, and the slide says so", () => {
  const out = applyTalkOutline(
    deck([{ title: "Both", kind: "content", bookId: "b1", sourceChapters: [1, 2] }]),
    outline(),
  );
  expect(out.slides[0].sourceChapters).toEqual([1]);
  expect(out.slides[0].planNotice).toContain("Chapter 2 was cut in the rehearsal");
});

test("a chapter with no decision is left out of a rehearsed book's slide", () => {
  const o = buildTalkOutline([
    {
      bookId: "b1",
      title: "The Book",
      plan: decisions("b1", [{ chapter: 1, title: "Openings", include: true, points: ["a"] }]),
    },
  ])!;
  const out = applyTalkOutline(
    deck([{ title: "Two", kind: "content", bookId: "b1", sourceChapters: [1, 3] }]),
    o,
  );
  expect(out.slides[0].sourceChapters).toEqual([1]);
  expect(out.slides[0].planNotice).toContain("Chapter 3 has no rehearsal decision");
});

// The other direction: losing a chapter the reader decided to talk about is the
// failure this path exists to prevent, so it is repaired rather than reported.
test("a kept chapter the plan forgot gets a slide back, before the closing", () => {
  const out = applyTalkOutline(
    deck([
      { title: "Open", kind: "title" },
      { title: "Openings", kind: "content", bookId: "b1", sourceChapters: [1] },
      { title: "Wrap", kind: "closing" },
    ]),
    outline(),
  );
  expect(out.slides.map((s) => s.title)).toEqual(["Open", "Openings", "Endings", "Wrap"]);
  expect(out.slides[2]).toMatchObject({ bookId: "b1", sourceChapters: [3], kind: "content" });
  expect(out.slides[2].planNotice).toContain("added back");
});

test("slides for books nobody rehearsed pass through untouched", () => {
  const slide = { title: "Other", kind: "content" as const, bookId: "b2", sourceChapters: [7] };
  const out = applyTalkOutline(deck([slide, { title: "Wrap", kind: "closing" }]), outline());
  expect(out.slides[0]).toBe(slide);
});

// The whole point of keeping the plan stage out of the wording: what the reader
// said arrives at the content stage as the same string they said it in.
test("the reader's points reach a slide verbatim, by the chapters it cites", () => {
  expect(readerPointsFor(outline(), { bookId: "b1", sourceChapters: [1, 3] })).toEqual([
    "the 1962 data does the work",
    "and nothing else does",
    "it ends where it started",
  ]);
  expect(readerPointsFor(outline(), { bookId: "b1", sourceChapters: [2] })).toEqual([]);
  expect(readerPointsFor(outline(), { bookId: "b1" })).toEqual([]);
  expect(readerPointsFor(outline(), { bookId: "b2", sourceChapters: [1] })).toEqual([]);
  expect(readerPointsFor(null, { bookId: "b1", sourceChapters: [1] })).toEqual([]);
});
