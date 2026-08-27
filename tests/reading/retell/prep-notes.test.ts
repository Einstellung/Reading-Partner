// Which of a retell's materials' prep notes ride in the prompt
// (src/reading/retell/prep-notes.ts): one budget across every material, a paper
// too big for what is left passed over rather than ending the list, and the
// retell's chapter re-resolved into the prep run's own chapter table. Pure.
// Run: bun test.

import { expect, test } from "bun:test";
import { estimateTextTokens } from "../../../src/budget";
import {
  CLASSROOM_NOTE_BUDGET,
  classroomNoteCost,
} from "../../../src/reading/prep/papers/classroom";
import type { PrepPaper, PrepState } from "../../../src/reading/prep/papers/types";
import {
  retellPrepStatus,
  selectRetellPrepNotes,
  type PreppedMaterial,
} from "../../../src/reading/retell/prep-notes";

function paper(slug: string, chapters: number[], over: Partial<PrepPaper> = {}): PrepPaper {
  return {
    slug,
    title: slug,
    authors: [],
    year: null,
    arxivId: null,
    citedInChapters: chapters,
    reason: "",
    status: "done",
    ...over,
  };
}

// A body of roughly `tokens` tokens, so a test can say what will and will not fit.
function body(tokens: number): string {
  const one = "the latent imagination argument ";
  const per = estimateTextTokens(one);
  return one.repeat(Math.max(1, Math.round(tokens / per)));
}

function material(
  bookId: string,
  papers: PrepPaper[],
  bodies: Record<string, string>,
  chapters = [
    { index: 1, title: "One", startPage: 1 },
    { index: 2, title: "Two", startPage: 11 },
    { index: 3, title: "Three", startPage: 21 },
  ],
): PreppedMaterial {
  const prep: PrepState = {
    version: 1,
    surveyHash: bookId,
    surveyName: bookId,
    createdAt: 0,
    planStatus: "done",
    chapters,
    references: [],
    papers,
  };
  return {
    bookId,
    title: bookId,
    prep,
    prepNotes: papers.map((p) => ({ slug: p.slug, title: p.title, body: bodies[p.slug] ?? "x" })),
  };
}

const slugs = (notes: { slug: string }[]) => notes.map((n) => n.slug);

test("one budget is spent across the materials, in the retell's order", () => {
  const big = body(CLASSROOM_NOTE_BUDGET * 0.6);
  const first = material("b1", [paper("a", [1])], { a: big });
  const second = material("b2", [paper("b", [1]), paper("c", [1])], { b: big, c: body(100) });
  // b1 takes 60% of the cap, so b2's own 60% note no longer fits and the small
  // one behind it still does.
  expect(slugs(selectRetellPrepNotes([first, second], null))).toEqual(["a", "c"]);
  // Reversed, the same budget lands on the other material's big note.
  expect(slugs(selectRetellPrepNotes([second, first], null))).toEqual(["b", "c"]);
});

test("a note too big for what is left is passed over, not the end of the list", () => {
  const m = material("b1", [paper("huge", [1]), paper("small", [1])], {
    huge: body(CLASSROOM_NOTE_BUDGET * 2),
    small: body(100),
  });
  expect(slugs(selectRetellPrepNotes([m], null))).toEqual(["small"]);
});

test("a material with no prep run contributes nothing and costs nothing", () => {
  const bare: PreppedMaterial = { bookId: "b0", title: "b0", prep: null, prepNotes: [] };
  const m = material("b1", [paper("a", [1])], { a: body(100) });
  expect(slugs(selectRetellPrepNotes([bare, m], null))).toEqual(["a"]);
  expect(selectRetellPrepNotes([bare], null)).toEqual([]);
  expect(retellPrepStatus([bare], new Set())).toBe("");
});

// The retell's chapter list is not the prep run's: the retell walks a combined
// numbering over several materials, the prep run indexed its papers against the
// table its plan call produced. The page is what carries between the two.
test("the retell's next chapter reaches the prep run as one of its own chapters", () => {
  const papers = [paper("ch1", [1]), paper("ch3", [3])];
  const bodies = { ch1: body(100), ch3: body(100) };
  const m = material("b1", papers, bodies);
  // Room for exactly one of the two, so the order is the whole answer.
  const fits = classroomNoteCost(m.prepNotes[0]);
  // Page 21 is the prep run's chapter 3, so its citation comes first.
  expect(slugs(selectRetellPrepNotes([m], { bookId: "b1", startPage: 21 }, fits))).toEqual(["ch3"]);
  expect(slugs(selectRetellPrepNotes([m], { bookId: "b1", startPage: 1 }, fits))).toEqual(["ch1"]);
  // A focus in another material orders this one from its first chapter.
  expect(slugs(selectRetellPrepNotes([m], { bookId: "b2", startPage: 21 }, fits))).toEqual(["ch1"]);
});

// The same paper prepped under two materials is the same text; printing it twice
// buys it twice out of one budget.
test("a paper nominated by two materials is carried once", () => {
  const first = material("b1", [paper("shared", [1])], { shared: body(100) });
  const second = material("b2", [paper("shared", [1]), paper("own", [1])], {
    shared: body(100),
    own: body(100),
  });
  expect(slugs(selectRetellPrepNotes([first, second], null))).toEqual(["shared", "own"]);
});

test("one material's prep list stands alone; several get a heading each", () => {
  const first = material("b1", [paper("a", [1])], { a: body(10) });
  const second = material("b2", [paper("b", [1])], { b: body(10) });
  const one = retellPrepStatus([first], new Set(["a"]));
  expect(one).toContain("- a — a [note below]");
  expect(one).not.toContain('In "b1":');
  const two = retellPrepStatus([first, second], new Set(["a"]));
  expect(two).toContain('In "b1":');
  expect(two).toContain('In "b2":');
  // What is not in this turn's context says how to fetch it.
  expect(two).toContain('read_note("b")');
});
