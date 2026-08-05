// The rehearsal system prompt (src/reading/rehearsal/prompt.ts): that the
// instructions say the things the mode depends on, and that the material sections
// track what the budget ladder left in. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildRehearsalSystemPrompt,
  REHEARSAL_INSTRUCTIONS,
  type RehearsalContext,
} from "../../../src/reading/rehearsal/prompt";
import { bucketMarks } from "../../../src/reading/rehearsal/marks";
import { createPlan, upsertDecision } from "../../../src/reading/rehearsal/plan";
import type { Skeleton } from "../../../src/reading/rehearsal/types";

const skeleton: Skeleton = {
  source: "notes-plan",
  chapters: [
    { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: true },
    { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
  ],
};

function ctx(over: Partial<RehearsalContext> = {}): RehearsalContext {
  return {
    topicName: "Chess",
    bookName: "book.pdf",
    pageLabel: "12",
    skeleton,
    marks: bucketMarks(skeleton.chapters, [{ page: 4, text: "the 1962 data" }]),
    notes: [],
    plan: null,
    hasReadingTools: true,
    ...over,
  };
}

// Every one of these is a step in the slide the mode exists to prevent: the AI
// summarises the chapter, asks whether that sounds right, accepts "yes", and the
// reader has heard a good talk instead of given one.
test("the instructions forbid the moves that would make the mode useless", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("never say for them");
  expect(REHEARSAL_INSTRUCTIONS).toContain("No summary of a chapter before they have spoken");
  expect(REHEARSAL_INSTRUCTIONS).toContain('Never ask "why did you highlight this"');
  expect(REHEARSAL_INSTRUCTIONS).toContain("One question, two at most");
});

test("the instructions say what to do with a thin answer: name the gap, then teach", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("Say which part is missing or wrong");
  expect(REHEARSAL_INSTRUCTIONS).toContain("walk that stretch through once");
  expect(REHEARSAL_INSTRUCTIONS).toContain("Do not re-ask the same question");
});

test("the one time the highlights may be raised is the whole-chapter one", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("densely marked");
  expect(REHEARSAL_INSTRUCTIONS).toContain("about the whole chapter rather than any");
});

test("recording comes after the exchange, not before it", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("After a chapter's exchange, and only after");
  expect(REHEARSAL_INSTRUCTIONS).toContain("do not record before they have spoken");
});

test("the prompt carries the skeleton, the record and the marks", () => {
  const text = buildRehearsalSystemPrompt(ctx());
  expect(text).toContain("1. Openings — pp.1-10, 1 highlight, chapter note on file");
  expect(text).toContain("nothing recorded yet");
  expect(text).toContain('"the 1962 data"');
  expect(text).toContain("record_chapter_decision");
  expect(text).toContain("read_chapter_note(chapter)");
  expect(text).toContain("read_pages(from, to)");
});

// The reading position is where they stopped reading, not where the rehearsal
// is; conflating the two restarts the rehearsal at whatever page is open.
test("the reading position is labelled as not being the rehearsal's position", () => {
  const text = buildRehearsalSystemPrompt(ctx());
  expect(text).toContain("open at page 12");
  expect(text).toContain("not where the rehearsal is");
  expect(text).toContain("where they stopped");
  expect(buildRehearsalSystemPrompt(ctx({ pageLabel: null }))).not.toContain("open at page");
});

test("a recorded decision moves the prompt on to the next chapter", () => {
  const plan = upsertDecision(createPlan("book", 1), {
    chapter: 1,
    title: "Openings",
    include: true,
    points: ["the 1962 data does the work"],
    updatedAt: 2,
  });
  const text = buildRehearsalSystemPrompt(ctx({ plan }));
  expect(text).toContain("Chapter 1. Openings — in the talk");
  expect(text).toContain("Next up: chapter 2");
});

test("a chapter note is inlined as background, flagged as not being their answer", () => {
  const text = buildRehearsalSystemPrompt(
    ctx({ notes: [{ chapter: 1, title: "Openings", body: "The chapter argues X." }] }),
  );
  expect(text).toContain("--- Chapter 1. Openings ---");
  expect(text).toContain("The chapter argues X.");
  expect(text).toContain("do not accept them as their");
});

// The claim has to track what was actually put in front of the model: a prompt
// that says the marks are all there while they are shortened invents the rest.
test("shortened marks say so, and point at the tool that gets them back", () => {
  const full = buildRehearsalSystemPrompt(ctx());
  expect(full).toContain("What the reader marked, by chapter:");
  const tight = buildRehearsalSystemPrompt(ctx({ fullMarks: false }));
  expect(tight).toContain("shortened to fit");
  expect(tight).toContain("read_annotations");
});

test("a book with no reading tools does not claim to have them", () => {
  const text = buildRehearsalSystemPrompt(ctx({ hasReadingTools: false }));
  expect(text).not.toContain("read_pages(from, to)");
  expect(text).toContain("record_chapter_decision");
});
