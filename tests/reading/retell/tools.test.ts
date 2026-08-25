// The retell's two agent tools (src/reading/retell/tools.ts): what
// record_chapter_decision writes, what it raises in the conversation, and what
// both tools say when the model asks for a chapter that does not exist.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildRetellTools } from "../../../src/reading/retell/tools";
import type { RetellDecisionCardData } from "../../../src/reading/retell/cards";
import { PLAN_VERSION } from "../../../src/reading/retell/types";
import type {
  RetellChapter,
  PlanDecision,
  RetellPlan,
} from "../../../src/reading/retell/types";

const chapters: RetellChapter[] = [
  { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: true },
  { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
];

function harness(notes: Record<number, string> = {}) {
  const recorded: PlanDecision[] = [];
  const cards: RetellDecisionCardData[] = [];
  // Stands in for the retell: what record writes is what readPlan hands back, so
  // read_retell_outline is tested against decisions made in the same run. Appended
  // rather than sorted, because the retell keeps the order it recorded in.
  let plan: RetellPlan | null = null;
  const tools = buildRetellTools({
    chapters,
    record: async (d) => {
      recorded.push(d);
      plan = {
        version: PLAN_VERSION,
        createdAt: plan?.createdAt ?? d.updatedAt,
        updatedAt: d.updatedAt,
        decisions: [...(plan?.decisions ?? []).filter((x) => x.chapter !== d.chapter), d],
      };
    },
    readNote: async (n) => notes[n] ?? null,
    readPlan: async () => plan,
    onCard: (c) => cards.push(c),
    now: () => 4242,
  });
  const byName = (name: string) => tools.find((t) => t.name === name)!;
  return { recorded, cards, byName };
}

test("a decision is written with the chapter's own title and stamped", async () => {
  const h = harness();
  await h.byName("record_chapter_decision").execute({
    chapter: 1,
    include: true,
    points: ["the 1962 data does the work", "  ", ""],
  });
  expect(h.recorded).toEqual([
    {
      chapter: 1,
      title: "Openings",
      include: true,
      points: ["the 1962 data does the work"],
      updatedAt: 4242,
    },
  ]);
});

// The card is the reader's receipt: the same content, minus the timestamp.
test("the decision raises a card carrying what was written", async () => {
  const h = harness();
  await h.byName("record_chapter_decision").execute({
    chapter: 2,
    include: false,
    points: [],
    note: "nothing to say about it",
  });
  expect(h.cards).toEqual([
    {
      kind: "retell-decision",
      chapter: 2,
      title: "Middlegame",
      include: false,
      points: [],
      note: "nothing to say about it",
    },
  ]);
});

test("blank optional fields are left out rather than stored empty", async () => {
  const h = harness();
  await h.byName("record_chapter_decision").execute({
    chapter: 1,
    include: true,
    points: ["one"],
    figure: "   ",
    note: "",
  });
  expect("figure" in h.recorded[0]).toBe(false);
  expect("note" in h.recorded[0]).toBe(false);
});

test("a figure reference rides along", async () => {
  const h = harness();
  await h.byName("record_chapter_decision").execute({
    chapter: 1,
    include: true,
    points: ["one"],
    figure: "[fig:3]",
  });
  expect(h.recorded[0].figure).toBe("[fig:3]");
});

test("a chapter that does not exist writes nothing and lists the ones that do", async () => {
  const h = harness();
  const out = await h.byName("record_chapter_decision").execute({
    chapter: 9,
    include: true,
    points: ["one"],
  });
  expect(h.recorded).toHaveLength(0);
  expect(h.cards).toHaveLength(0);
  expect(String(out)).toContain("1. Openings");
});

test("the reply says which way the decision went", async () => {
  const h = harness();
  const kept = await h.byName("record_chapter_decision").execute({ chapter: 1, include: true, points: ["a"] });
  const cut = await h.byName("record_chapter_decision").execute({ chapter: 2, include: false, points: [] });
  expect(String(kept)).toContain("going in the retell");
  expect(String(cut)).toContain("cut from the retell");
});

test("read_chapter_note returns the note, or says there is none", async () => {
  const h = harness({ 1: "The chapter argues X." });
  expect(await h.byName("read_chapter_note").execute({ chapter: 1 })).toBe("The chapter argues X.");
  expect(String(await h.byName("read_chapter_note").execute({ chapter: 2 }))).toContain(
    "No note on file for chapter 2",
  );
  expect(String(await h.byName("read_chapter_note").execute({ chapter: 9 }))).toContain(
    "No chapter 9",
  );
});

test("read_retell_outline reads the outline back, including the chapter just recorded", async () => {
  const h = harness();
  // Before anything is settled there is no outline, and saying so is the answer.
  expect(String(await h.byName("read_retell_outline").execute({}))).toContain(
    "No chapter has been settled yet",
  );

  await h.byName("record_chapter_decision").execute({
    chapter: 1,
    include: true,
    points: ["the 1962 data does the work"],
    figure: "fig:2",
  });
  await h.byName("record_chapter_decision").execute({
    chapter: 2,
    include: false,
    points: [],
    note: "could not say anything about it",
  });

  const out = String(await h.byName("read_retell_outline").execute({}));
  expect(out).toContain("1. Openings");
  expect(out).toContain("the 1962 data does the work");
  expect(out).toContain("figure: fig:2");
  expect(out).toContain("Cut:");
  expect(out).toContain("could not say anything about it");
});

test("read_retell_outline is read-only: it records nothing and raises no card", async () => {
  const h = harness();
  await h.byName("record_chapter_decision").execute({ chapter: 1, include: true, points: ["a"] });
  const before = h.recorded.length;
  await h.byName("read_retell_outline").execute({});
  expect(h.recorded.length).toBe(before);
  expect(h.cards.length).toBe(1);
});
