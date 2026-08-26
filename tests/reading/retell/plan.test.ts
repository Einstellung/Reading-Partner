// How the record of a retell reads to the model at the top of a turn
// (src/reading/retell/plan.ts). Where the record is kept and in what order is
// the retell's (tests/reading/retell/outline.test.ts); this is the read-back.
// Run: bun test.

import { expect, test } from "bun:test";
import { formatOutline, formatPlan, nextChapter } from "../../../src/reading/retell/plan";
import type {
  RetellChapter,
  PlanDecision,
  RetellPlan,
} from "../../../src/reading/retell/types";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";

const chapters: RetellChapter[] = [
  { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: false },
  { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
  { index: 3, title: "Endings", startPage: 21, endPage: 30, hasNote: false },
];

function decision(over: Partial<PlanDecision> = {}): PlanDecision {
  return {
    chapter: 1,
    title: "Openings",
    include: true,
    points: ["the argument rests on the 1962 data"],
    updatedAt: 100,
    ...over,
  };
}

function plan(...decisions: PlanDecision[]): RetellPlan {
  return { version: 1, createdAt: 1, updatedAt: 100, decisions };
}

function talk(): TalkOutline {
  return newTalkOutline({ id: "o1", topicId: "topic-1", retellId: "t1", now: 1 });
}

// Not "the last one plus one": the reader may jump around, and the gap is what
// is actually still unconsumed. Not a queue either — nothing is handed this to
// the model; the turn uses it to pick which chapter note to inline.
test("the next chapter is the lowest one with no decision", () => {
  expect(nextChapter(chapters, null)).toBe(1);
  expect(nextChapter(chapters, plan(decision({ chapter: 2, title: "Middlegame" })))).toBe(1);
  expect(
    nextChapter(chapters, plan(decision({ chapter: 2, title: "Middlegame" }), decision())),
  ).toBe(3);
  expect(
    nextChapter(
      chapters,
      plan(
        decision(),
        decision({ chapter: 2, title: "Middlegame" }),
        decision({ chapter: 3, title: "Endings" }),
      ),
    ),
  ).toBeNull();
});

// The stage is read off the talk, not off the chapters: a talk with no
// through-line is a retell whose reader has not yet given the whole thing back.
test("a talk with no through-line reads as a retell still at its opening", () => {
  const text = formatPlan(chapters, null, null);
  expect(text).toContain("no through-line yet");
  expect(text).toContain("this is the opening");
  expect(text).toContain("from memory");
  // The stage writes as it goes; an empty record that only said "nothing is
  // settled" is what left fifty-one messages with nothing written.
  expect(text).toContain("onto the spine as they come");
});

// The record only knows what was written, so the turn right after the opening
// still has no spine; without this the model asks for the one-minute version
// twice.
test("an empty talk also says not to redo an opening that already happened", () => {
  expect(formatPlan(chapters, null, null)).toContain("do not do it again");
});

// The whole reason the record was rewritten: a "next up" line marched the reader
// through the chapters whatever they had just asked for.
test("the record never tells the model which chapter is next", () => {
  const text = formatPlan(
    chapters,
    plan(decision(), decision({ chapter: 2, title: "Middlegame", include: false, points: [] })),
    null,
  );
  expect(text.toLowerCase()).not.toContain("next");
  expect(text.toLowerCase()).not.toContain("pick up");
  expect(text).toContain("Not a queue");
});

test("the chapters read as an audit: what the talk took, what was cut, what is untouched", () => {
  const text = formatPlan(
    chapters,
    plan(
      decision({ figure: "[fig:3]", note: "thin on evidence" }),
      decision({ chapter: 2, title: "Middlegame", include: false, points: [] }),
    ),
    null,
  );
  expect(text).toContain("1. Openings — in the talk");
  expect(text).toContain("the argument rests on the 1962 data");
  expect(text).toContain("figure: [fig:3]");
  expect(text).toContain("note: thin on evidence");
  expect(text).toContain("2. Middlegame — cut");
  expect(text).toContain("Untouched: 3. Endings.");
});

// The record is read in the order the retell holds it, not sorted back into
// chapter order: the reader may have moved an entry, and the model has to see
// the retell as it now stands.
test("the record keeps the order it was given in", () => {
  const text = formatPlan(
    chapters,
    plan(decision({ chapter: 3, title: "Endings" }), decision({ chapter: 1 })),
    null,
  );
  expect(text.indexOf("3. Endings —")).toBeLessThan(text.indexOf("1. Openings —"));
});

// A spine with no block under it is as likely to be the macro pass's own draft
// as a finished backbone, and the record cannot tell which: it prints what is
// written and leaves the stage to the conversation.
test("a through-line with no block yet reads as the macro pass's draft", () => {
  const outline = setSpine(
    talk(),
    { thesis: "Vision is inference, not measurement", audience: "second-year students" },
    2,
  );
  const text = formatPlan(chapters, null, outline);
  expect(text).not.toContain("no through-line yet");
  expect(text).toContain("Through-line: Vision is inference, not measurement");
  expect(text).toContain("Audience: second-year students");
  expect(text).toContain("No block of the note is written yet.");
  expect(text).toContain("This spine is what the macro pass has banked so far.");
  expect(text).toContain("you are still in the macro pass");
});

// A block exists for a rib exactly when the reader has given that rib, so the
// note is the progress record and nothing else has to be tracked.
test("a rib with a block reads as given, one without as not given yet", () => {
  let outline = setSpine(
    talk(),
    {
      thesis: "Vision is inference",
      backbone: ["The retina throws most of it away", "Depth is a guess two eyes make"],
    },
    2,
  );
  outline = putSegment(
    outline,
    { body: "## The retina throws most of it away\n\nblind spot, filled in" },
    3,
  );
  const text = formatPlan(chapters, null, outline);
  expect(text).toContain("1. The retina throws most of it away — given (block 1)");
  expect(text).toContain("2. Depth is a guess two eyes make — not given yet");
  expect(text).toContain("The note — 1 block(s)");
  expect(text).toContain("1. The retina throws most of it away");
});

// The reader writes in Chinese, where a rib is often two ideographs — as much
// signal as an English word of four letters, and the only reason the floor on a
// containment match is counted in columns rather than characters.
test("a short Chinese rib still finds the block headed with it", () => {
  const rib = "\u5806\u5757";
  let outline = setSpine(talk(), { thesis: "t", backbone: [rib, "\u63a8\u7406"] }, 2);
  outline = putSegment(outline, { body: `## ${rib}\uff1a\u53e0\u51e0\u5341\u5c42\n\nresidual, layernorm` }, 3);
  const text = formatPlan(chapters, null, outline);
  expect(text).toContain(`1. ${rib} \u2014 given (block 1)`);
  expect(text).toContain("2. \u63a8\u7406 \u2014 not given yet");
});

// formatOutline is what read_retell_outline reads back to the reader, so unlike
// formatPlan it is the chapter view and carries no instruction about what to do
// next.
test("formatOutline lists what is in, what was cut, and what is not settled", () => {
  const text = formatOutline(
    chapters,
    plan(
      decision({ chapter: 1, points: ["p one", "p two"], figure: "fig:3" }),
      decision({ chapter: 2, title: "Middlegame", include: false, points: [], note: "thin" }),
    ),
  );
  expect(text).toContain("1 chapter(s), 2 point(s)");
  expect(text).toContain("p one");
  expect(text).toContain("figure: fig:3");
  expect(text).toContain("2. Middlegame — thin");
  expect(text).toContain("Not settled yet: 3. Endings.");
  expect(text).not.toContain("Next up");
});

test("formatOutline says there is no outline before the first decision", () => {
  expect(formatOutline(chapters, null)).toContain("No chapter has been settled yet");
  expect(formatOutline(chapters, plan())).toContain("No chapter has been settled yet");
});

test("formatOutline does not claim a retell when every settled chapter was cut", () => {
  const text = formatOutline(chapters, plan(decision({ chapter: 1, include: false, points: [] })));
  expect(text).toContain("Nothing is in the retell yet");
  expect(text).toContain("Cut:");
});

// The outline is read in the order the retell holds it, like formatPlan: a reader
// who moved an entry has to hear their retell in the order it will be given.
test("formatOutline keeps the order the retell holds", () => {
  const text = formatOutline(
    chapters,
    plan(decision({ chapter: 3, title: "Endings" }), decision({ chapter: 1 })),
  );
  expect(text.indexOf("3. Endings")).toBeLessThan(text.indexOf("1. Openings"));
});
