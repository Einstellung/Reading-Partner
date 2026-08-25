// The talk's settled outline as the deck planner's input (src/reading/slides/
// outline.ts): folding a talk into an outline, the two paths the plan stage can
// take, and what happens to a cut entry and to a kept one the plan forgot.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  applyTalkOutline,
  buildTalkOutline,
  citableWithOutline,
  outlinePlanSystemPrompt,
  outlinePlanUserMessage,
  readerPointsFor,
  type TalkOutline,
} from "../../../src/reading/slides/outline";
import { planUserMessage, validateDeckPlan, type PlanBook } from "../../../src/reading/slides/plan";
import type { DeckPlan } from "../../../src/reading/slides/plan";
import { newTalk } from "../../../src/reading/retell/types";
import type { Talk, TalkDecision } from "../../../src/reading/retell/types";
import { languageInstruction } from "../../../src/platform/app/settings";

function talk(decisions: Partial<TalkDecision>[]): Talk {
  const base = newTalk({
    id: "t1",
    topicId: "topic",
    materials: [
      { bookId: "b1", title: "The Book" },
      { bookId: "b2", title: "Other Book" },
    ],
    now: 1,
  });
  return {
    ...base,
    decisions: decisions.map((d) => ({
      bookId: "b1",
      chapter: 1,
      title: "Chapter",
      include: true,
      points: [],
      updatedAt: 1,
      ...d,
    })),
  };
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

const settled = talk([
  {
    chapter: 1,
    title: "Openings",
    include: true,
    points: ["the 1962 data does the work", "  ", "and nothing else does"],
    figure: "3",
  },
  { chapter: 2, title: "Middlegame", include: false, note: "could not say much" },
  { chapter: 3, title: "Endings", include: true, points: ["it ends where it started"] },
]);

function outline(): TalkOutline {
  return buildTalkOutline(settled)!;
}

function deck(slides: DeckPlan["slides"]): DeckPlan {
  return { title: "A Talk", slides };
}

// The two paths. A talk that has settled nothing leaves the pipeline exactly
// where it was: the model designs the outline from the chapter list and overview.
test("a talk with no decisions means no outline, which is the old plan path", () => {
  expect(buildTalkOutline(null)).toBeNull();
  expect(buildTalkOutline(talk([]))).toBeNull();
});

test("decisions fold into included and cut, keeping the talk's order, empty points dropped", () => {
  const o = outline();
  expect(o.included.map((e) => e.chapter)).toEqual([1, 3]);
  expect(o.included[0].points).toEqual([
    "the 1962 data does the work",
    "and nothing else does",
  ]);
  expect(o.included[0].figure).toBe("3");
  expect(o.included[0].bookTitle).toBe("The Book");
  expect(o.cut).toEqual([
    {
      bookId: "b1",
      bookTitle: "The Book",
      chapter: 2,
      title: "Middlegame",
      note: "could not say much",
    },
  ]);
});

// The talk's order is not chapter order: the reader moved an entry, and the deck
// has to be paged out in the order they will speak.
test("the outline keeps the order the reader arranged, not chapter order", () => {
  const o = buildTalkOutline(
    talk([
      { chapter: 3, title: "Endings" },
      { chapter: 1, title: "Openings" },
    ]),
  )!;
  expect(o.included.map((e) => e.chapter)).toEqual([3, 1]);
  const msg = outlinePlanUserMessage([book], o, "");
  expect(msg.indexOf("chapter 3")).toBeLessThan(msg.indexOf("chapter 1"));
});

test("the plan message carries the reader's points verbatim and names the cuts", () => {
  const msg = outlinePlanUserMessage([book], outline(), "15 minutes for engineers");
  expect(msg).toContain("the 1962 data does the work");
  expect(msg).toContain("CUT — no slide, no mention:");
  expect(msg).toContain("[bookId: b1] chapter 2 — Middlegame — could not say much");
  expect(msg).toContain("15 minutes for engineers");
  expect(msg).toContain("Available figures in \"The Book\"");
  // The old message's job — here is the book, invent an outline — is not this
  // message's job, so the overview is not the through-line any more.
  expect(msg).not.toContain("Whole-book overview");
});

// A talk can hold a material the retell has not reached; that one still gets
// its chapter list and overview to be planned from.
test("a material with no decisions keeps its ordinary block", () => {
  const other: PlanBook = { ...book, bookId: "b2", title: "Other Book" };
  const msg = outlinePlanUserMessage([book, other], outline(), "");
  expect(msg).toContain("=== The talk's settled outline ===");
  expect(msg).toContain('=== Book "Other Book" (bookId: b2) ===');
  expect(msg).toContain("Whole-book overview");
  expect(msg).toContain(planUserMessage([other], "").split("\n\n")[0]);
});

test("the settled-outline prompt takes the output-language instruction like the other one", () => {
  const base = outlinePlanSystemPrompt("auto");
  expect(outlinePlanSystemPrompt("ru")).toBe(`${base}\n\n${languageInstruction("ru")}`);
  expect(outlinePlanSystemPrompt()).toBe(base);
});

// A settled chapter is material whether or not the notes pass ever ran on it:
// the reader's points are what the slide says. Without this the plan validator
// would strip the citation for having no note.
test("a kept chapter with no chapter note is still citable", () => {
  const [checked] = citableWithOutline([book], outline());
  expect(checked.chapters.map((c) => c.hasNote)).toEqual([true, false, true]);
  // Untouched when there is no outline at all.
  expect(citableWithOutline([book], null)[0]).toBe(book);
});

// A material retold off the PDF's own table of contents has decisions against
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
  expect(out.slides[0].planNotice).toContain("Chapter 2 was cut in the retell");
});

test("a chapter with no decision is left out of a settled material's slide", () => {
  const o = buildTalkOutline(talk([{ chapter: 1, title: "Openings", points: ["a"] }]))!;
  const out = applyTalkOutline(
    deck([{ title: "Two", kind: "content", bookId: "b1", sourceChapters: [1, 3] }]),
    o,
  );
  expect(out.slides[0].sourceChapters).toEqual([1]);
  expect(out.slides[0].planNotice).toContain("Chapter 3 has no retell decision");
});

// The chapter numbers of two materials collide, so a decision has to be matched
// on the book as well: chapter 2 of b1 is cut, chapter 2 of b2 was never asked
// about, and one must not answer for the other.
test("a cut chapter of one material does not cut the same number in another", () => {
  const o = buildTalkOutline(
    talk([
      { bookId: "b1", chapter: 2, title: "Middlegame", include: false },
      { bookId: "b2", chapter: 2, title: "Their Middlegame", points: ["theirs"] },
    ]),
  )!;
  const out = applyTalkOutline(
    deck([
      { title: "Mine", kind: "content", bookId: "b1", sourceChapters: [2] },
      { title: "Theirs", kind: "content", bookId: "b2", sourceChapters: [2] },
    ]),
    o,
  );
  expect(out.slides.map((s) => s.title)).toEqual(["Theirs"]);
});

// The other direction: losing an entry the reader decided to talk about is the
// failure this path exists to prevent, so it is repaired rather than reported.
test("a kept entry the plan forgot gets a slide back, before the closing", () => {
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

test("slides for materials the talk settled nothing about pass through untouched", () => {
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
