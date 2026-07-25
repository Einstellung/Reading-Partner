// Turn assembly for the reading companion (src/reading/turn). The branching
// that used to live inside App's runTurn closure: which tools get mounted in
// companion vs classroom mode, the figure/link-ingestion gates, and the history
// trim. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import type { Annotation } from "../../src/platform/app/reader-contract";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import type { Fulltext } from "../../src/fulltext/types";
import type { Figure } from "../../src/figures/types";
import type { PrepPaper, PrepState } from "../../src/reading/prep/types";

// Headless: no AppData, so every optional read misses (the overview note, the
// memory index). The turn treats all of them as "not there yet".
mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => false,
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async () => {
    throw new Error("no file");
  },
  remove: async () => {},
}));

const { buildReadingTurn, EXPLAIN_KICKOFF, HISTORY_KEEP } = await import("../../src/reading/turn");
const { appendMessage, createThread, dropThreadCache } = await import("../../src/platform/app/threads");

const BOOK = "book-hash";

function fulltext(status: "ok" | "no-text-layer" = "ok"): Fulltext {
  return {
    version: 1,
    status,
    pages: ["Chapter one talks about compilers.", "Page two: inline caches."],
    outline: [{ title: "One", page: 1, level: 0 }],
  };
}

function prepState(): PrepState {
  const paper: PrepPaper = {
    slug: "smith2023",
    title: "Smith 2023",
    authors: ["Smith"],
    year: 2023,
    arxivId: null,
    citedInChapters: [1],
    reason: "load-bearing",
    status: "done",
  };
  return {
    version: 1,
    surveyHash: BOOK,
    surveyName: "Survey",
    createdAt: 0,
    planStatus: "done",
    chapters: [{ index: 1, title: "One", startPage: 1 }],
    references: [],
    papers: [paper],
  };
}

// Just enough of the prep pipeline for the turn: a snapshot and an ingest hook.
function pipeline(state: PrepState | null) {
  return {
    snapshot: () => ({ state }),
    ingestSource: async () => {
      throw new Error("not called");
    },
  } as never;
}

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

function input(over: Partial<Parameters<typeof buildReadingTurn>[0]> = {}) {
  return {
    bookId: BOOK,
    threadId: "thread-1",
    annotationId: "ann-1",
    annotation: { id: "ann-1", text: "inline caches", position: { pageIndex: 1 } } as unknown as Annotation,
    annotations: [] as Annotation[],
    fulltext: fulltext(),
    figures: [] as Figure[],
    buffer: null,
    context: {
      topicId: null,
      topicName: "JITs",
      fileName: "survey.pdf",
      pageLabel: "2",
      pageIndex: 1,
      files: [{ path: "/books/survey.pdf", name: "survey.pdf", hash: BOOK }],
    },
    classroom: false,
    settings,
    getPipeline: () => null,
    distillAnnotations: () => [],
    ...over,
  };
}

const names = (t: { name: string }[]) => t.map((x) => x.name).sort();

beforeEach(() => {
  dropThreadCache(BOOK);
});

test("companion turn: reading tools only, kickoff as the first message", async () => {
  const turn = await buildReadingTurn(input());
  expect(turn).not.toBeNull();
  expect(names(turn!.tools)).toEqual(["read_pages", "search_topic"]);
  expect(turn!.messages).toEqual([{ role: "user", text: EXPLAIN_KICKOFF }]);
  expect(turn!.systemPrompt).toContain("inline caches");
});

test("a book with no text layer gets no read_pages tool", async () => {
  const turn = await buildReadingTurn(input({ fulltext: fulltext("no-text-layer") }));
  expect(names(turn!.tools)).toEqual([]);
});

test("a topic id mounts the memory tools", async () => {
  const turn = await buildReadingTurn(
    input({ context: { ...input().context, topicId: "topic-1" } }),
  );
  expect(names(turn!.tools)).toEqual([
    "memory_read",
    "memory_search",
    "memory_update",
    "read_pages",
    "search_topic",
  ]);
});

test("a figure index mounts view_figure and the catalog", async () => {
  const figures: Figure[] = [{ id: "1", page: 2, caption: "Inline cache layout", bbox: null }];
  const turn = await buildReadingTurn(input({ figures }));
  expect(names(turn!.tools)).toEqual(["read_pages", "search_topic", "view_figure"]);
  expect(turn!.systemPrompt).toContain("[fig:1]");
});

// The two buildClassroomTools call sites are guarded by opposite sides of the
// same flag, so the paper tools mount exactly once in either mode.
test("companion mode with a live pipeline: source + paper tools, mounted once", async () => {
  const turn = await buildReadingTurn(input({ getPipeline: () => pipeline(prepState()) }));
  expect(names(turn!.tools)).toEqual(["add_source", "read_note", "read_pages", "read_paper", "search_topic"]);
  expect(turn!.systemPrompt).toContain("add_source");
});

test("classroom mode with a live pipeline: source + paper tools, mounted once", async () => {
  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(prepState()) }),
  );
  expect(names(turn!.tools)).toEqual(["add_source", "read_note", "read_pages", "read_paper", "search_topic"]);
});

test("classroom mode without a plan yet mounts no paper tools", async () => {
  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(null) }),
  );
  expect(names(turn!.tools)).toEqual(["add_source", "read_pages", "search_topic"]);
});

test("no pipeline means no link ingestion", async () => {
  const turn = await buildReadingTurn(input({ classroom: true }));
  expect(names(turn!.tools)).toEqual(["read_pages", "search_topic"]);
  expect(turn!.systemPrompt).not.toContain("add_source");
});

test("classroom mode swaps the system prompt", async () => {
  const companion = await buildReadingTurn(input());
  const classroom = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(prepState()) }),
  );
  expect(classroom!.systemPrompt).not.toBe(companion!.systemPrompt);
});

test("history is replayed after the kickoff and trimmed to the cap", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  for (let i = 0; i < HISTORY_KEEP + 5; i++) {
    appendMessage(BOOK, "thread-1", { role: i % 2 === 0 ? "user" : "ai", text: `m${i}`, ts: i + 1 });
  }
  const turn = await buildReadingTurn(input());
  expect(turn!.messages.length).toBe(HISTORY_KEEP + 1);
  expect(turn!.messages[0].text).toBe(EXPLAIN_KICKOFF);
  expect(turn!.messages[1].text).toBe("m5");
  expect(turn!.messages[turn!.messages.length - 1].text).toBe(`m${HISTORY_KEEP + 4}`);
});

test("an aborted signal drops the turn", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await buildReadingTurn(input({ signal: controller.signal }))).toBeNull();
});

test("the book-level thread carries no marked passage", async () => {
  const turn = await buildReadingTurn(input({ annotationId: "", annotation: undefined }));
  expect(turn!.systemPrompt).not.toContain("inline caches");
});
