// Turn assembly for the reading companion (src/reading/turn). The branching
// that used to live inside App's runTurn closure: which tools get mounted in
// companion vs classroom mode, the figure/link-ingestion gates, and the history
// trim. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import type { Annotation } from "../../src/platform/app/reader-contract";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import type { Fulltext } from "../../src/fulltext/types";
import type { Figure } from "../../src/reading/figures/types";
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

const { buildReadingTurn, turnFailureView, EXPLAIN_KICKOFF, HISTORY_KEEP } = await import(
  "../../src/reading/turn"
);
const { REFUSE_MIDTURN, REFUSE_ROUNDS } = await import("../../src/ai/agent");
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
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_pages",
    "search_papers",
    "search_topic",
    "walk_citations",
  ]);
  expect(turn!.messages).toEqual([{ role: "user", text: EXPLAIN_KICKOFF }]);
  expect(turn!.systemPrompt).toContain("inline caches");
});

// search_papers is the one tool that does not depend on the book: a book with no
// text layer mounts nothing that can read it, and the literature is still open.
test("a book with no text layer gets no read_pages tool", async () => {
  const turn = await buildReadingTurn(input({ fulltext: fulltext("no-text-layer") }));
  expect(names(turn!.tools)).toEqual(["find_paper", "search_papers", "walk_citations"]);
});

test("a topic id mounts the memory tools", async () => {
  const turn = await buildReadingTurn(
    input({ context: { ...input().context, topicId: "topic-1" } }),
  );
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "memory_read",
    "memory_search",
    "memory_update",
    "read_pages",
    "search_papers",
    "search_topic",
    "walk_citations",
  ]);
});

test("a figure index mounts view_figure and the catalog", async () => {
  const figures: Figure[] = [{ id: "1", page: 2, caption: "Inline cache layout", bbox: null }];
  const turn = await buildReadingTurn(input({ figures }));
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_pages",
    "search_papers",
    "search_topic",
    "view_figure",
    "walk_citations",
  ]);
  expect(turn!.systemPrompt).toContain("[fig:1]");
});

// The two buildClassroomTools call sites are guarded by opposite sides of the
// same flag, so the paper tools mount exactly once in either mode.
test("companion mode with a live pipeline: source + paper tools, mounted once", async () => {
  const turn = await buildReadingTurn(input({ getPipeline: () => pipeline(prepState()) }));
  expect(names(turn!.tools)).toEqual([
    "add_source",
    "find_paper",
    "read_note",
    "read_pages",
    "read_paper",
    "search_papers",
    "search_topic",
    "walk_citations",
  ]);
  expect(turn!.systemPrompt).toContain("add_source");
});

test("classroom mode with a live pipeline: source + paper tools, mounted once", async () => {
  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(prepState()) }),
  );
  expect(names(turn!.tools)).toEqual([
    "add_source",
    "find_paper",
    "read_note",
    "read_pages",
    "read_paper",
    "search_papers",
    "search_topic",
    "walk_citations",
  ]);
});

test("classroom mode without a plan yet mounts no paper tools", async () => {
  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(null) }),
  );
  expect(names(turn!.tools)).toEqual([
    "add_source",
    "find_paper",
    "read_pages",
    "search_papers",
    "search_topic",
    "walk_citations",
  ]);
});

test("no pipeline means no link ingestion", async () => {
  const turn = await buildReadingTurn(input({ classroom: true }));
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_pages",
    "search_papers",
    "search_topic",
    "walk_citations",
  ]);
  expect(turn!.systemPrompt).not.toContain("add_source");
});

// docs/24: the literature question can arrive on any page of any book, so the three
// literature tools are not gated on classroom mode, on a prep pipeline, or on the
// book having a text layer — unlike everything else here.
test("the literature tools are mounted on every reading turn, with their prompt lines", async () => {
  const cases = [
    input(),
    input({ classroom: true }),
    input({ fulltext: fulltext("no-text-layer") }),
    input({ getPipeline: () => pipeline(prepState()) }),
    input({ annotationId: "" }),
  ];
  for (const c of cases) {
    const turn = await buildReadingTurn(c);
    for (const tool of ["search_papers", "find_paper", "walk_citations"]) {
      expect(names(turn!.tools)).toContain(tool);
      expect(turn!.systemPrompt).toContain(tool);
    }
  }
});

// The citation path is only reachable if the prompt says it exists: keyword search
// is what the model reaches for unprompted, and the graph would go unused.
test("the prompt points from the book's own citations into the recent literature", async () => {
  const turn = await buildReadingTurn(input());
  expect(turn!.systemPrompt).toContain("find_paper");
  expect(turn!.systemPrompt).toContain("older than itself");
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

// --- fitting the turn to the model's context window (src/budget) ---

// A 200k window, against the 1M one the other tests use.
const small: Settings = { ...settings, defaultModelId: "claude-opus-4-5" };

// A Chinese survey, the shape that actually overflows: pi prices it at chars/4
// and sees room to spare, the script-aware estimate prices it by the character
// and does not.
function cjkSurvey(pages: number, charsPerPage = 1000): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: Array.from({ length: pages }, () => "编译器内联缓存".repeat(charsPerPage / 7)),
    outline: [],
  };
}

test("a turn that fits keeps everything and says nothing", async () => {
  const figures: Figure[] = [{ id: "1", page: 2, caption: "Inline cache layout", bbox: null }];
  const turn = await buildReadingTurn(input({ figures, settings: small }));
  expect(turn!.notice).toBe("");
  expect(turn!.refusal).toBe("");
  expect(turn!.systemPrompt).toContain("[fig:1]");
});

test("a survey too long for the window stops being inlined, and the user is told", async () => {
  const fulltext = cjkSurvey(300);
  const figures: Figure[] = [{ id: "1", page: 2, caption: "内联缓存布局", bbox: null }];
  const turn = await buildReadingTurn(
    input({ classroom: true, fulltext, figures, settings: small }),
  );

  expect(turn!.refusal).toBe("");
  expect(turn!.notice).toBe(
    "Note: the book didn't fit in context, so I read the pages I needed instead of having all of it in view.",
  );
  // The body is gone and every claim that it is there went with it.
  expect(turn!.systemPrompt).not.toContain("=== Page 2 ===");
  expect(turn!.systemPrompt).not.toContain("already fully in your context");
  expect(turn!.systemPrompt).toContain("read it with read_pages");
  // The cheaper rung above it was taken first, so the catalog went too.
  expect(turn!.systemPrompt).not.toContain("[fig:1]");
  // The tool that replaces the inline body is still mounted.
  expect(names(turn!.tools)).toContain("read_pages");
});

test("the same survey inside a 1M window is left alone", async () => {
  const turn = await buildReadingTurn(input({ classroom: true, fulltext: cjkSurvey(300) }));
  expect(turn!.notice).toBe("");
  expect(turn!.systemPrompt).toContain("=== Page 2 ===");
  expect(turn!.systemPrompt).toContain("already fully in your context");
});

// Nothing on the ladder can help when the thing that overflows is the passage
// the user pointed at. Refusing beats answering from a sample of it.
test("a marked passage larger than the window is refused, not quietly shrunk", async () => {
  const turn = await buildReadingTurn(
    input({
      settings: small,
      annotation: {
        id: "ann-1",
        text: "编译器内联缓存".repeat(40_000),
        position: { pageIndex: 1 },
      } as unknown as Annotation,
    }),
  );
  expect(turn!.refusal).toContain("too large");
  expect(turn!.notice).toBe("");
  // The passage is still whole: the caller shows the refusal instead of sending.
  expect(turn!.systemPrompt.length).toBeGreaterThan(200_000);
});

test("a model the catalog doesn't know skips the budget rather than blocking the turn", async () => {
  const turn = await buildReadingTurn(
    input({ classroom: true, fulltext: cjkSurvey(300), settings: { ...settings, defaultModelId: "no-such-model" } }),
  );
  expect(turn!.notice).toBe("");
  expect(turn!.refusal).toBe("");
  expect(turn!.systemPrompt).toContain("=== Page 2 ===");
});

test("a figure the conversation has already cited keeps its catalog", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  appendMessage(BOOK, "thread-1", { role: "ai", text: "see [fig:1] for the layout", ts: 1 });
  const figures: Figure[] = [{ id: "1", page: 2, caption: "内联缓存布局", bbox: null }];
  const turn = await buildReadingTurn(
    input({ classroom: true, fulltext: cjkSurvey(300), figures, settings: small }),
  );
  expect(turn!.systemPrompt).toContain("[fig:1]");
  expect(turn!.systemPrompt).not.toContain("=== Page 2 ===");
});

// --- how a turn with no reply is shown (turnFailureView) ---
//
// A refusal and a failed call look alike from inside the loop — no answer came
// back — and used to be shown alike, which told a reader whose network is fine
// to go and check their network. These pin the difference.

test("a refusal stands as the reply: no toast, no Retry", () => {
  const view = turnFailureView("refusal", REFUSE_MIDTURN);
  expect(view.text).toBe(REFUSE_MIDTURN);
  expect(view.toast).toBeNull();
  expect(view.retry).toBe(false);
});

test("a refusal is never dressed as a failure to reach the model", () => {
  for (const message of [REFUSE_MIDTURN, REFUSE_ROUNDS]) {
    const view = turnFailureView("refusal", message);
    expect(view.text).not.toContain("Couldn't reach");
    expect(view.text).not.toContain("⚠️");
    // Nothing a reader would have to look up before they could act on it.
    expect(view.text).not.toContain("token");
    expect(view.text).not.toContain("context window");
    // And it ends by naming the ask that would work instead.
    expect(view.text).toContain("Ask ");
  }
});

test("an error keeps its toast, its Retry and its cause", () => {
  const view = turnFailureView("error", "fetch failed");
  expect(view.text).toContain("Couldn't reach the model");
  expect(view.text).toContain("fetch failed");
  expect(view.toast).toBe("AI reply failed");
  expect(view.retry).toBe(true);
});

// The refusal assembled before the call and the one the loop reaches mid-turn
// are two causes with one presentation; they share this mapping so they cannot
// drift apart.
test("a pre-send refusal and a mid-turn refusal are presented identically", async () => {
  const turn = await buildReadingTurn(
    input({
      settings: small,
      annotation: {
        id: "ann-1",
        text: "编译器内联缓存".repeat(40_000),
        position: { pageIndex: 1 },
      } as unknown as Annotation,
    }),
  );
  const before = turnFailureView("refusal", turn!.refusal);
  const during = turnFailureView("refusal", REFUSE_MIDTURN);
  expect(before.text).toBe(turn!.refusal);
  expect(before.toast).toBe(during.toast);
  expect(before.retry).toBe(during.retry);
});
