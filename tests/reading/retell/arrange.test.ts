// The arrangement tools (src/reading/retell/arrange.ts): when the stage opens,
// what each tool writes to the talk outline, what it raises in the conversation,
// and the two things that would quietly corrupt a talk — a positional segment id
// and a freshly drafted segment recorded as ready.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  buildArrangeTools,
  formatTalkOutline,
  isArranging,
  materialLabel,
  segmentStatusLabel,
  toTalkMaterial,
} from "../../../src/reading/retell/arrange";
import type { TalkArrangementCardData } from "../../../src/reading/retell/cards";
import { PLAN_VERSION } from "../../../src/reading/retell/types";
import type { RetellChapter, RetellPlan } from "../../../src/reading/retell/types";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";

const last = (cards: TalkArrangementCardData[]) => cards[cards.length - 1];

const chapters: RetellChapter[] = [
  { index: 1, title: "Openings", startPage: 1, endPage: 10, hasNote: true },
  { index: 2, title: "Middlegame", startPage: 11, endPage: 20, hasNote: false },
];

function plan(...settled: number[]): RetellPlan {
  return {
    version: PLAN_VERSION,
    createdAt: 1,
    updatedAt: 1,
    decisions: settled.map((chapter) => ({
      chapter,
      title: `Chapter ${chapter}`,
      include: true,
      points: [],
      updatedAt: 1,
    })),
  };
}

function harness() {
  let outline: TalkOutline | null = null;
  const cards: TalkArrangementCardData[] = [];
  const tools = buildArrangeTools({
    readOutline: async () => outline,
    // The store's find-or-create, in memory: the outline is made by the first
    // write, not by the stage opening.
    editOutline: async (change) => {
      outline = change(
        outline ?? newTalkOutline({ id: "o1", topicId: "topic-1", retellId: "r1", now: 1 }),
      );
      return outline;
    },
    onCard: (c) => cards.push(c),
    now: () => 42,
  });
  return {
    get outline() {
      return outline;
    },
    cards,
    byName: (name: string) => tools.find((t) => t.name === name)!,
  };
}

test("the arrangement opens only when every chapter has a decision", () => {
  expect(isArranging(chapters, null)).toBe(false);
  expect(isArranging(chapters, plan(1))).toBe(false);
  expect(isArranging(chapters, plan(1, 2))).toBe(true);
  // Not "all settled" — a retell that has not started.
  expect(isArranging([], null)).toBe(false);
});

test("the spine writes only the fields it was sent", async () => {
  const h = harness();
  await h.byName("set_talk_spine").execute({
    thesis: "The eye throws most of it away",
    audience: "people who have never taken a vision course",
  });
  await h.byName("set_talk_spine").execute({ conventions: ["no English acronyms", "  "] });
  expect(h.outline?.spine).toEqual({
    thesis: "The eye throws most of it away",
    audience: "people who have never taken a vision course",
    backbone: [],
    conventions: ["no English acronyms"],
    excluded: [],
  });
  expect(last(h.cards)).toEqual({
    kind: "talk-arrangement",
    change: "spine",
    spine: h.outline!.spine,
  });
});

test("a spine call with nothing in it writes nothing", async () => {
  const h = harness();
  const out = String(await h.byName("set_talk_spine").execute({}));
  expect(out).toContain("No field was given");
  expect(h.outline).toBeNull();
});

// docs/44: a segment that has been drafted and never said out loud is shallow.
// Writing it well is not what makes it ready; giving it is.
test("a new segment is minted with a random id and lands shallow", async () => {
  const h = harness();
  const out = String(
    await h.byName("write_talk_segment").execute({
      title: "The opening",
      cues: ["ask them what they think the retina sends"],
    }),
  );
  expect(out).toContain("Added segment 1 of 1");
  const segment = h.outline!.segments[0];
  expect(segment.status).toBe("shallow");
  // Not the position: two devices adding a segment in the same place must not
  // mint the same id (platform/sync/merge/records.ts).
  expect(segment.id).not.toBe("0");
  expect(segment.id).not.toBe("1");
  expect(segment.id.length).toBeGreaterThan(8);
  expect(h.cards).toEqual([
    {
      kind: "talk-arrangement",
      change: "segment",
      segment: { id: segment.id, title: "The opening", cues: segment.cues, material: [], status: "shallow" },
      position: 1,
      total: 1,
    },
  ]);
});

test("two segments added at the same position get different ids", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ title: "First", position: 1 });
  await h.byName("write_talk_segment").execute({ title: "Second", position: 1 });
  const [a, b] = h.outline!.segments;
  expect(a.title).toBe("Second");
  expect(b.title).toBe("First");
  expect(a.id).not.toBe(b.id);
});

test("material is kept whole: a tag becomes a figure id, TeX is stored verbatim", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({
    title: "The cost",
    material: [
      { kind: "figure", ref: "[fig:4B] the ganglion map" },
      { kind: "figure", ref: "a photo of the optic disc" },
      { kind: "tex", ref: "\\sum_{i=1}^{n} w_i x_i \\ge \\theta" },
    ],
  });
  expect(h.outline!.segments[0].material).toEqual([
    { kind: "figure", figId: "4b", description: "the ganglion map" },
    { kind: "figure", description: "a photo of the optic disc" },
    { kind: "tex", tex: "\\sum_{i=1}^{n} w_i x_i \\ge \\theta" },
  ]);
});

test("writing a segment by id changes what was sent and leaves the rest", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ title: "Draft", cues: ["one", "two"] });
  const id = h.outline!.segments[0].id;
  const out = String(
    await h.byName("write_talk_segment").execute({ id, status: "ready", act: "Act one" }),
  );
  expect(out).toContain("Rewrote segment 1 of 1");
  expect(h.outline!.segments[0]).toMatchObject({
    id,
    title: "Draft",
    cues: ["one", "two"],
    act: "Act one",
    status: "ready",
  });
});

test("a segment moves to a 1-based position, and an unknown id says so", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ title: "A" });
  await h.byName("write_talk_segment").execute({ title: "B" });
  await h.byName("write_talk_segment").execute({ title: "C" });
  const c = h.outline!.segments[2].id;
  const out = String(await h.byName("move_talk_segment").execute({ id: c, position: 1 }));
  expect(out).toContain("segment 1 of 3");
  expect(h.outline!.segments.map((s) => s.title)).toEqual(["C", "A", "B"]);
  expect(last(h.cards)).toEqual({
    kind: "talk-arrangement",
    change: "moved",
    title: "C",
    position: 1,
    total: 3,
  });
  expect(String(await h.byName("move_talk_segment").execute({ id: "nope", position: 1 }))).toContain(
    "no segment nope",
  );
});

test("a removed segment is reported by name, and an unknown id writes nothing", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ title: "A" });
  await h.byName("write_talk_segment").execute({ title: "B" });
  const a = h.outline!.segments[0].id;
  const out = String(await h.byName("remove_talk_segment").execute({ id: a }));
  expect(out).toContain('Dropped "A"');
  expect(h.outline!.segments.map((s) => s.title)).toEqual(["B"]);
  expect(last(h.cards)).toEqual({
    kind: "talk-arrangement",
    change: "removed",
    title: "A",
    total: 1,
  });
  const missing = String(await h.byName("remove_talk_segment").execute({ id: "nope" }));
  expect(missing).toContain("no segment nope");
  expect(h.cards.filter((c) => c.change === "removed")).toHaveLength(1);
});

// The id is the only handle the model has for rewriting, moving or dropping a
// segment, so the read-back has to print it.
test("read_talk_outline prints the spine, the order and every segment's id", async () => {
  const h = harness();
  expect(String(await h.byName("read_talk_outline").execute({}))).toContain("nothing arranged yet");
  await h.byName("set_talk_spine").execute({ thesis: "One line", audience: "beginners" });
  await h.byName("write_talk_segment").execute({
    title: "The opening",
    cues: ["a question"],
    material: [{ kind: "tex", ref: "e^{i\\pi}+1=0" }],
  });
  const text = String(await h.byName("read_talk_outline").execute({}));
  expect(text).toContain("Through-line: One line");
  expect(text).toContain("Audience: beginners");
  expect(text).toContain("1. The opening — Needs depth");
  expect(text).toContain(`id: ${h.outline!.segments[0].id}`);
  expect(text).toContain("formula: e^{i\\pi}+1=0");
});

test("a callback is read back by the title it pays, not by its id", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ title: "The promise" });
  const first = h.outline!.segments[0].id;
  await h.byName("write_talk_segment").execute({ title: "The payoff", callback: first });
  expect(String(await h.byName("read_talk_outline").execute({}))).toContain(
    "pays back: The promise",
  );
  const card = last(h.cards);
  expect(card).toMatchObject({ change: "segment", callbackTitle: "The promise" });
});

test("the labels the card and the read-back share", () => {
  expect(segmentStatusLabel("ready")).toBe("Ready");
  expect(segmentStatusLabel("shallow")).toBe("Needs depth");
  expect(segmentStatusLabel("no-material")).toBe("No material");
  expect(materialLabel({ kind: "tex", tex: "x^2" })).toBe("x^2");
  expect(materialLabel({ kind: "figure", figId: "3", description: "the map" })).toBe(
    "[fig:3] the map",
  );
  expect(toTalkMaterial("figure", "   ")).toBeNull();
});

test("an outline with a spine and no segments still reads back", () => {
  const outline = newTalkOutline({ id: "o", topicId: "t", now: 1 });
  expect(formatTalkOutline({ ...outline, spine: { ...outline.spine, thesis: "A line" } })).toContain(
    "No segments yet",
  );
});
