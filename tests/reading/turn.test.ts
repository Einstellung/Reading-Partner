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
import type { SavedArticle } from "../../src/reading/saved-articles";
import type { SubagentTurnFn } from "../../src/ai/subagent";
import { makeAppData } from "../support/appdata";

// An empty in-memory AppData, so every optional read misses (the overview note,
// the observation index) and the turn treats them as "not there yet" — and so the
// one thing a turn here writes, the kept article's text going into the fulltext
// cache, can be read back the way read_paper would.
// atomic-fs goes in too, whole: mock.module is process-wide and the last file to
// load wins, so another test file's two-export stub would otherwise be what the
// stores here write through — and the write would land on a disk this file cannot
// read back (tests/support/appdata.ts).
const app = makeAppData();
mock.module("@tauri-apps/plugin-fs", () => app.pluginFs);
mock.module("@tauri-apps/api/core", () => app.core);
mock.module("../../src/platform/app/atomic-fs", () => app.atomicFs);

const { backgroundFailureToast, buildReadingTurn, turnFailureView, EXPLAIN_KICKOFF, HISTORY_KEEP } =
  await import("../../src/reading/turn");
const { getFulltext } = await import("../../src/fulltext/store");
const { paperFulltextHash, writePrepNote } = await import("../../src/reading/prep/store");
const { CLASSROOM_NOTE_BUDGET } = await import("../../src/reading/prep/classroom");
const { estimateTextTokens } = await import("../../src/budget");
const { REFUSE_MIDTURN, REFUSE_ROUNDS } = await import("../../src/ai/agent");
const { StoppedError } = await import("../../src/ai/watchdog");
const { RESEARCH_TOOL_NAME, RESEARCH_TURN_ROUNDS } = await import(
  "../../src/reading/papers/research-agent"
);
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

// Just enough of the prep pipeline for the turn: a snapshot and the two ingest
// hooks. `onCaptured` collects what a kept article was turned into, which is the
// only place that mapping is visible from outside.
function pipeline(
  state: PrepState | null,
  onCaptured?: (paper: PrepPaper, fetched: { fulltext?: Fulltext | null }) => void,
) {
  return {
    snapshot: () => ({ state }),
    ingestSource: async () => {
      throw new Error("not called");
    },
    ingestCaptured: async (
      mint: (taken: Set<string>) => PrepPaper,
      fetched: { fulltext?: Fulltext | null },
    ) => {
      const paper = mint(new Set((state?.papers ?? []).map((p) => p.slug)));
      onCaptured?.(paper, fetched);
      return { ...paper, status: "digesting" as const, pages: 1 };
    },
  } as never;
}

// The kept-article store as the assembly sees it: a cheap gate and the records.
function savedStore(list: SavedArticle[]) {
  return { any: async () => list.length > 0, all: async () => list };
}

function savedArticle(): SavedArticle {
  return {
    id: "https://feed.test/piece",
    topicId: "brief",
    url: "https://feed.test/piece",
    title: "A kept piece",
    source: "feed",
    sourceName: "The Feed",
    publishedAt: "2026-07-20T08:00:00Z",
    savedAt: 1,
    summaryOnly: false,
    text: "the kept body",
    html: "<p>the kept body</p>",
  };
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
    "research_literature",
    "search_topic",
  ]);
  expect(turn!.messages).toEqual([{ role: "user", text: EXPLAIN_KICKOFF }]);
  expect(turn!.systemPrompt).toContain("inline caches");
});

// The literature tools are the ones that do not depend on the book: a book with no
// text layer mounts nothing that can read it, and the literature is still open.
test("a book with no text layer gets no read_pages tool", async () => {
  const turn = await buildReadingTurn(input({ fulltext: fulltext("no-text-layer") }));
  expect(names(turn!.tools)).toEqual(["find_paper", "research_literature"]);
});

test("a topic id mounts the observation tools", async () => {
  const turn = await buildReadingTurn(
    input({ context: { ...input().context, topicId: "topic-1" } }),
  );
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "observation_read",
    "observation_search",
    "observation_update",
    "read_pages",
    "research_literature",
    "search_topic",
  ]);
});

test("a figure index mounts view_figure and the catalog", async () => {
  const figures: Figure[] = [{ id: "1", page: 2, caption: "Inline cache layout", bbox: null }];
  const turn = await buildReadingTurn(input({ figures }));
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_pages",
    "research_literature",
    "search_topic",
    "view_figure",
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
    "research_literature",
    "search_topic",
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
    "research_literature",
    "search_topic",
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
    "research_literature",
    "search_topic",
  ]);
});

// Kept info articles (docs/21). Three conditions, all of them necessary: the
// classroom is where a prep list exists to put one on, the pipeline is what puts
// it there, and a reader who has kept nothing gets no tool at all.
test("classroom mode with kept articles mounts the saved-article tools and their prompt line", async () => {
  const turn = await buildReadingTurn(
    input({
      classroom: true,
      getPipeline: () => pipeline(prepState()),
      savedArticles: savedStore([savedArticle()]),
    }),
  );
  expect(names(turn!.tools)).toEqual([
    "add_saved_article",
    "add_source",
    "find_paper",
    "list_saved_articles",
    "read_note",
    "read_pages",
    "read_paper",
    "research_literature",
    "search_topic",
  ]);
  expect(turn!.systemPrompt).toContain("list_saved_articles");
  expect(turn!.systemPrompt).toContain("and only then");
});

test("no kept articles, or no classroom, means no saved-article tools", async () => {
  const cases = [
    // Classroom, pipeline, nothing kept.
    input({ classroom: true, getPipeline: () => pipeline(prepState()) }),
    // Kept articles, but companion mode: the prep list is the classroom's list.
    input({ getPipeline: () => pipeline(prepState()), savedArticles: savedStore([savedArticle()]) }),
    // Classroom and kept articles, but no pipeline to put one on.
    input({ classroom: true, savedArticles: savedStore([savedArticle()]) }),
  ];
  for (const c of cases) {
    const turn = await buildReadingTurn(c);
    expect(names(turn!.tools)).not.toContain("list_saved_articles");
    expect(names(turn!.tools)).not.toContain("add_saved_article");
    expect(turn!.systemPrompt).not.toContain("list_saved_articles");
  }
});

// Reading the records sanitizes every stored body, so the turn that only mounts
// the tools must not pay for it — and a turn that uses them must not pay twice.
test("the mount gate does not read the records; a tool call reads them once", async () => {
  let gates = 0;
  let reads = 0;
  const turn = await buildReadingTurn(
    input({
      classroom: true,
      getPipeline: () => pipeline(prepState()),
      savedArticles: {
        any: async () => {
          gates++;
          return true;
        },
        all: async () => {
          reads++;
          return [savedArticle()];
        },
      },
    }),
  );
  expect(gates).toBe(1);
  expect(reads).toBe(0);
  const list = turn!.tools.find((t) => t.name === "list_saved_articles")!;
  expect((await list.execute({})) as string).toContain("A kept piece");
  await list.execute({ query: "feed" });
  expect(reads).toBe(1);
});

// The whole wiring in one go: what the article turns into, what the pipeline is
// asked to queue, and the cache entry read_paper will go looking for.
test("add_saved_article queues the kept text and caches it under the slug it got", async () => {
  const queued: PrepPaper[] = [];
  const handed: { fulltext?: Fulltext | null }[] = [];
  const turn = await buildReadingTurn(
    input({
      classroom: true,
      getPipeline: () =>
        pipeline(prepState(), (paper, fetched) => {
          queued.push(paper);
          handed.push(fetched);
        }),
      savedArticles: savedStore([savedArticle()]),
    }),
  );
  const add = turn!.tools.find((t) => t.name === "add_saved_article")!;
  const out = (await add.execute({ id: "https://feed.test/piece" })) as string;

  expect(queued.length).toBe(1);
  expect(queued[0].kind).toBe("article");
  expect(queued[0].captured).toBe(true);
  expect(queued[0].addedByUser).toBe(true);
  expect(queued[0].sourceUrl).toBe("https://feed.test/piece");
  expect(handed[0].fulltext?.pages[0]).toContain("the kept body");
  expect(out).toContain(`read_paper("${queued[0].slug}"`);
  expect(out).toContain("The Feed");
  expect(out).toContain("published 2026-07-20");
  // read_paper serves the fulltext cache, so the text has to have landed there
  // under the slug the pipeline minted — not under a slug guessed beforehand.
  const cached = await getFulltext(paperFulltextHash(BOOK, queued[0].slug));
  expect(cached?.pages[0]).toContain("the kept body");
  expect(cached?.pages[0]).toContain("Saved by the reader from The Feed");
});

test("no pipeline means no link ingestion", async () => {
  const turn = await buildReadingTurn(input({ classroom: true }));
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_pages",
    "research_literature",
    "search_topic",
  ]);
  expect(turn!.systemPrompt).not.toContain("add_source");
});

// docs/24: the literature question can arrive on any page of any book, so the two
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
    for (const tool of ["research_literature", "find_paper"]) {
      expect(names(turn!.tools)).toContain(tool);
      expect(turn!.systemPrompt).toContain(tool);
    }
  }
});

// docs/25: the candidate lists and the citation walk live inside the sub-agent. A
// reading turn that mounts them again puts back exactly the context the sub-agent
// was introduced to keep out.
test("topic search and the citation walk are not reachable from the reader's turn", async () => {
  const cases = [
    input(),
    input({ classroom: true, getPipeline: () => pipeline(prepState()) }),
    input({ context: { ...input().context, topicId: "topic-1" } }),
  ];
  for (const c of cases) {
    const turn = await buildReadingTurn(c);
    expect(names(turn!.tools)).not.toContain("search_papers");
    expect(names(turn!.tools)).not.toContain("walk_citations");
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

// --- what a classroom turn carries (docs/09) ---

function notePaper(slug: string, chapters: number[]): PrepPaper {
  return {
    slug,
    title: slug,
    authors: [],
    year: null,
    arxivId: null,
    citedInChapters: chapters,
    reason: "load-bearing",
    status: "done",
  };
}

// Seven chapters, one per page, so the fixture's page 2 lands the reader in
// chapter 2 the way chapterIndexForPage would on a real survey.
function chaptered(papers: PrepPaper[]): PrepState {
  return {
    ...prepState(),
    chapters: Array.from({ length: 7 }, (_, i) => ({
      index: i + 1,
      title: `Ch ${i + 1}`,
      startPage: i + 1,
    })),
    papers,
  };
}

// The reader's scroll position used to decide whether a note rode along at all:
// parked on p.12 of the embodied-AI survey they were counted into chapter 5 and
// the turn carried one of the twenty notes, while what they were being taught
// was chapter 4. Every note there is comes now; the position only orders them.
test("every prep note rides along, whatever chapter the reader is parked in", async () => {
  const papers = [notePaper("all-a", [1]), notePaper("all-b", [4]), notePaper("all-c", [7])];
  for (const p of papers) await writePrepNote(BOOK, p.slug, `body of ${p.slug}`);
  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(chaptered(papers)) }),
  );
  for (const p of papers) {
    expect(turn!.systemPrompt).toContain(`body of ${p.slug}`);
    expect(turn!.systemPrompt).toContain(`- ${p.slug} — ${p.slug} [note below]`);
  }
});

// The cap is what makes "all of them" safe, and the order is what makes the cut
// defensible: the chapter the reader is in is the last thing given up.
test("the cap cuts the far end of the queue, and the prep list names who was cut", async () => {
  const here = [1, 2, 3, 4].map((i) => notePaper(`cap-here-${i}`, [2]));
  const far = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => notePaper(`cap-far-${i}`, [7]));
  // Far first, so nothing but the priority order can be what saves the others.
  const papers = [...far, ...here];
  for (const p of papers) await writePrepNote(BOOK, p.slug, "书".repeat(5_000));

  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(chaptered(papers)) }),
  );
  const carried = papers.filter((p) => turn!.systemPrompt.includes(`--- ${p.slug}:`));
  expect(carried.length).toBeGreaterThan(0);
  expect(carried.length).toBeLessThan(papers.length);
  expect(carried.length * estimateTextTokens("书".repeat(5_000))).toBeLessThanOrEqual(
    CLASSROOM_NOTE_BUDGET,
  );
  for (const p of here) expect(carried).toContain(p);
  // And what did not fit is on the list, with the call that fetches it.
  for (const p of papers.filter((x) => !carried.includes(x))) {
    expect(turn!.systemPrompt).toContain(`read_note("${p.slug}")`);
  }
});

// One source feeds the bodies and the status list, so the list cannot claim a
// note is in front of the model when it is not.
test("the prep list separates carried from on-disk from never fetched", async () => {
  const papers = [
    notePaper("state-carried", [2]),
    { ...notePaper("state-missing", [2]), status: "failed" as const, error: "Connection error." },
    {
      ...notePaper("state-absent", [2]),
      status: "failed" as const,
      error: "not found on arXiv, OpenAlex, or Semantic Scholar",
    },
  ];
  await writePrepNote(BOOK, "state-carried", "the carried body");
  const turn = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(chaptered(papers)) }),
  );
  expect(turn!.systemPrompt).toContain("- state-carried — state-carried [note below]");
  expect(turn!.systemPrompt).toContain("[no full text: Connection error.]");
  expect(turn!.systemPrompt).toContain(
    "[no full text: not found on arXiv, OpenAlex, or Semantic Scholar]",
  );
});

// A tool the prompt promises and the turn did not mount answers "unknown tool",
// and one of those teaches the model to stop reaching for any of them.
test("the tools paragraph names read_annotations only when a mark exists", async () => {
  const bare = await buildReadingTurn(input());
  expect(names(bare!.tools)).not.toContain("read_annotations");
  expect(bare!.systemPrompt).not.toContain("read_annotations");

  const marked = await buildReadingTurn(
    input({
      annotations: [
        { id: "ann-1", text: "inline caches", position: { pageIndex: 1 } } as unknown as Annotation,
      ],
    }),
  );
  expect(names(marked!.tools)).toContain("read_annotations");
  expect(marked!.systemPrompt).toContain("read_annotations(material)");
});

test("a classroom turn announces the paper tools only once a prep run exists", async () => {
  const none = await buildReadingTurn(input({ classroom: true }));
  expect(none!.systemPrompt).not.toContain("read_paper");
  expect(none!.systemPrompt).not.toContain("read_note");

  const prepped = await buildReadingTurn(
    input({ classroom: true, getPipeline: () => pipeline(prepState()) }),
  );
  expect(prepped!.systemPrompt).toContain("read_paper(slug, from, to)");
  expect(prepped!.systemPrompt).toContain("read_note(slug)");
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

// The chips (reading/intents.ts) mean a thread now opens on whatever the reader
// picked, and that line is already a user message. Prefixing the explain kickoff
// in front of it would tell the model to explain the passage when the reader
// asked for an example.
test("a thread that opens on the reader's own ask replays it, with no kickoff in front", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  appendMessage(BOOK, "thread-1", { role: "user", text: "Can you give me an example?", ts: 1 });
  appendMessage(BOOK, "thread-1", { role: "ai", text: "Here is one.", ts: 2 });
  const turn = await buildReadingTurn(input());
  expect(turn!.messages.map((m) => m.text)).toEqual(["Can you give me an example?", "Here is one."]);
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

// The narrowest window in the whole catalog (128k). Reachable since the picker
// stopped hiding models under a floor, so the ladder has to hold there too.
const tiny: Settings = {
  ...settings,
  defaultProviderId: "openai",
  defaultModelId: "gpt-5.3-codex-spark",
};

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

// The prep notes are on the ladder above the inlined book: a window that cannot
// hold both gives up the shelf before the textbook, and says so. The trim is a
// quarter of the cap walked in the same order, so what survives is a prefix of
// what a roomy window carried — not a differently-chosen set.
test("a window that cannot hold every note keeps the front of the queue, and says so", async () => {
  const here = [1, 2, 3, 4].map((i) => notePaper(`rung-here-${i}`, [2]));
  const far = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => notePaper(`rung-far-${i}`, [7]));
  const papers = [...here, ...far];
  for (const p of papers) await writePrepNote(BOOK, p.slug, "书".repeat(5_000));
  const carried = (turn: { systemPrompt: string }) =>
    papers.filter((p) => turn.systemPrompt.includes(`--- ${p.slug}:`)).map((p) => p.slug);

  const roomy = await buildReadingTurn(
    input({
      classroom: true,
      fulltext: cjkSurvey(160),
      getPipeline: () => pipeline(chaptered(papers)),
    }),
  );
  const tight = await buildReadingTurn(
    input({
      classroom: true,
      fulltext: cjkSurvey(160),
      settings: small,
      getPipeline: () => pipeline(chaptered(papers)),
    }),
  );

  expect(roomy!.notice).toBe("");
  expect(tight!.refusal).toBe("");
  expect(tight!.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room.",
  );
  // The book is below the notes on the ladder, so it is still here whole.
  expect(tight!.systemPrompt).toContain("=== Page 2 ===");
  const kept = carried(tight!);
  expect(kept.length).toBeGreaterThan(0);
  expect(carried(roomy!).slice(0, kept.length)).toEqual(kept);
  expect(kept.length).toBeLessThan(carried(roomy!).length);
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

// The smallest window a user can now pick. A short turn still goes out whole,
// and a long book gives way rung by rung rather than being sent over the line.
test("the narrowest window in the catalog still assembles an ordinary turn", async () => {
  const turn = await buildReadingTurn(input({ settings: tiny }));
  expect(turn!.refusal).toBe("");
  expect(turn!.notice).toBe("");
  expect(turn!.systemPrompt).toContain("inline caches");
});

test("the narrowest window gives up the book and says so, rather than overflowing", async () => {
  const turn = await buildReadingTurn(
    input({ classroom: true, fulltext: cjkSurvey(300), settings: tiny }),
  );
  expect(turn!.refusal).toBe("");
  expect(turn!.notice).toBe(
    "Note: the book didn't fit in context, so I read the pages I needed instead of having all of it in view.",
  );
  expect(turn!.systemPrompt).not.toContain("=== Page 2 ===");
  expect(names(turn!.tools)).toContain("read_pages");
});

// The order the ladder gives things up in, seen from the path that uses it
// rather than from the table. The figure catalog is redundancy and goes first,
// silently; the inlined book is evidence and is said out loud; the conversation
// is last, because the fallback distillation that is meant to preserve an older
// stretch of it is fired and forgotten, so trimming early is a straight loss.
test("the reading ladder drops the catalog, then the book, and leaves the conversation whole", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  for (let i = 0; i < HISTORY_KEEP + 10; i++) {
    appendMessage(BOOK, "thread-1", { role: i % 2 === 0 ? "user" : "ai", text: `m${i}`, ts: i });
  }
  const figures: Figure[] = [{ id: "1", page: 2, caption: "内联缓存布局", bbox: null }];
  const turn = await buildReadingTurn(
    input({ classroom: true, fulltext: cjkSurvey(300), figures, settings: small }),
  );
  expect(turn!.refusal).toBe("");
  // Silent rung: gone from the prompt, absent from the notice.
  expect(turn!.systemPrompt).not.toContain("[fig:1]");
  // Evidence rung: gone, and the notice says exactly this and nothing else.
  expect(turn!.systemPrompt).not.toContain("=== Page 2 ===");
  expect(turn!.notice).toBe(
    "Note: the book didn't fit in context, so I read the pages I needed instead of having all of it in view.",
  );
  // Below the book on the ladder, so it was never reached: the full replay tail
  // is still here, ending on the most recent turn. No kickoff in front of it —
  // this tail happens to start on a user message, so it needs no stand-in.
  expect(turn!.messages.length).toBe(HISTORY_KEEP);
  expect(turn!.messages[turn!.messages.length - 1].text).toBe(`m${HISTORY_KEEP + 9}`);
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

test("a refusal is the app talking about the turn: a notice, no toast, no Retry", () => {
  const view = turnFailureView("refusal", REFUSE_MIDTURN);
  expect(view.text).toBe(REFUSE_MIDTURN);
  // Not the row's text: the sentence is never the model's, and text is what
  // every surface replays as the assistant's own words next turn.
  expect(view.as).toBe("notice");
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
  // It stands in for the reply that never came, so it takes the row.
  expect(view.as).toBe("reply");
  expect(view.toast).toBe("AI reply failed");
  expect(view.retry).toBe(true);
});

// A turn whose bubble was closed keeps running (docs/03), so its failure has no
// row to land in and no Retry to offer. The toast is the whole of it, for both
// kinds, and it names the passage — several threads can be running at once.
test("a failure with its conversation closed is carried by a toast that names the passage", () => {
  expect(backgroundFailureToast("error", "神经节细胞越密越清晰")).toBe(
    "AI reply failed on “神经节细胞越密越清晰”",
  );
  expect(backgroundFailureToast("refusal", "神经节细胞越密越清晰")).toBe(
    "AI reply stopped on “神经节细胞越密越清晰”",
  );
});

test("a long passage is cut to a glance, and the book-level thread has none", () => {
  const toast = backgroundFailureToast("error", "编译器内联缓存 ".repeat(20));
  expect(toast.length).toBeLessThan(70);
  expect(toast).toContain("…");
  expect(backgroundFailureToast("error", "  ")).toBe("AI reply failed on a closed conversation");
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
  expect(before.as).toBe(during.as);
  expect(before.toast).toBe(during.toast);
  expect(before.retry).toBe(during.retry);
});

// --- the research sub-agent on the reader's turn (docs/25) ---

// The sub-agent turn is injected, so nothing here touches a provider or the network.
// The fake reports the rounds it spent, so the turn's shared pot actually moves.
function subagentRun(text: string) {
  const asked: number[] = [];
  const run: SubagentTurnFn = async (request) => {
    asked.push(request.maxRounds);
    for (let r = 1; r <= request.maxRounds; r++) {
      request.onRound({ round: r, rounds: request.maxRounds });
    }
    return { kind: "answer", text };
  };
  return { run, asked };
}

function researchTool(turn: NonNullable<Awaited<ReturnType<typeof buildReadingTurn>>>) {
  return turn.tools.find((t) => t.name === RESEARCH_TOOL_NAME)!;
}

// The one correctness requirement of the whole wiring: a run that established nothing
// arrives at the companion as a failed tool call, in the words the brief chose, and
// never as "nothing was found".
test("an unusable research run arrives as a failed tool call, not as an answer", async () => {
  const { run } = subagentRun("There is no recent research on inline caches.");
  const turn = await buildReadingTurn(input({ runSubagentTurn: run }));

  const attempt = researchTool(turn!).execute({ task: "recent work on inline caches" });
  // Evidence is required the moment tools are mounted: this run answered without a
  // single library call, so its words are dropped rather than relayed.
  await expect(attempt).rejects.toThrow("without calling any of its 3 tools");
  await expect(attempt).rejects.toThrow("not a finding");
  await expect(attempt).rejects.not.toThrow("no recent research");
});

test("one reader turn has one pot, and the call after it is spent is never sent", async () => {
  const { run, asked } = subagentRun("answered");
  const turn = await buildReadingTurn(input({ runSubagentTurn: run }));
  const research = researchTool(turn!);

  // Each run spends every turn it was granted, so the pot empties in two.
  await research.execute({ task: "first" }).catch(() => {});
  await research.execute({ task: "second" }).catch(() => {});
  await expect(research.execute({ task: "third" })).rejects.toThrow("did not run at all");
  await expect(research.execute({ task: "third" })).rejects.toThrow("Nothing was looked up");

  expect(asked).toEqual([6, RESEARCH_TURN_ROUNDS - 6]);
});

test("a fresh reader turn gets a fresh pot", async () => {
  const { run, asked } = subagentRun("answered");
  for (const _ of [1, 2]) {
    const turn = await buildReadingTurn(input({ runSubagentTurn: run }));
    await researchTool(turn!)
      .execute({ task: "first" })
      .catch(() => {});
  }
  expect(asked).toEqual([6, 6]);
});

// Cancellation, end to end: the AbortController App raises for a hangup is the turn's
// signal, and the turn's signal is the sub-agent's.
test("the reader's abort signal is the one the sub-agent runs under", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const run: SubagentTurnFn = async (request) => {
    seen = request.signal;
    // What the live runner does on abort: the agent loop returns silently and the
    // settler turns that into a rejection.
    controller.abort();
    throw new StoppedError();
  };
  const turn = await buildReadingTurn(input({ signal: controller.signal, runSubagentTurn: run }));
  const research = researchTool(turn!);

  await expect(research.execute({ task: "recent work" })).rejects.toBeInstanceOf(StoppedError);
  expect(seen).toBe(controller.signal);
  // And once the reader has hung up, a further call stops before anything is sent.
  seen = undefined;
  await expect(research.execute({ task: "recent work" })).rejects.toBeInstanceOf(StoppedError);
  expect(seen).toBeUndefined();
});

// --- the visual window around a highlight (figures/page-window.ts) ---

// Four pages of ordinary typeset prose, so the sparse-text arm of the gate stays
// shut and a test can say which arm it is exercising.
function dense(): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: Array.from({ length: 4 }, (_, i) => `Page ${i + 1}. `.repeat(120)),
    outline: [],
  };
}

// The rasterizer as the assembly sees it: records what it was asked for and
// hands back a page-shaped picture.
function pageRenderer() {
  const asked: { page: number; widthPx: number }[] = [];
  return {
    asked,
    render: async (page: number, widthPx: number) => {
      asked.push({ page, widthPx });
      return {
        data: `page-${page}`,
        mediaType: "image/jpeg",
        width: widthPx,
        height: Math.round(widthPx * 1.29),
      };
    },
  };
}

// A fresh thread id per test: the fake disk outlives dropThreadCache, so a test
// sharing "thread-1" inherits the forty messages an earlier one appended to it.
const withWindow = (
  threadId: string,
  renderPage: (p: number, w: number) => Promise<any>,
  over: Partial<Parameters<typeof buildReadingTurn>[0]> = {},
) =>
  input({
    threadId,
    fulltext: dense(),
    figures: [{ id: "1", page: 2, caption: "Inline cache layout", bbox: null }] as Figure[],
    renderPage,
    ...over,
  });

test("a marked page with a figure near it carries page images and says what they are", async () => {
  const r = pageRenderer();
  const turn = await buildReadingTurn(withWindow("win-1", r.render));
  // The marked page at full size, its neighbours smaller. Page 3 is off the end
  // of this four-page fixture's window only if the anchor is at the edge; here
  // the anchor is page 2, so the window is 1-3.
  expect(r.asked.map((a) => a.page)).toEqual([1, 2, 3]);
  expect(r.asked[1].widthPx).toBeGreaterThan(r.asked[0].widthPx);
  expect(r.asked[0].widthPx).toBe(r.asked[2].widthPx);
  const last = turn!.messages[turn!.messages.length - 1];
  expect(last.images?.map((i) => i.data)).toEqual(["page-1", "page-2", "page-3"]);
  expect(turn!.systemPrompt).toContain("p.2, the page their highlight is on");
});

test("a page of plain prose with no figures near it sends no images", async () => {
  const r = pageRenderer();
  const turn = await buildReadingTurn(
    input({ threadId: "win-2", fulltext: dense(), figures: [], renderPage: r.render }),
  );
  expect(r.asked).toEqual([]);
  expect(turn!.messages.some((m) => m.images?.length)).toBe(false);
  expect(turn!.systemPrompt).not.toContain("highlight is on");
});

// A scan has no text layer, so figure detection (caption-anchored) finds nothing
// on it. It is also the document that needs the pictures most.
test("a document with no text layer sends the pages anyway", async () => {
  const r = pageRenderer();
  const turn = await buildReadingTurn(
    input({ threadId: "win-3", fulltext: fulltext("no-text-layer"), figures: [], renderPage: r.render }),
  );
  expect(r.asked.map((a) => a.page)).toEqual([1, 2]);
  expect(turn!.messages[turn!.messages.length - 1].images).toHaveLength(2);
});

test("a text-only model is sent no page images and told about none", async () => {
  const r = pageRenderer();
  const turn = await buildReadingTurn(withWindow("win-4", r.render, { settings: tiny }));
  expect(r.asked).toEqual([]);
  expect(turn!.messages.some((m) => m.images?.length)).toBe(false);
  expect(turn!.systemPrompt).not.toContain("highlight is on");
});

// The book-level thread follows the reader's scrolling, so what an earlier turn
// of it showed cannot be reconstructed and the degraded line would be a guess.
test("the book-level thread sends no page images", async () => {
  const r = pageRenderer();
  const turn = await buildReadingTurn(
    withWindow("win-5", r.render, { annotationId: "", annotation: undefined }),
  );
  expect(r.asked).toEqual([]);
  expect(turn!.messages.some((m) => m.images?.length)).toBe(false);
});

// The hard one: however long the conversation runs, one window is in context.
test("only the turn being answered carries the pictures; older turns carry a line", async () => {
  createThread(BOOK, "ann-1", "win-6");
  appendMessage(BOOK, "win-6", { role: "ai", text: "a1", ts: 1 });
  appendMessage(BOOK, "win-6", { role: "user", text: "and the arrow?", ts: 2 });
  appendMessage(BOOK, "win-6", { role: "ai", text: "a2", ts: 3 });
  appendMessage(BOOK, "win-6", { role: "user", text: "and the axis?", ts: 4 });
  const r = pageRenderer();
  const turn = await buildReadingTurn(withWindow("win-6", r.render));
  const withImages = turn!.messages.filter((m) => m.images?.length);
  expect(withImages).toHaveLength(1);
  expect(withImages[0].text).toBe("and the axis?");
  // Every earlier user turn — the kickoff included, since it was the current
  // message when the thread opened — says what it was shown.
  const marker = "[page images of pp.1–3 were attached here]";
  expect(turn!.messages[0].text.endsWith(marker)).toBe(true);
  expect(turn!.messages[2].text).toBe(`and the arrow?\n\n${marker}`);
  // Assistant turns are left exactly as they were written.
  expect(turn!.messages[1].text).toBe("a1");
  expect(turn!.messages[3].text).toBe("a2");
});

// A render that fails is one image fewer, not a broken turn — and if every page
// fails there is nothing to announce.
test("a failing rasterizer leaves the turn without images and without the prompt line", async () => {
  const turn = await buildReadingTurn(withWindow("win-7", async () => null));
  expect(turn!.messages.some((m) => m.images?.length)).toBe(false);
  expect(turn!.systemPrompt).not.toContain("highlight is on");
});
