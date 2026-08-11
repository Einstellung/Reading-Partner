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
import type { RehearsalPlan, Skeleton } from "../../../src/reading/rehearsal/types";

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

// The observations tell the AI where this reader broke down last time, which is
// the strongest pull there is towards teaching the chapter instead of examining
// it. The four rules that put them to work are each checked here.
test("the opening hands the reader their trail back rather than reading it out", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("handing the reader their own trail");
  expect(REHEARSAL_INSTRUCTIONS).toContain("where they got stuck, whether");
  expect(REHEARSAL_INSTRUCTIONS).toContain("never the observations read out as a list");
});

test("a stuck-point outranks a question invented from the chapter", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("Where the chapter's first question comes from");
  expect(REHEARSAL_INSTRUCTIONS).toContain("never heard them use it afterwards");
  expect(REHEARSAL_INSTRUCTIONS).toContain("An understanding that was never");
});

// A chapter they already failed to give out loud beats one they merely got stuck
// reading — and naming the failure back to them is how a rehearsal turns into an
// apology instead of a question.
test("a cannot-explain outranks the stuck-point, and is not read back to the reader", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("A cannot-explain observation about this chapter");
  expect(REHEARSAL_INSTRUCTIONS).toContain("Do not tell them it happened");
});

test("what was observed of the reader sets the level, and absence assumes nothing", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("puts this reader in a field");
  expect(REHEARSAL_INSTRUCTIONS).toContain("skip the groundwork");
  expect(REHEARSAL_INSTRUCTIONS).toContain("assume no background and say it plainly");
  // The correction rule itself lives with the observations (observation/
  // snapshot.ts); what the rehearsal adds is that it must not become the subject.
  expect(REHEARSAL_INSTRUCTIONS).toContain("go straight back to the chapter");
});

// Knowing where they got stuck says what to ask, not what to explain. Getting
// this backwards puts the answer in front of the reader before the question.
test("knowing where they got stuck does not license explaining it", () => {
  expect(REHEARSAL_INSTRUCTIONS).toContain("This binds hardest where you know");
  expect(REHEARSAL_INSTRUCTIONS).toContain("never what to explain first");
  expect(REHEARSAL_INSTRUCTIONS).toContain("Ask, and open the book only once");
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
  const plan: RehearsalPlan = {
    version: 1,
    createdAt: 1,
    updatedAt: 2,
    decisions: [
      {
        chapter: 1,
        title: "Openings",
        include: true,
        points: ["the 1962 data does the work"],
        updatedAt: 2,
      },
    ],
  };
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
