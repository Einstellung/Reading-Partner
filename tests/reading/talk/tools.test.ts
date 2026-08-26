// The tools that write a talk outline (src/reading/talk/tools.ts): what each one
// writes, what it raises in the conversation, and the thing that would quietly
// corrupt a talk — a positional segment id.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildArrangeTools, formatTalkOutline } from "../../../src/reading/talk/tools";
import type { TalkArrangementCardData } from "../../../src/reading/talk/cards";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";

const last = (cards: TalkArrangementCardData[]) => cards[cards.length - 1];

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

test("a new block is minted with a random id, and the card is the block", async () => {
  const h = harness();
  const body = "## The opening\n\nask them what they think the retina sends";
  const out = String(await h.byName("write_talk_segment").execute({ body }));
  expect(out).toContain("Added block 1 of 1");
  const segment = h.outline!.segments[0];
  expect(segment.body).toBe(body);
  // Not the position: two devices adding a segment in the same place must not
  // mint the same id (platform/sync/merge/records.ts).
  expect(segment.id).not.toBe("0");
  expect(segment.id).not.toBe("1");
  expect(segment.id.length).toBeGreaterThan(8);
  expect(h.cards).toEqual([
    { kind: "talk-arrangement", change: "segment", body, position: 1, total: 1 },
  ]);
});

test("a write with no block in it writes nothing", async () => {
  const h = harness();
  const out = String(await h.byName("write_talk_segment").execute({ position: 1 }));
  expect(out).toContain("No block was given");
  expect(h.outline).toBeNull();
});

test("two blocks added at the same position get different ids", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ body: "First", position: 1 });
  await h.byName("write_talk_segment").execute({ body: "Second", position: 1 });
  const [a, b] = h.outline!.segments;
  expect(a.body).toBe("Second");
  expect(b.body).toBe("First");
  expect(a.id).not.toBe(b.id);
});

// The formula and the figure are written into the block, so they reach disk as
// the model typed them. Nothing here parses them out and nothing abridges them.
test("a formula and a figure citation are stored as written", async () => {
  const h = harness();
  const body = [
    "## The cost",
    "",
    "$$",
    "\\sum_{i=1}^{n} w_i x_i \\ge \\theta",
    "$$",
    "",
    "[fig:4] the ganglion map",
  ].join("\n");
  await h.byName("write_talk_segment").execute({ body });
  expect(h.outline!.segments[0].body).toBe(body);
});

test("writing a block by id replaces it whole", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ body: "Draft" });
  const id = h.outline!.segments[0].id;
  const out = String(await h.byName("write_talk_segment").execute({ id, body: "## Act one" }));
  expect(out).toContain("Rewrote block 1 of 1");
  expect(h.outline!.segments[0]).toMatchObject({ id, body: "## Act one" });
  expect(last(h.cards)).toMatchObject({ change: "segment", body: "## Act one", position: 1 });
});

test("a block moves to a 1-based position, and an unknown id says so", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ body: "A" });
  await h.byName("write_talk_segment").execute({ body: "B" });
  await h.byName("write_talk_segment").execute({ body: "C" });
  const c = h.outline!.segments[2].id;
  const out = String(await h.byName("move_talk_segment").execute({ id: c, position: 1 }));
  expect(out).toContain("block 1 of 3");
  expect(h.outline!.segments.map((s) => s.body)).toEqual(["C", "A", "B"]);
  expect(last(h.cards)).toEqual({
    kind: "talk-arrangement",
    change: "moved",
    title: "C",
    position: 1,
    total: 3,
  });
  expect(String(await h.byName("move_talk_segment").execute({ id: "nope", position: 1 }))).toContain(
    "no block nope",
  );
});

// A block has no title field, so the receipt for a move or a drop names it by
// its first line — the same name the rehearsal's list and the pass handoff use.
test("a removed block is reported by its first line, and an unknown id writes nothing", async () => {
  const h = harness();
  await h.byName("write_talk_segment").execute({ body: "## A\n\nthe hook under it" });
  await h.byName("write_talk_segment").execute({ body: "B" });
  const a = h.outline!.segments[0].id;
  const out = String(await h.byName("remove_talk_segment").execute({ id: a }));
  expect(out).toContain('Dropped "A"');
  expect(h.outline!.segments.map((s) => s.body)).toEqual(["B"]);
  expect(last(h.cards)).toEqual({
    kind: "talk-arrangement",
    change: "removed",
    title: "A",
    total: 1,
  });
  const missing = String(await h.byName("remove_talk_segment").execute({ id: "nope" }));
  expect(missing).toContain("no block nope");
  expect(h.cards.filter((c) => c.change === "removed")).toHaveLength(1);
});

// The id is the only handle the model has for rewriting, moving or dropping a
// block, so the read-back has to print it — and the note itself has to come back
// whole, because a summary of it is not the thing the reader is editing.
test("read_talk_outline prints the spine, the order and every block whole", async () => {
  const h = harness();
  expect(String(await h.byName("read_talk_outline").execute({}))).toContain("nothing arranged yet");
  await h.byName("set_talk_spine").execute({ thesis: "One line", audience: "beginners" });
  const body = "## The opening\n\na question\n\n$$\ne^{i\\pi}+1=0\n$$";
  await h.byName("write_talk_segment").execute({ body });
  const text = String(await h.byName("read_talk_outline").execute({}));
  expect(text).toContain("Through-line: One line");
  expect(text).toContain("Audience: beginners");
  expect(text).toContain(`--- 1 (id: ${h.outline!.segments[0].id}) ---`);
  expect(text).toContain(body);
});

test("an outline with a spine and no blocks still reads back", () => {
  const outline = newTalkOutline({ id: "o", topicId: "t", now: 1 });
  expect(formatTalkOutline({ ...outline, spine: { ...outline.spine, thesis: "A line" } })).toContain(
    "No blocks yet",
  );
});
