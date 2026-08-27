// The retell system prompt (src/reading/retell/prompt.ts): that the
// instructions say the things the mode depends on, and that the material sections
// track what the budget ladder left in. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildRetellSystemPrompt,
  MACRO_INSTRUCTIONS,
  RETELL_INSTRUCTIONS,
  RIB_INSTRUCTIONS,
  type RetellContext,
} from "../../../src/reading/retell/prompt";
import { bucketMarks } from "../../../src/reading/retell/marks";
import type { RetellPlan, Skeleton } from "../../../src/reading/retell/types";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import { newTalkOutline } from "../../../src/reading/talk/types";

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
// reader has heard a good retell instead of given one.
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
  expect(RETELL_INSTRUCTIONS).toContain("hand the reader their own trail");
  expect(RETELL_INSTRUCTIONS).toContain("where they got stuck, whether");
  expect(RETELL_INSTRUCTIONS).toContain("never the observations read out as a list");
});

test("a stuck-point outranks a question invented from the chapter", () => {
  expect(RETELL_INSTRUCTIONS).toContain("Where the first question of a stretch comes from");
  expect(RETELL_INSTRUCTIONS).toContain("never heard them use it afterwards");
  expect(RETELL_INSTRUCTIONS).toContain("An understanding that was never");
});

// A chapter they already failed to give out loud beats one they merely got stuck
// reading — and naming the failure back to them is how a retell turns into an
// apology instead of a question.
test("a cannot-explain outranks the stuck-point, and is not read back to the reader", () => {
  expect(RETELL_INSTRUCTIONS).toContain("A cannot-explain observation covering that stretch");
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

// The reader gives the whole thing before the AI does: a spine they nodded at is
// a spine they never had to produce.
test("the opening asks for the whole thing and withholds the spine", () => {
  expect(RETELL_INSTRUCTIONS).toContain("end to end, in their own words, from memory");
  expect(RETELL_INSTRUCTIONS).toContain("may not give the");
  expect(RETELL_INSTRUCTIONS).toContain("may not name the parts");
  expect(RETELL_INSTRUCTIONS).toContain("nodding at your spine");
});

// Which stage the retell is in comes off the talk, not off how many chapters
// have been dispositioned — and not off the spine's existence either, since the
// macro pass banks a draft of it as it goes.
test("the stage is read off the talk's state, and there are three of them", () => {
  expect(RETELL_INSTRUCTIONS).toContain("Three stages");
  expect(RETELL_INSTRUCTIONS).toContain("the talk's state, not any");
  expect(RETELL_INSTRUCTIONS).toContain("Nothing on the spine");
  expect(RETELL_INSTRUCTIONS).toContain("named back in order, unaided: the ribs");
});

// A retell runs over several sittings. In the one this rule comes from the chain
// was asked for once, at the very start, and never again — after that every
// question was about one stretch. Reopening on a backbone tests the whole thing
// first, with nothing in front of the reader.
test("a sitting that reopens on a backbone opens on the whole chain, unaided", () => {
  expect(RETELL_INSTRUCTIONS).toContain(
    "A sitting that opens with a backbone already on the spine",
  );
  expect(RETELL_INSTRUCTIONS).toContain("book shut, notes shut");
  expect(RETELL_INSTRUCTIONS).toContain("blocks unread");
  expect(RETELL_INSTRUCTIONS).toContain("do not name a rib");
  expect(RETELL_INSTRUCTIONS).toContain("which rib went missing");
  // The comparison is the question source; with no spine the old opening stands.
  expect(RETELL_INSTRUCTIONS).toContain("where this sitting's questions come from");
  expect(RETELL_INSTRUCTIONS).toContain("stage one is the opening");
});

// The question that asks what breaks another way is meant to come back empty;
// the wrong-question rule would have thrown it out, and swapping it for one they
// can answer is how the whole retell slid into process questions.
test("the failure-mode question is exempt from changing the question, and nothing else", () => {
  expect(RETELL_INSTRUCTIONS).toContain("One kind of question is exempt");
  expect(RETELL_INSTRUCTIONS).toContain("do not trade it for an easier one");
  expect(RETELL_INSTRUCTIONS).toContain("Everything above still binds");
  expect(RETELL_INSTRUCTIONS).toContain("no counting");
  expect(RETELL_INSTRUCTIONS).toContain("never that question re-issued in");
  // The exemption may not hollow out the rules it sits next to.
  expect(RETELL_INSTRUCTIONS).toContain("Never count the times you have asked");
  expect(RETELL_INSTRUCTIONS).toContain("never say you are");
  expect(RETELL_INSTRUCTIONS).toContain("never call it avoidance");
});

// The chapter march is what the record used to force. The instructions have to
// say the chapters are not the order of the work, and that a run of them can be
// closed at once.
test("chapters are an index and an audit, and a run of them closes in one go", () => {
  expect(RETELL_INSTRUCTIONS).toContain("The chapters are an index and an audit, not a queue");
  expect(RETELL_INSTRUCTIONS).toContain("Never walk them in order");
  expect(RETELL_INSTRUCTIONS).toContain("is closed in one go");
  expect(RETELL_INSTRUCTIONS).toContain("are you dropping fine-tuning?");
  expect(RETELL_INSTRUCTIONS).toContain("when a rib has consumed a chapter");
  // A decision is still the outcome of an exchange, never a plan for one.
  expect(RETELL_INSTRUCTIONS).toContain("the outcome of an exchange, not a plan for one");
});

// The macro stage writes the spine and nothing else, and only once the reader
// can give the parts back unaided.
test("the macro stage ends with the reader naming the parts, then writes the spine", () => {
  expect(MACRO_INSTRUCTIONS).toContain("name the parts in order, unaided");
  expect(MACRO_INSTRUCTIONS).toContain("they have to give it back");
  expect(MACRO_INSTRUCTIONS).toContain("set_talk_spine");
  expect(MACRO_INSTRUCTIONS).toContain("reader's words rather than yours");
  expect(MACRO_INSTRUCTIONS).toContain("no block of the note goes in here");
});

// A block written for a rib the reader never gave breaks the one thing the note
// is: the record of how far the retell has got.
test("a block is written only after the reader has given that rib", () => {
  expect(RIB_INSTRUCTIONS).toContain("The reader speaks first, every time");
  expect(RIB_INSTRUCTIONS).toContain("Only then write the block");
  expect(RIB_INSTRUCTIONS).toContain("Never write a block for a rib the reader has not given");
  expect(RIB_INSTRUCTIONS).toContain("Head the block with the rib it gives");
  expect(RIB_INSTRUCTIONS).toContain("A block is not a chapter");
});

// Giving the process back is what a reader can do from memory alone. The rib is
// not through until they can say what the step is for, and the only test of that
// is what would go wrong without it.
test("a rib is through only once the reader can say what breaks another way", () => {
  expect(RIB_INSTRUCTIONS).toContain("The process is the way in, not the pass");
  expect(RIB_INSTRUCTIONS).toContain("what breaks if that step were done another way");
  expect(RIB_INSTRUCTIONS).toContain("has to say what goes wrong without it");
  expect(RIB_INSTRUCTIONS).toContain("memorised the step, not understood it");
});

// Asking the reader to sign off the wording bought five interruptions and five
// "fine, go ahead": a reader mid-way through learning something is not thinking
// about the wording of a note.
test("the block is written without the reader approving the wording", () => {
  expect(RIB_INSTRUCTIONS).toContain("Do not read the block out for approval first");
  expect(RIB_INSTRUCTIONS).not.toContain("Say the block in a line before you write it");
  // What must survive that: a block is only ever written out of what they said.
  expect(RIB_INSTRUCTIONS).toContain("Never write a block for a rib the reader has not given");
});

// The note stays the only progress record, and now it carries both states: the
// process goes in when it comes back, the failure mode into the same block.
test("the failure mode is written back into the block the process went into", () => {
  expect(RIB_INSTRUCTIONS).toContain("write that same block again with a line for it");
  expect(RIB_INSTRUCTIONS).toContain("rather than opening a second block");
  expect(RIB_INSTRUCTIONS).toContain("A block with no such line is a");
});

test("the rib order comes from where the macro pass showed holes", () => {
  expect(RIB_INSTRUCTIONS).toContain("wherever the macro pass showed a hole");
  expect(RIB_INSTRUCTIONS).toContain("not chapter order");
});

test("the prompt carries the skeleton, the record and the marks", () => {
  const text = buildRetellSystemPrompt(ctx());
  expect(text).toContain("1. Openings — pp.1-10, 1 highlight, chapter note on file");
  expect(text).toContain("no through-line yet");
  expect(text).toContain('"the 1962 data"');
  expect(text).toContain("record_chapter_decision");
  expect(text).toContain("read_chapter_note(chapter)");
  expect(text).toContain("read_pages(from, to)");
});

// The talk's tools are mounted from the first turn, so the prompt has to name
// them from the first turn too.
test("the talk's tools are listed whether or not there is a spine yet", () => {
  const text = buildRetellSystemPrompt(ctx());
  expect(text).toContain("set_talk_spine");
  expect(text).toContain("write_talk_segment");
  expect(text).toContain("move_talk_segment");
  expect(text).toContain("remove_talk_segment");
  expect(text).toContain("read_talk_outline()");
});

// Nothing written means nothing to inline: the record already says the talk is
// empty, and a second paragraph saying so is prompt spent for nothing.
test("an empty talk is not inlined a second time", () => {
  const empty = newTalkOutline({ id: "o1", topicId: "t", now: 1 });
  expect(buildRetellSystemPrompt(ctx({ talkOutline: empty }))).not.toContain(
    "The talk: nothing arranged yet",
  );
});

// Once there is a note, the bodies and the ids go in whole: a rewrite has to
// send the block back, and the id is the only handle for one.
test("a talk with blocks is inlined whole, with its ids", () => {
  let outline = setSpine(
    newTalkOutline({ id: "o1", topicId: "t", now: 1 }),
    { thesis: "Vision is inference", backbone: ["The retina throws most of it away"] },
    2,
  );
  outline = putSegment(outline, { id: "s1", body: "## The retina throws most of it away" }, 3);
  const text = buildRetellSystemPrompt(ctx({ talkOutline: outline }));
  expect(text).toContain("Through-line: Vision is inference");
  expect(text).toContain("given (block 1)");
  expect(text).toContain("id: s1");
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

// A recorded decision is an audit line. It used to be a pointer, and the pointer
// marched the reader through the chapters whatever they had asked for.
test("a recorded decision reads as an audit line, not as where to go next", () => {
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
  expect(text).toContain("1. Openings — in the talk");
  expect(text).toContain("Untouched: 2. Middlegame.");
  expect(text).not.toContain("Next up");
});

// The papers the material leans on. Both blocks or neither, and both above the
// record: they do not change during a sitting and the record does, so anything
// volatile above them would be paid for again on every turn.
test("the papers' notes and the prep list ride above the record, with a citation rule", () => {
  const text = buildRetellSystemPrompt(
    ctx({
      prepNotes: "Prep notes on this document's references, in full:\n\n--- wm: World Models ---\nA latent dream.",
      prepStatus: "The prep list —\n- wm — World Models [note below]",
      hasPrepTools: true,
    }),
  );
  expect(text).toContain("--- wm: World Models ---");
  expect(text).toContain("- wm — World Models [note below]");
  expect(text).toContain("cite it as [paper-slug p.N]");
  expect(text).toContain("read_note(slug)");
  expect(text.indexOf("--- wm: World Models ---")).toBeLessThan(text.indexOf("no through-line yet"));
  // The reader has no book open in a retell, so nothing here may promise a jump
  // (RetellView provides a null CitationContext).
  expect(text).not.toContain("clickable link");
});

test("with no prep run behind any material, neither block leaves a trace", () => {
  const text = buildRetellSystemPrompt(ctx());
  expect(text).not.toContain("paper-slug");
  expect(text).not.toContain("prep list");
  expect(text).not.toContain("read_note(slug)");
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
