// Unit tests for the slides plan parser (src/reading/slides/plan.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  parseSlidePlan,
  planUserMessage,
  slidesPlanSystemPrompt,
  validateDeckPlan,
  type PlanBook,
} from "../../../src/reading/slides/plan";
import { languageInstruction } from "../../../src/platform/app/settings";

// Against languageInstruction rather than a retyped copy of its wording: a
// reworded directive should not be a test edit, and `not.toContain` on a
// hand-copied fragment goes quietly vacuous the moment the wording moves.
test("slidesPlanSystemPrompt appends the output-language instruction only when set", () => {
  const base = slidesPlanSystemPrompt("auto");
  expect(slidesPlanSystemPrompt("ru")).toBe(`${base}\n\n${languageInstruction("ru")}`);
  expect(slidesPlanSystemPrompt()).toBe(base);
});

test("parseSlidePlan reads title, kinds, provenance, and asset slots", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "My Talk",
      slides: [
        { title: "Opening", kind: "title" },
        { title: "The core idea", kind: "content", bookId: "b1", sourceChapters: [1, 2] },
        { title: "A picture", kind: "content", bookId: "b1", illustration: { prompt: "a bridge" } },
        { title: "The data", kind: "content", bookId: "b1", figure: { bookId: "b1", figId: "3" } },
        { title: "Wrap", kind: "closing" },
      ],
    }),
  );
  expect(deck.title).toBe("My Talk");
  expect(deck.slides.map((s) => s.kind)).toEqual(["title", "content", "content", "content", "closing"]);
  expect(deck.slides[1]).toMatchObject({ bookId: "b1", sourceChapters: [1, 2] });
  expect(deck.slides[2].illustration).toEqual({ prompt: "a bridge" });
  expect(deck.slides[3].figure).toEqual({ bookId: "b1", figId: "3" });
});

test("parseSlidePlan tolerates fences and preamble", () => {
  const deck = parseSlidePlan('Here you go:\n```json\n{"title":"T","slides":[{"title":"S","kind":"section"}]}\n```');
  expect(deck.title).toBe("T");
  expect(deck.slides).toHaveLength(1);
});

test("parseSlidePlan defaults an unknown kind to content and drops a bodyless content slide", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "T",
      slides: [
        { title: "Real", kind: "weird" },
        { kind: "content" }, // no title -> dropped
      ],
    }),
  );
  expect(deck.slides).toHaveLength(1);
  expect(deck.slides[0].kind).toBe("content");
});

test("parseSlidePlan lower-cases figIds and inherits bookId from the slide", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "T",
      slides: [{ title: "S", kind: "content", bookId: "b9", figure: { figId: "4B" } }],
    }),
  );
  expect(deck.slides[0].figure).toEqual({ bookId: "b9", figId: "4b" });
});

test("parseSlidePlan keeps at most one asset slot (figure wins)", () => {
  const deck = parseSlidePlan(
    JSON.stringify({
      title: "T",
      slides: [
        {
          title: "S",
          kind: "content",
          bookId: "b1",
          illustration: { prompt: "x" },
          figure: { figId: "2" },
        },
      ],
    }),
  );
  expect(deck.slides[0].figure).toBeDefined();
  expect(deck.slides[0].illustration).toBeUndefined();
});

test("parseSlidePlan throws on an empty deck", () => {
  expect(() => parseSlidePlan(JSON.stringify({ title: "T", slides: [] }))).toThrow();
  expect(() => parseSlidePlan("not json")).toThrow();
});

// --- the plan message and its validation ------------------------------------

const BOOK: PlanBook = {
  bookId: "b1",
  title: "Book One",
  overview: "the overview",
  chapters: [
    { index: 1, title: "Beginnings", startPage: 1, endPage: 20, hasNote: true, digest: "opens with" },
    { index: 2, title: "The middle", startPage: 21, endPage: 40, hasNote: true },
    { index: 3, title: "Unread", startPage: 41, endPage: 60, hasNote: false },
  ],
  figures: [{ id: "1", caption: "Fig 1: a plot" }],
};

test("planUserMessage gives the planner the chapter list, not just the overview", () => {
  const msg = planUserMessage([BOOK], "a talk for engineers");
  expect(msg).toContain("Book One");
  expect(msg).toContain("bookId: b1");
  expect(msg).toContain("the overview");
  expect(msg).toContain("1. Beginnings (pp.1-20) [note]");
  expect(msg).toContain("3. Unread (pp.41-60) [no note]");
  expect(msg).toContain("1: Fig 1: a plot");
  expect(msg).toContain("a talk for engineers");
});

test("planUserMessage works for a book with no overview yet", () => {
  const msg = planUserMessage([{ ...BOOK, overview: "" }], "");
  expect(msg).toContain("1. Beginnings");
  expect(msg).toContain("No specific talk instruction");
});

test("validateDeckPlan keeps citations that exist and reports the ones that do not", () => {
  const out = validateDeckPlan(
    {
      title: "T",
      slides: [
        { title: "Good", kind: "content", bookId: "b1", sourceChapters: [1, 2] },
        { title: "Half", kind: "content", bookId: "b1", sourceChapters: [2, 9] },
      ],
    },
    [BOOK],
  );
  expect(out.slides[0].sourceChapters).toEqual([1, 2]);
  expect(out.slides[0].planNotice).toBeUndefined();
  expect(out.slides[1].sourceChapters).toEqual([2]);
  expect(out.slides[1].planNotice).toContain("Chapter 9 does not exist");
});

test("validateDeckPlan drops a chapter with no note and says the slide fell back", () => {
  const out = validateDeckPlan(
    { title: "T", slides: [{ title: "S", kind: "content", bookId: "b1", sourceChapters: [3] }] },
    [BOOK],
  );
  expect(out.slides[0].sourceChapters).toBeUndefined();
  expect(out.slides[0].planNotice).toContain("Chapter 3 has no note");
  expect(out.slides[0].planNotice).toContain("book overview");
});

test("validateDeckPlan drops an invented figure id at plan time", () => {
  const out = validateDeckPlan(
    {
      title: "T",
      slides: [{ title: "S", kind: "content", bookId: "b1", figure: { bookId: "b1", figId: "7" } }],
    },
    [BOOK],
  );
  expect(out.slides[0].figure).toBeUndefined();
  expect(out.slides[0].planNotice).toContain('Figure "7" is not in "Book One"');
});

test("validateDeckPlan drops an unknown book id", () => {
  const out = validateDeckPlan(
    { title: "T", slides: [{ title: "S", kind: "content", bookId: "nope", sourceChapters: [1] }] },
    [BOOK],
  );
  expect(out.slides[0].bookId).toBeUndefined();
  expect(out.slides[0].sourceChapters).toBeUndefined();
  expect(out.slides[0].planNotice).toContain("Unknown book id");
});

test("validateDeckPlan leaves a multi-book deck alone", () => {
  const other: PlanBook = { ...BOOK, bookId: "b2", title: "Book Two" };
  const out = validateDeckPlan(
    {
      title: "T",
      slides: [
        { title: "One", kind: "content", bookId: "b1", sourceChapters: [1] },
        { title: "Two", kind: "content", bookId: "b2", sourceChapters: [2] },
        { title: "Both", kind: "content" },
      ],
    },
    [BOOK, other],
  );
  expect(out.slides.map((s) => s.planNotice)).toEqual([undefined, undefined, undefined]);
  expect(out.slides[1].sourceChapters).toEqual([2]);
});

