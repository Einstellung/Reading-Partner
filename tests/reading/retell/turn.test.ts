// Turn assembly for a retell's retell (src/reading/retell/turn.ts): which tools
// are mounted with no book open, that the reader's marks arrive under the right
// chapters, that a recorded decision comes back as a book's chapter, and that a
// whole book of highlights is fitted to the window rather than sent over it.
// Run: bun test.

import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import type { Fulltext } from "../../../src/fulltext/types";
import type { Figure } from "../../../src/reading/figures/types";
import { trimObservations } from "../../../src/observation/record/snapshot";
import type { ObservationIndexEntry, ObservationType } from "../../../src/observation/record/types";

// No filesystem mock on purpose: every disk read this assembly makes is
// optional and already wrapped (a chapter note, the topic's observation index), so
// with no Tauri host under it they all miss, which is exactly the case being
// assembled for. Mocking the fs plugin here would swap it out for every other
// test file in the run as well.
const { buildRetellTurn, OBSERVATION_ORDER_TIGHT } = await import(
  "../../../src/reading/retell/turn",
);
// The replay cap is the reading turn's; a retell borrows it rather than
// declaring a second one.
const { HISTORY_KEEP } = await import("../../../src/reading/turn");
const { combineChapters } = await import("../../../src/reading/retell/outline");
import type { LoadedMaterial } from "../../../src/reading/retell/material";
import type { Retell, RetellDecision } from "../../../src/reading/retell/types";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import type { TalkArrangementCardData } from "../../../src/reading/retell/cards";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};
// The smallest window a user can pick, for the ladder.
const small: Settings = { ...settings, defaultModelId: "claude-opus-4-5" };

function fulltext(pages: number, outline = true): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: Array.from({ length: pages }, (_, i) => `Page ${i + 1} about compilers.`),
    outline: outline
      ? [
          { title: "One", page: 1, level: 0 },
          { title: "Two", page: 3, level: 0 },
        ]
      : [],
  };
}

function material(over: Partial<LoadedMaterial> = {}): LoadedMaterial {
  const ft = over.fulltext ?? fulltext(4);
  return {
    bookId: "b1",
    title: "Eye and Brain",
    fulltext: ft,
    annotations: [],
    skeleton: {
      source: "outline",
      chapters: [
        { index: 1, title: "One", startPage: 1, endPage: 2, hasNote: false },
        { index: 2, title: "Two", startPage: 3, endPage: 4, hasNote: false },
      ],
    },
    figures: [],
    ...over,
  };
}

function retell(over: Partial<Retell> = {}): Retell {
  return {
    version: 1,
    id: "t1",
    name: "A retell",
    topicId: "topic-1",
    materials: [{ bookId: "b1", title: "Eye and Brain" }],
    createdAt: 1,
    updatedAt: 1,
    decisions: [],
    ...over,
  };
}

const names = (t: { name: string }[]) => t.map((x) => x.name).sort();

// The talk outline in memory. `read` answers null until the first write, the way
// the store does: the file is made by the first write and not by reaching the
// arrangement.
function talkStub() {
  let outline: TalkOutline | null = null;
  return {
    get current() {
      return outline;
    },
    access: {
      read: async () => outline,
      edit: async (change: (o: TalkOutline) => TalkOutline) => {
        outline = change(
          outline ?? newTalkOutline({ id: "o1", topicId: "topic-1", retellId: "t1", now: 1 }),
        );
        return outline;
      },
    },
  };
}

function input(over: Partial<Parameters<typeof buildRetellTurn>[0]> = {}) {
  return {
    retell: retell(),
    materials: [material()],
    topicName: "Vision",
    settings,
    history: [],
    record: async () => {},
    talk: talkStub().access,
    ...over,
  };
}

test("the retell prompt and its own tools, with no book open", async () => {
  const turn = await buildRetellTurn(input());
  expect(turn.systemPrompt).toContain("You are sitting in on a retell");
  expect(turn.systemPrompt).toContain("no through-line yet");
  expect(names(turn.tools)).toEqual([
    "move_talk_segment",
    "observation_read",
    "observation_search",
    "observation_update",
    "read_chapter_note",
    "read_pages",
    "read_retell_outline",
    "read_talk_outline",
    "record_chapter_decision",
    "remove_talk_segment",
    "search_topic",
    "set_talk_spine",
    "write_talk_segment",
  ]);
  expect(turn.messages[0].text).toContain("retell");
});

// read_pages says "the book the user is currently in"; with two materials there
// is no such book, so it goes and search_topic (which tags every hit with its
// book) is the way in.
test("several materials drop read_pages and keep the topic search", async () => {
  const turn = await buildRetellTurn(
    input({
      retell: retell({
        materials: [
          { bookId: "b1", title: "Eye and Brain" },
          { bookId: "b2", title: "Vision" },
        ],
      }),
      materials: [material(), material({ bookId: "b2", title: "Vision" })],
    }),
  );
  expect(names(turn.tools)).not.toContain("read_pages");
  expect(names(turn.tools)).toContain("search_topic");
  expect(turn.systemPrompt).toContain("Eye and Brain and Vision");
});

test("the reader's marks arrive bucketed under the chapters they fall in", async () => {
  const turn = await buildRetellTurn(
    input({
      materials: [
        material({
          annotations: [
            { page: 1, text: "the inline cache claim", comment: "" },
            { page: 4, text: "the later claim", comment: "does this follow?" },
          ],
        }),
      ],
    }),
  );
  expect(turn.systemPrompt).toContain("1. One — pp.1-2, 1 highlight");
  expect(turn.systemPrompt).toContain("2. Two — pp.3-4, 1 highlight");
  expect(turn.systemPrompt).toContain('- [p.1] "the inline cache claim"');
  expect(turn.systemPrompt).toContain('their note: "does this follow?"');
  expect(names(turn.tools)).toContain("read_annotations");
});

// The decision is what the whole mode exists to produce; it has to land on the
// right book's chapter, not on a bare number.
test("record_chapter_decision writes a decision filed under its book", async () => {
  const written: RetellDecision[] = [];
  const cards: unknown[] = [];
  const turn = await buildRetellTurn(
    input({
      record: async (d) => {
        written.push(d);
      },
      onDecisionCard: (c) => cards.push(c),
      now: () => 777,
    }),
  );
  const tool = turn.tools.find((t) => t.name === "record_chapter_decision");
  const result = await tool!.execute({
    chapter: 2,
    include: true,
    points: ["the ganglion density argument"],
    figure: "[fig:3]",
  });
  expect(String(result)).toContain("going in the retell");
  expect(written).toEqual([
    {
      bookId: "b1",
      chapter: 2,
      title: "Two",
      include: true,
      points: ["the ganglion density argument"],
      figure: "[fig:3]",
      updatedAt: 777,
    },
  ]);
  expect(cards).toHaveLength(1);
});

test("a chapter number that is not in the retell is refused, not written", async () => {
  const written: RetellDecision[] = [];
  const turn = await buildRetellTurn(input({ record: async (d) => void written.push(d) }));
  const tool = turn.tools.find((t) => t.name === "record_chapter_decision");
  expect(String(await tool!.execute({ chapter: 9, include: true, points: [] }))).toContain(
    "No chapter 9",
  );
  expect(written).toEqual([]);
});

test("what is already settled is read back as an audit line", async () => {
  const turn = await buildRetellTurn(
    input({
      retell: retell({
        decisions: [
          {
            bookId: "b1",
            chapter: 1,
            title: "One",
            include: true,
            points: ["the 1962 data does the work"],
            updatedAt: 5,
          },
        ],
      }),
    }),
  );
  expect(turn.systemPrompt).toContain("1. One — in the talk");
  expect(turn.systemPrompt).toContain("Untouched: 2. Two.");
  expect(turn.systemPrompt).not.toContain("Next up");
});

// The record the prompt carries is a snapshot; read_retell_outline is the live
// one, so "what does my retell look like now" has to include the chapter settled a
// moment ago in this same turn.
test("read_retell_outline answers from the retell as it stands, not the turn's snapshot", async () => {
  let current = retell();
  const turn = await buildRetellTurn(
    input({
      retell: current,
      record: async (d) => {
        current = { ...current, decisions: [...current.decisions, d] };
      },
      readRetell: () => current,
      now: () => 5,
    }),
  );
  const outline = turn.tools.find((t) => t.name === "read_retell_outline")!;
  expect(String(await outline.execute({}))).toContain("No chapter has been settled yet");

  await turn.tools.find((t) => t.name === "record_chapter_decision")!.execute({
    chapter: 2,
    include: true,
    points: ["the ganglion density argument"],
  });
  const text = String(await outline.execute({}));
  expect(text).toContain("2. Two");
  expect(text).toContain("the ganglion density argument");
  expect(text).toContain("Not settled yet: 1. One.");
});

// A retell over two materials numbers its chapters end to end, and the outline has
// to read back in those numbers or the model cannot cite what it just heard.
test("read_retell_outline reads back in the retell's combined numbering", async () => {
  let current = retell({
    materials: [
      { bookId: "b1", title: "Eye and Brain" },
      { bookId: "b2", title: "Vision" },
    ],
  });
  const turn = await buildRetellTurn(
    input({
      retell: current,
      materials: [material(), material({ bookId: "b2", title: "Vision" })],
      record: async (d) => {
        current = { ...current, decisions: [...current.decisions, d] };
      },
      readRetell: () => current,
      now: () => 5,
    }),
  );
  // Chapter 3 of the combined list is chapter 1 of the second material.
  await turn.tools.find((t) => t.name === "record_chapter_decision")!.execute({
    chapter: 3,
    include: true,
    points: ["theirs"],
  });
  expect(current.decisions[0]).toMatchObject({ bookId: "b2", chapter: 1 });
  expect(String(await turn.tools.find((t) => t.name === "read_retell_outline")!.execute({}))).toContain(
    "3. One",
  );
});

// Judging whether a figure carries a point cannot be done from a caption, so the
// tool is mounted here exactly as it is in the reader — the crop comes from the
// library copy, read only when it is actually called.
test("view_figure is mounted and crops from the library copy of the book", async () => {
  const figures: Figure[] = [
    { id: "3", page: 2, caption: "Ganglion density against eccentricity", bbox: null } as Figure,
  ];
  let readFor = "";
  const turn = await buildRetellTurn(
    input({
      materials: [material({ figures })],
      readBytes: async (bookId) => {
        readFor = bookId;
        return new ArrayBuffer(8);
      },
      render: (async () => ({
        base64: "AAAA",
        mimeType: "image/jpeg",
        dataUrl: "",
        width: 10,
        height: 10,
      })) as never,
    }),
  );
  expect(names(turn.tools)).toContain("view_figure");
  expect(turn.systemPrompt).toContain("[fig:N]");
  // Nothing was read to assemble the prompt.
  expect(readFor).toBe("");
  const tool = turn.tools.find((t) => t.name === "view_figure");
  const result = (await tool!.execute({ id: "3" })) as { images?: unknown[] };
  expect(readFor).toBe("b1");
  expect(result.images).toHaveLength(1);
});

test("each material's figures are listed under its own name", async () => {
  const fig = (id: string): Figure =>
    ({ id, page: 1, caption: `Figure ${id}`, bbox: null }) as Figure;
  const turn = await buildRetellTurn(
    input({
      retell: retell({
        materials: [
          { bookId: "b1", title: "Eye and Brain" },
          { bookId: "b2", title: "Vision" },
        ],
      }),
      materials: [
        material({ figures: [fig("1")] }),
        material({ bookId: "b2", title: "Vision", figures: [fig("2")] }),
      ],
    }),
  );
  expect(turn.systemPrompt).toContain('In "Eye and Brain":');
  expect(turn.systemPrompt).toContain('In "Vision":');
});

test("history is replayed after the kickoff and trimmed to the cap", async () => {
  const history = Array.from({ length: HISTORY_KEEP + 5 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "ai") as "user" | "ai",
    text: `m${i}`,
  }));
  const turn = await buildRetellTurn(input({ history }));
  expect(turn.messages.length).toBe(HISTORY_KEEP + 1);
  expect(turn.messages[1].text).toBe("m5");
});

// The marks are the material here, so shortening them is said out loud rather
// than dropped silently.
test("marks too large for the window are shortened, and the reader is told", async () => {
  const annotations = Array.from({ length: 1_200 }, (_, i) => ({
    page: (i % 4) + 1,
    text: "编译器内联缓存".repeat(200),
    comment: "",
  }));
  const turn = await buildRetellTurn(
    input({ materials: [material({ annotations })], settings: small }),
  );
  expect(turn.refusal).toBe("");
  expect(turn.notice).toContain("your highlights are shortened here to fit");
  expect(turn.systemPrompt).toContain("shortened to fit");
  expect(turn.systemPrompt).toContain("more highlights in this chapter");
  expect(names(turn.tools)).toContain("read_annotations");
});

// The order the ladder gives things up in, seen from this path rather than from
// the table. The figure catalog is redundancy and goes silently; the reader's
// own marks are the material of a retell, so shortening them is said out
// loud; the conversation is below both.
test("the retell ladder drops the catalog, then shortens the marks, and leaves the conversation whole", async () => {
  const annotations = Array.from({ length: 1_200 }, (_, i) => ({
    page: (i % 4) + 1,
    text: "编译器内联缓存".repeat(200),
    comment: "",
  }));
  const history = Array.from({ length: HISTORY_KEEP + 5 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "ai") as "user" | "ai",
    text: `m${i}`,
  }));
  const figures: Figure[] = [{ id: "1", page: 1, caption: "内联缓存布局", bbox: null } as Figure];
  const turn = await buildRetellTurn(
    input({ materials: [material({ annotations, figures })], history, settings: small }),
  );
  expect(turn.refusal).toBe("");
  expect(turn.systemPrompt).not.toContain("[fig:1]");
  expect(turn.systemPrompt).toContain("shortened to fit");
  expect(turn.notice).toBe(
    "Note: your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again.",
  );
  // Below the marks on the ladder, so untouched: the whole replay tail is here.
  expect(turn.messages.length).toBe(HISTORY_KEEP + 1);
  expect(turn.messages[turn.messages.length - 1].text).toBe(`m${HISTORY_KEEP + 4}`);
});

// The combined numbering is what the model is given, so a note it asks for has
// to be fetched from the right book.
test("read_chapter_note answers in combined chapter numbers", async () => {
  const turn = await buildRetellTurn(
    input({
      retell: retell({
        materials: [
          { bookId: "b1", title: "Eye and Brain" },
          { bookId: "b2", title: "Vision" },
        ],
      }),
      materials: [material(), material({ bookId: "b2", title: "Vision" })],
    }),
  );
  const combined = combineChapters([
    { bookId: "b1", title: "Eye and Brain", skeleton: material().skeleton },
    { bookId: "b2", title: "Vision", skeleton: material().skeleton },
  ]);
  expect(combined.chapters).toHaveLength(4);
  const tool = turn.tools.find((t) => t.name === "read_chapter_note");
  // No note on disk (the fs mock says nothing exists), and chapter 9 is not a
  // chapter of this retell at all.
  expect(String(await tool!.execute({ chapter: 4 }))).toContain("No note on file");
  expect(String(await tool!.execute({ chapter: 9 }))).toContain("No chapter 9");
});

// What survives when the window forces the observation section down to three
// lines. A chapter the reader read but could not give out loud is where the next
// question should go, so cannot-explain sits directly behind stuck-point — ahead
// of a belief, which only shapes how the question is phrased.
test("the tight observation order keeps what the retell asks its next question from", () => {
  const e = (type: ObservationType, id: string, updated: string): ObservationIndexEntry => ({
    id,
    type,
    summary: id,
    updated,
  });
  const entries = [
    e("belief", "m-b1", "2026-08-06"),
    e("can-explain", "m-y1", "2026-08-06"),
    e("cannot-explain", "m-n1", "2026-08-01"),
    e("stuck-point", "m-s1", "2026-07-20"),
    e("reading-position", "m-r1", "2026-08-06"),
  ];
  expect(trimObservations(entries, 3, OBSERVATION_ORDER_TIGHT).map((k) => k.id)).toEqual([
    "m-s1",
    "m-n1",
    "m-b1",
  ]);
});

// The talk's tools used to wait until every chapter had a decision, which put
// seventeen chapter dispositions in front of the through-line. They are mounted
// from the first turn; what stops a premature write is the prompt.
test("the talk's tools are mounted on turn one, with nothing settled", async () => {
  const turn = await buildRetellTurn(input());
  expect(names(turn.tools)).toContain("set_talk_spine");
  expect(names(turn.tools)).toContain("write_talk_segment");
  expect(names(turn.tools)).toContain("move_talk_segment");
  expect(names(turn.tools)).toContain("remove_talk_segment");
  expect(names(turn.tools)).toContain("read_talk_outline");
  expect(turn.systemPrompt).toContain("Getting the backbone");
  expect(turn.systemPrompt).toContain("Writing the note");
  expect(turn.systemPrompt).toContain("A block is not a chapter");
});

test("a block written into the note lands in the talk and raises a card", async () => {
  const talk = talkStub();
  const cards: TalkArrangementCardData[] = [];
  const turn = await buildRetellTurn(
    input({
      talk: talk.access,
      onArrangeCard: (c) => cards.push(c),
      now: () => 99,
    }),
  );
  const body = [
    "## Why the eye is not a camera",
    "",
    "the retina throws most of it away",
    "",
    "[fig:3] the ganglion map",
  ].join("\n");
  const out = String(
    await turn.tools.find((t) => t.name === "write_talk_segment")!.execute({ body }),
  );
  expect(out).toContain("Added block 1 of 1");
  expect(talk.current?.segments).toHaveLength(1);
  expect(talk.current?.segments[0].body).toBe(body);
  expect(cards).toHaveLength(1);
  expect(cards[0].change).toBe("segment");
});

// The prompt inlines the talk as it stands, so the next turn does not have to
// read it back before it can add to it.
test("a note already started is in the prompt with its segment ids", async () => {
  const talk = talkStub();
  await talk.access.edit((o) => putSegment(o, { id: "s1", body: "The opening" }, 7));
  const turn = await buildRetellTurn(input({ talk: talk.access }));
  expect(turn.systemPrompt).toContain("The opening");
  expect(turn.systemPrompt).toContain("id: s1");
});

// The record comes off the talk, not off the chapters. A spine on it does not
// say the macro pass is over — that stage banks its draft as it goes — but it
// does take the record past its opening, and every chapter settled means
// nothing on its own.
test("a spine on the talk takes the record past its opening", async () => {
  const talk = talkStub();
  await talk.access.edit((o) =>
    setSpine(o, { thesis: "The eye is not a camera", backbone: ["The retina discards"] }, 7),
  );
  const turn = await buildRetellTurn(input({ talk: talk.access }));
  expect(turn.systemPrompt).not.toContain("no through-line yet");
  expect(turn.systemPrompt).toContain("Through-line: The eye is not a camera");
  expect(turn.systemPrompt).toContain("1. The retina discards — not given yet");
});
