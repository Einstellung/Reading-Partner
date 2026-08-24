// Turn assembly for a talk's retell (src/reading/talks/turn.ts): which tools
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
const { buildTalkTurn, OBSERVATION_ORDER_TIGHT } = await import(
  "../../../src/reading/talks/turn",
);
// The replay cap is the reading turn's; a retell borrows it rather than
// declaring a second one.
const { HISTORY_KEEP } = await import("../../../src/reading/turn");
const { combineChapters } = await import("../../../src/reading/talks/outline");
import type { LoadedMaterial } from "../../../src/reading/talks/material";
import type { Talk, TalkDecision } from "../../../src/reading/talks/types";

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

function talk(over: Partial<Talk> = {}): Talk {
  return {
    version: 1,
    id: "t1",
    name: "A talk",
    topicId: "topic-1",
    materials: [{ bookId: "b1", title: "Eye and Brain" }],
    createdAt: 1,
    updatedAt: 1,
    decisions: [],
    ...over,
  };
}

const names = (t: { name: string }[]) => t.map((x) => x.name).sort();

function input(over: Partial<Parameters<typeof buildTalkTurn>[0]> = {}) {
  return {
    talk: talk(),
    materials: [material()],
    topicName: "Vision",
    settings,
    history: [],
    record: async () => {},
    ...over,
  };
}

test("the retell prompt and its own tools, with no book open", async () => {
  const turn = await buildTalkTurn(input());
  expect(turn.systemPrompt).toContain("You are sitting in on a retell");
  expect(turn.systemPrompt).toContain("nothing recorded yet");
  expect(names(turn.tools)).toEqual([
    "observation_read",
    "observation_search",
    "observation_update",
    "read_chapter_note",
    "read_pages",
    "read_talk_outline",
    "record_chapter_decision",
    "search_topic",
  ]);
  expect(turn.messages[0].text).toContain("retell");
});

// read_pages says "the book the user is currently in"; with two materials there
// is no such book, so it goes and search_topic (which tags every hit with its
// book) is the way in.
test("several materials drop read_pages and keep the topic search", async () => {
  const turn = await buildTalkTurn(
    input({
      talk: talk({
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
  const turn = await buildTalkTurn(
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
  const written: TalkDecision[] = [];
  const cards: unknown[] = [];
  const turn = await buildTalkTurn(
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
  expect(String(result)).toContain("going in the talk");
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

test("a chapter number that is not in the talk is refused, not written", async () => {
  const written: TalkDecision[] = [];
  const turn = await buildTalkTurn(input({ record: async (d) => void written.push(d) }));
  const tool = turn.tools.find((t) => t.name === "record_chapter_decision");
  expect(String(await tool!.execute({ chapter: 9, include: true, points: [] }))).toContain(
    "No chapter 9",
  );
  expect(written).toEqual([]);
});

test("what is already settled is read back, and the next chapter named", async () => {
  const turn = await buildTalkTurn(
    input({
      talk: talk({
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
  expect(turn.systemPrompt).toContain("Chapter 1. One — in the talk");
  expect(turn.systemPrompt).toContain("Next up: chapter 2");
});

// The record the prompt carries is a snapshot; read_talk_outline is the live
// one, so "what does my talk look like now" has to include the chapter settled a
// moment ago in this same turn.
test("read_talk_outline answers from the talk as it stands, not the turn's snapshot", async () => {
  let current = talk();
  const turn = await buildTalkTurn(
    input({
      talk: current,
      record: async (d) => {
        current = { ...current, decisions: [...current.decisions, d] };
      },
      readTalk: () => current,
      now: () => 5,
    }),
  );
  const outline = turn.tools.find((t) => t.name === "read_talk_outline")!;
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

// A talk over two materials numbers its chapters end to end, and the outline has
// to read back in those numbers or the model cannot cite what it just heard.
test("read_talk_outline reads back in the talk's combined numbering", async () => {
  let current = talk({
    materials: [
      { bookId: "b1", title: "Eye and Brain" },
      { bookId: "b2", title: "Vision" },
    ],
  });
  const turn = await buildTalkTurn(
    input({
      talk: current,
      materials: [material(), material({ bookId: "b2", title: "Vision" })],
      record: async (d) => {
        current = { ...current, decisions: [...current.decisions, d] };
      },
      readTalk: () => current,
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
  expect(String(await turn.tools.find((t) => t.name === "read_talk_outline")!.execute({}))).toContain(
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
  const turn = await buildTalkTurn(
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
  const turn = await buildTalkTurn(
    input({
      talk: talk({
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
  const turn = await buildTalkTurn(input({ history }));
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
  const turn = await buildTalkTurn(
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
test("the talk ladder drops the catalog, then shortens the marks, and leaves the conversation whole", async () => {
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
  const turn = await buildTalkTurn(
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
  const turn = await buildTalkTurn(
    input({
      talk: talk({
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
  // chapter of this talk at all.
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
