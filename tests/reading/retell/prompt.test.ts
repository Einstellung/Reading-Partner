// The retell system prompt (src/reading/retell/prompt.ts): that the
// instructions say the things the mode depends on, and that the material sections
// track what the budget ladder left in. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildRetellSystemPrompt,
  RETELL_INSTRUCTIONS,
  type RetellContext,
} from "../../../src/reading/retell/prompt";
import { bucketMarks } from "../../../src/reading/retell/marks";
import type { RetellPlan, Skeleton } from "../../../src/reading/retell/types";

const skeleton: Skeleton = {
  source: "notes-plan",
  chapters: [
    { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: true },
    { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
  ],
};

function ctx(over: Partial<RetellContext> = {}): RetellContext {
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
  expect(RETELL_INSTRUCTIONS).toContain("never say for them");
  expect(RETELL_INSTRUCTIONS).toContain("No summary of a chapter before they have spoken");
  expect(RETELL_INSTRUCTIONS).toContain('Never ask "why did you highlight this"');
  expect(RETELL_INSTRUCTIONS).toContain("One question, two at most");
});

// A quoted citation renders as a block only when it stands alone; mid-sentence
// it degrades to a chip and the reader never sees the page. The rule has to say
// so, or the replies come back as bare [p.N].
test("the citation rule says a quote stands alone, and what it costs when it does not", () => {
  expect(RETELL_INSTRUCTIONS).toContain("[p.N]");
  expect(RETELL_INSTRUCTIONS).toMatch(/as its own paragraph/);
  expect(RETELL_INSTRUCTIONS).toMatch(/not inside a sentence/);
  expect(RETELL_INSTRUCTIONS).toMatch(/collapses to a\s+small chip/);
  expect(RETELL_INSTRUCTIONS).toMatch(/verbatim/);
  expect(RETELL_INSTRUCTIONS).toContain("200 characters");
});

// The observations tell the AI where this reader broke down last time, which is
// the strongest pull there is towards teaching the chapter instead of examining
// it. The four rules that put them to work are each checked here.
test("the opening hands the reader their trail back rather than reading it out", () => {
  expect(RETELL_INSTRUCTIONS).toContain("handing the reader their own trail");
  expect(RETELL_INSTRUCTIONS).toContain("where they got stuck, whether");
  expect(RETELL_INSTRUCTIONS).toContain("never the observations read out as a list");
});

test("a stuck-point outranks a question invented from the chapter", () => {
  expect(RETELL_INSTRUCTIONS).toContain("Where the chapter's first question comes from");
  expect(RETELL_INSTRUCTIONS).toContain("never heard them use it afterwards");
  expect(RETELL_INSTRUCTIONS).toContain("An understanding that was never");
});

// A chapter they already failed to give out loud beats one they merely got stuck
// reading — and naming the failure back to them is how a retell turns into an
// apology instead of a question.
test("a cannot-explain outranks the stuck-point, and is not read back to the reader", () => {
  expect(RETELL_INSTRUCTIONS).toContain("A cannot-explain observation about this chapter");
  expect(RETELL_INSTRUCTIONS).toContain("Do not tell them it happened");
});

test("what was observed of the reader sets the level, and absence assumes nothing", () => {
  expect(RETELL_INSTRUCTIONS).toContain("puts this reader in a field");
  expect(RETELL_INSTRUCTIONS).toContain("skip the groundwork");
  expect(RETELL_INSTRUCTIONS).toContain("assume no background and say it plainly");
  // The correction rule itself lives with the observations (observation/
  // snapshot.ts); what the retell adds is that it must not become the subject.
  expect(RETELL_INSTRUCTIONS).toContain("go straight back to the chapter");
});

// Knowing where they got stuck says what to ask, not what to explain. Getting
// this backwards puts the answer in front of the reader before the question.
test("knowing where they got stuck does not license explaining it", () => {
  expect(RETELL_INSTRUCTIONS).toContain("This binds hardest where you know");
  expect(RETELL_INSTRUCTIONS).toContain("never what to explain first");
  expect(RETELL_INSTRUCTIONS).toContain("Ask, and open the book only once");
});

test("the instructions say what to do with a thin answer: name the gap, then teach", () => {
  expect(RETELL_INSTRUCTIONS).toContain("Say which part is missing or wrong");
  expect(RETELL_INSTRUCTIONS).toContain("walk that stretch through once");
  expect(RETELL_INSTRUCTIONS).toContain("Do not re-ask the same question");
});

test("the one time the highlights may be raised is the whole-chapter one", () => {
  expect(RETELL_INSTRUCTIONS).toContain("densely marked");
  expect(RETELL_INSTRUCTIONS).toContain("about the whole chapter rather than any");
});

test("recording comes after the exchange, not before it", () => {
  expect(RETELL_INSTRUCTIONS).toContain("After a chapter's exchange, and only after");
  expect(RETELL_INSTRUCTIONS).toContain("do not record before they have spoken");
});

test("the prompt carries the skeleton, the record and the marks", () => {
  const text = buildRetellSystemPrompt(ctx());
  expect(text).toContain("1. Openings — pp.1-10, 1 highlight, chapter note on file");
  expect(text).toContain("nothing recorded yet");
  expect(text).toContain('"the 1962 data"');
  expect(text).toContain("record_chapter_decision");
  expect(text).toContain("read_chapter_note(chapter)");
  expect(text).toContain("read_pages(from, to)");
});

// The reading position is where they stopped reading, not where the retell
// is; conflating the two restarts the retell at whatever page is open.
test("the reading position is labelled as not being the retell's position", () => {
  const text = buildRetellSystemPrompt(ctx());
  expect(text).toContain("open at page 12");
  expect(text).toContain("not where the retell is");
  expect(text).toContain("where they stopped");
  expect(buildRetellSystemPrompt(ctx({ pageLabel: null }))).not.toContain("open at page");
});

test("a recorded decision moves the prompt on to the next chapter", () => {
  const plan: RetellPlan = {
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
  const text = buildRetellSystemPrompt(ctx({ plan }));
  expect(text).toContain("Chapter 1. Openings — in the talk");
  expect(text).toContain("Next up: chapter 2");
});

test("a chapter note is inlined as background, flagged as not being their answer", () => {
  const text = buildRetellSystemPrompt(
    ctx({ notes: [{ chapter: 1, title: "Openings", body: "The chapter argues X." }] }),
  );
  expect(text).toContain("--- Chapter 1. Openings ---");
  expect(text).toContain("The chapter argues X.");
  expect(text).toContain("do not accept them as their");
});

// The claim has to track what was actually put in front of the model: a prompt
// that says the marks are all there while they are shortened invents the rest.
test("shortened marks say so, and point at the tool that gets them back", () => {
  const full = buildRetellSystemPrompt(ctx());
  expect(full).toContain("What the reader marked, by chapter:");
  const tight = buildRetellSystemPrompt(ctx({ fullMarks: false }));
  expect(tight).toContain("shortened to fit");
  expect(tight).toContain("read_annotations");
});

test("a book with no reading tools does not claim to have them", () => {
  const text = buildRetellSystemPrompt(ctx({ hasReadingTools: false }));
  expect(text).not.toContain("read_pages(from, to)");
  expect(text).toContain("record_chapter_decision");
});
