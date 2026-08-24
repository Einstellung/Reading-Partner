// Turn assembly for the reading companion (src/reading/turn). The branching
// that used to live inside App's runTurn closure: which tools get mounted in
// the figure/link-ingestion gates, what each turn inlines, and the history
// trim. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { REFUSE_MIDTURN, REFUSE_ROUNDS } from "../../src/ai/agent";
import type { SubagentTurnFn } from "../../src/ai/subagent";
import { StoppedError } from "../../src/ai/watchdog";
import { estimateTextTokens } from "../../src/budget";
import { getFulltext } from "../../src/fulltext/store";
import type { Fulltext } from "../../src/fulltext/types";
import type { Annotation } from "../../src/platform/app/reader-contract";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  appendMessage,
  createAsideThread,
  createBookThread,
  createThread,
  dropThreadCache,
  getThread,
  setThreadFocusChapter,
} from "../../src/platform/app/threads";
import type { Figure } from "../../src/reading/figures/types";
import { RESEARCH_TOOL_NAME, RESEARCH_TURN_ROUNDS } from "../../src/reading/papers/research-agent";
import { CLASSROOM_NOTE_BUDGET } from "../../src/reading/prep/papers/classroom";
import { paperFulltextHash, writePrepNote } from "../../src/reading/prep/papers/store";
import type { PrepPaper, PrepState } from "../../src/reading/prep/papers/types";
import type { SavedArticle } from "../../src/reading/saved-articles";
import {
  EXPLAIN_KICKOFF,
  HISTORY_KEEP,
  backgroundFailureToast,
  buildReadingTurn,
  turnFailureView,
} from "../../src/reading/turn";
import { installAppData } from "../support/appdata-fake";

// An empty in-memory AppData, so every optional read misses (the overview note,
// the observation index) and the turn treats them as "not there yet" — and so
// the one thing a turn here writes, the kept article's text going into the
// fulltext cache, can be read back the way read_paper would.

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
    settings,
    getPipeline: () => null,
    distillAnnotations: () => [],
    ...over,
  };
}

const names = (t: { name: string }[]) => t.map((x) => x.name).sort();

beforeEach(() => {
  installAppData();
  dropThreadCache(BOOK);
});

test("companion turn: reading tools only, kickoff as the first message", async () => {
  const turn = await buildReadingTurn(input());
  expect(turn).not.toBeNull();
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_chapter",
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
    "read_chapter",
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
    "read_chapter",
    "read_pages",
    "research_literature",
    "search_topic",
    "view_figure",
  ]);
  expect(turn!.systemPrompt).toContain("[fig:1]");
});

// The paper tools used to be mounted from two call sites guarded by opposite
// sides of the mode flag. There is one call site now, and it follows the data:
// a prep state exists, so read_paper and read_note have something to read.
test("a live pipeline mounts the source and paper tools, once", async () => {
  const turn = await buildReadingTurn(input({ getPipeline: () => pipeline(prepState()) }));
  expect(names(turn!.tools)).toEqual([
    "add_source",
    "find_paper",
    "read_chapter",
    "read_note",
    "read_pages",
    "read_paper",
    "research_literature",
    "search_topic",
  ]);
  expect(turn!.systemPrompt).toContain("add_source");
});

test("a pipeline with no plan yet mounts no paper tools", async () => {
  const turn = await buildReadingTurn(
    input({ getPipeline: () => pipeline(null) }),
  );
  expect(names(turn!.tools)).toEqual([
    "add_source",
    "find_paper",
    "read_chapter",
    "read_pages",
    "research_literature",
    "search_topic",
  ]);
});

// Kept info articles (docs/21). Two conditions, both necessary: a prep list to
// put one on, and a reader who has kept something.
test("kept articles mount the saved-article tools and their prompt line", async () => {
  const turn = await buildReadingTurn(
    input({
      getPipeline: () => pipeline(prepState()),
      savedArticles: savedStore([savedArticle()]),
    }),
  );
  expect(names(turn!.tools)).toEqual([
    "add_saved_article",
    "add_source",
    "find_paper",
    "list_saved_articles",
    "read_chapter",
    "read_note",
    "read_pages",
    "read_paper",
    "research_literature",
    "search_topic",
  ]);
  expect(turn!.systemPrompt).toContain("list_saved_articles");
  expect(turn!.systemPrompt).toContain("and only then");
});

test("no kept articles, or no prep list, means no saved-article tools", async () => {
  const cases = [
    // A prep list, nothing kept.
    input({ getPipeline: () => pipeline(prepState()) }),
    // Kept articles, but no prep list to put one on.
    input({ savedArticles: savedStore([savedArticle()]) }),
    // Kept articles and a pipeline, but no plan yet.
    input({ getPipeline: () => pipeline(null), savedArticles: savedStore([savedArticle()]) }),
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
  const turn = await buildReadingTurn(input());
  expect(names(turn!.tools)).toEqual([
    "find_paper",
    "read_chapter",
    "read_pages",
    "research_literature",
    "search_topic",
  ]);
  expect(turn!.systemPrompt).not.toContain("add_source");
});

// docs/24: the literature question can arrive on any page of any book, so the two
// literature tools are not gated on a prep pipeline or on the
// book having a text layer — unlike everything else here.
test("the literature tools are mounted on every reading turn, with their prompt lines", async () => {
  const cases = [
    input(),
    input(),
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
    input({ getPipeline: () => pipeline(prepState()) }),
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

// --- what a turn on a prepped book carries (docs/09) ---

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
    input({ getPipeline: () => pipeline(chaptered(papers)) }),
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
    input({ getPipeline: () => pipeline(chaptered(papers)) }),
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
    input({ getPipeline: () => pipeline(chaptered(papers)) }),
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

test("the paper tools are announced only once a prep run exists", async () => {
  const none = await buildReadingTurn(input());
  expect(none!.systemPrompt).not.toContain("read_paper");
  expect(none!.systemPrompt).not.toContain("read_note");

  const prepped = await buildReadingTurn(
    input({ getPipeline: () => pipeline(prepState()) }),
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
// A mark drawn on a reply (src/reading/chat-marks.ts). Anchored on the message,
// so it has no page and never goes near the engine.
function chatMark(threadId: string, messageTs: number, text: string): Annotation {
  return {
    id: `chat-${threadId}-${messageTs}`,
    type: "underline",
    text,
    chatAnchor: { threadId, messageTs, text, occurrence: 0, pen: "ai" },
  } as unknown as Annotation;
}

// docs/09: the AI's answers are the book continued, so a reply the reader drew
// on comes back saying which words those were. The note rides the message, so it
// falls out of context with it and it never enters the prompt's stable half —
// the provider's cache prefix — where one new mark would rewrite the chapter.
test("a reply the reader marked replays with the marked words named after it", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  appendMessage(BOOK, "thread-1", { role: "user", text: "why three matrices", ts: 1 });
  appendMessage(BOOK, "thread-1", { role: "ai", text: "Query, key and value.", ts: 2 });
  const marked = chatMark("thread-1", 2, "key and value");

  const plain = await buildReadingTurn(input());
  const turn = await buildReadingTurn(input({ annotations: [marked] }));

  expect(plain!.messages.map((m) => m.text)).toEqual(["why three matrices", "Query, key and value."]);
  expect(turn!.messages[1].text).toBe(
    'Query, key and value.\n\n[marked by the reader in this reply: “key and value”]',
  );
  // The reader's own message is left alone, and so is the prompt.
  expect(turn!.messages[0].text).toBe("why three matrices");
  expect(turn!.systemPrompt).not.toContain("marked by the reader");
});

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
  expect(turn!.systemPrompt).not.toContain("Marked passage");
  expect(turn!.systemPrompt).not.toContain("Text around the marked passage");
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

// --- the three loads (docs/09) ---

// A book that lands in the whole-book tier: 30 pages of CJK is 30k on the raw
// estimate, 45k once the measured shortfall is added back, which is exactly the
// bar. The tier is what bounds an inlined book now, so the budget ladder below
// is not what keeps a 400-page textbook out of the prompt — this is.
const INLINE_BOOK = cjkSurvey(30);

test("a book inside the whole-book tier is inlined page by page, under its anchors", async () => {
  const turn = await buildReadingTurn(input({ fulltext: INLINE_BOOK }));
  expect(turn!.inline).toBe("whole");
  expect(turn!.systemPrompt).toContain("=== Page 2 === [p.2]");
  expect(turn!.systemPrompt).toContain("the full text of");
  expect(turn!.notice).toBe("");
});

// The 401-page textbook: nothing is inlined, and the prompt says so rather than
// leaving the model to infer it from an absence.
test("a book past the tier is not inlined at all, and the prompt says what it has", async () => {
  const turn = await buildReadingTurn(input({ fulltext: cjkSurvey(300) }));
  expect(turn!.inline).toBe("none");
  expect(turn!.systemPrompt).not.toContain("=== Page 2 ===");
  expect(turn!.systemPrompt).toContain("What you have in this turn's prompt");
  expect(turn!.systemPrompt).toContain("No text from");
  expect(names(turn!.tools)).toContain("read_pages");
  expect(names(turn!.tools)).toContain("read_chapter");
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

// The tier decides what is inlined; the ladder is what happens when even that
// does not fit beside the notes and the conversation. Both rungs fire here, in
// the ladder's order, and the reader is told about both.
test("the narrowest window gives up the notes and then the book, and says so", async () => {
  const papers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => notePaper(`tight-${i}`, [1]));
  for (const p of papers) await writePrepNote(BOOK, p.slug, "书".repeat(5_000));
  createThread(BOOK, "ann-1", "thread-1");
  for (let i = 0; i < HISTORY_KEEP; i++) {
    appendMessage(BOOK, "thread-1", {
      role: i % 2 === 0 ? "user" : "ai",
      text: "编译器内联缓存".repeat(300),
      ts: i + 1,
    });
  }
  const turn = await buildReadingTurn(
    input({
      fulltext: INLINE_BOOK,
      settings: tiny,
      getPipeline: () => pipeline(chaptered(papers)),
    }),
  );
  expect(turn!.refusal).toBe("");
  expect(turn!.notice).toBe(
    "Note: some of my notes on the reference papers were left out to make room; this didn't " +
      "fit in context, so I read the pages I needed instead of having it all in view.",
  );
  expect(turn!.systemPrompt).not.toContain("=== Page 2 === [p.2]");
  expect(names(turn!.tools)).toContain("read_pages");
  expect(names(turn!.tools)).toContain("read_chapter");
});

// The order the ladder gives things up in, seen from the path that uses it
// rather than from the table. The figure catalog is redundancy and goes first,
// silently; the inlined book is evidence and is said out loud; the conversation
// is last, because the fallback distillation that is meant to preserve an older
// stretch of it is fired and forgotten, so trimming early is a straight loss.
test("the reading ladder drops the catalog, then the book, and leaves the conversation whole", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  for (let i = 0; i < HISTORY_KEEP + 10; i++) {
    appendMessage(BOOK, "thread-1", {
      role: i % 2 === 0 ? "user" : "ai",
      text: `m${i} ${"编译器内联缓存".repeat(380)}`,
      ts: i,
    });
  }
  const figures: Figure[] = [{ id: "1", page: 2, caption: "内联缓存布局", bbox: null }];
  const turn = await buildReadingTurn(
    input({ fulltext: INLINE_BOOK, figures, settings: tiny }),
  );
  expect(turn!.refusal).toBe("");
  // Silent rung: gone from the prompt, absent from the notice.
  expect(turn!.systemPrompt).not.toContain("[fig:1]");
  // Evidence rung: gone, and the notice says exactly this and nothing else.
  expect(turn!.systemPrompt).not.toContain("=== Page 2 === [p.2]");
  expect(turn!.notice).toBe(
    "Note: this didn't fit in context, so I read the pages I needed instead of having it all in view.",
  );
  // Below the book on the ladder, so it was never reached: the full replay tail
  // is still here, ending on the most recent turn. No kickoff in front of it —
  // this tail happens to start on a user message, so it needs no stand-in.
  expect(turn!.messages.length).toBe(HISTORY_KEEP);
  expect(turn!.messages[turn!.messages.length - 1].text.startsWith(`m${HISTORY_KEEP + 9} `)).toBe(
    true,
  );
});

test("a model the catalog doesn't know skips the budget rather than blocking the turn", async () => {
  const turn = await buildReadingTurn(
    input({ fulltext: INLINE_BOOK, settings: { ...settings, defaultModelId: "no-such-model" } }),
  );
  expect(turn!.notice).toBe("");
  expect(turn!.refusal).toBe("");
  expect(turn!.systemPrompt).toContain("=== Page 2 === [p.2]");
});

test("a figure the conversation has already cited keeps its catalog", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  appendMessage(BOOK, "thread-1", { role: "ai", text: "see [fig:1] for the layout", ts: 1 });
  const figures: Figure[] = [{ id: "1", page: 2, caption: "内联缓存布局", bbox: null }];
  const turn = await buildReadingTurn(
    input({ fulltext: cjkSurvey(300), figures, settings: small }),
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

// A fresh thread id per test. dropThreadCache does not clear the thread store's
// cache — it re-reads the file over it, and a thread the cache already holds
// wins — so a test sharing "thread-1" inherits the forty messages an earlier one
// appended to it.
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

// --- the chapter in focus (docs/09) ---

// A book with a usable chapter table: three chapters, each with body text behind
// it, and a title carrying the number the reader would say.
function chaptersBook(): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: Array.from({ length: 90 }, (_, i) => `page ${i + 1} ${"编译器内联缓存".repeat(120)}`),
    outline: [
      { title: "第 1 章 一", page: 1, level: 0 },
      { title: "第 2 章 二", page: 31, level: 0 },
      { title: "第 3 章 编码注意力机制", page: 61, level: 0 },
    ],
  };
}

test("a usable chapter table reaches the prompt and read_chapter takes a number", async () => {
  const turn = await buildReadingTurn(
    input({ annotationId: "", annotation: undefined, fulltext: chaptersBook() }),
  );
  expect(turn!.systemPrompt).toContain("This book's chapters, with the pages each one spans:");
  expect(turn!.systemPrompt).toContain("[ch.3] 第 3 章 编码注意力机制 — p.61-90");
  const tool = turn!.tools.find((t) => t.name === "read_chapter")!;
  expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual(["chapter"]);
});

// The 67-page bilingual survey: no usable outline, and past the first tier.
// Without the page-range form the only thing left on it is ten pages at a time.
test("no usable chapter table leaves read_chapter taking a page range", async () => {
  const turn = await buildReadingTurn(
    input({ annotationId: "", annotation: undefined, fulltext: cjkSurvey(300) }),
  );
  expect(turn!.systemPrompt).not.toContain("This book's chapters");
  const tool = turn!.tools.find((t) => t.name === "read_chapter")!;
  expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual([
    "from",
    "to",
  ]);
});

test("a chapter in focus is the chapter that gets inlined, every turn", async () => {
  createBookThread(BOOK, "book-thread");
  setThreadFocusChapter(BOOK, "book-thread", 3);
  const turn = await buildReadingTurn(
    input({
      threadId: "book-thread",
      annotationId: "",
      annotation: undefined,
      fulltext: chaptersBook(),
    }),
  );
  expect(turn!.inline).toBe("chapter");
  expect(turn!.systemPrompt).toContain("=== Page 61 === [p.61]");
  expect(turn!.systemPrompt).not.toContain("=== Page 60 === [p.60]");
  expect(turn!.systemPrompt).toContain("This conversation is on chapter 3");
  expect(turn!.systemPrompt).toContain('the full text of chapter 3 ("第 3 章 编码注意力机制")');
});

// The book-level thread is the one that keeps a chapter. A marked passage's
// conversation may be asked to teach chapter 3 and gets it, but it stays a
// conversation about the mark: no focus written, nothing on a status row.
test("read_chapter parks the book-level thread on a chapter, and a mark's thread on nothing", async () => {
  createBookThread(BOOK, "book-thread");
  const book = await buildReadingTurn(
    input({
      threadId: "book-thread",
      annotationId: "",
      annotation: undefined,
      fulltext: chaptersBook(),
    }),
  );
  await book!.tools.find((t) => t.name === "read_chapter")!.execute({ chapter: 2 });
  expect(getThread(BOOK, "book-thread")?.focusChapter).toBe(2);

  createThread(BOOK, "ann-1", "mark-thread");
  const mark = await buildReadingTurn(input({ threadId: "mark-thread", fulltext: chaptersBook() }));
  const out = (await mark!.tools
    .find((t) => t.name === "read_chapter")!
    .execute({ chapter: 2 })) as string;
  // It answered with the chapter all the same.
  expect(out).toContain("=== Page 31 === [p.31]");
  expect(getThread(BOOK, "mark-thread")?.focusChapter).toBeUndefined();
});

// --- asides (docs/03) ---

// The lesson and an aside off it, on a book with a chapter table and a focus.
function lessonWithAside(suffix: string, anchorTs: number | null): { lesson: string; aside: string } {
  const lesson = `lesson-${suffix}`;
  const aside = `aside-${suffix}`;
  createBookThread(BOOK, lesson);
  setThreadFocusChapter(BOOK, lesson, 3);
  createAsideThread(BOOK, aside, {
    parentThreadId: lesson,
    ...(anchorTs === null
      ? {}
      : { asideAnchor: { messageTs: anchorTs, text: "编码注意力机制 as a routing problem" } }),
  });
  return { lesson, aside };
}

function bookTurn(threadId: string) {
  return input({
    threadId,
    annotationId: "",
    annotation: undefined,
    fulltext: chaptersBook(),
  });
}

// The single most important property of the whole feature. A provider's prompt
// cache matches on a prefix, so an aside whose stable half differs anywhere
// rewrites the inlined chapter — ~82k tokens on a measured turn — instead of
// reading it back.
test("an aside's prompt is the lesson's up to the position, byte for byte", async () => {
  const { lesson, aside } = lessonWithAside("cache", 4);
  const lessonTurn = await buildReadingTurn(bookTurn(lesson));
  const asideTurn = await buildReadingTurn(bookTurn(aside));

  const stable = (out: string): string => out.slice(0, out.indexOf("Current reading context:"));
  expect(stable(asideTurn!.systemPrompt)).toBe(stable(lessonTurn!.systemPrompt));
  // And it is the expensive half that matched, not an empty prefix.
  expect(stable(asideTurn!.systemPrompt)).toContain("=== Page 61 === [p.61]");
});

// The same property for the flavour that has a page of its own, on a lesson
// with no chapter in focus — where the prep notes are ordered by where the
// reader is. A mark two chapters away re-sorts them, and that block sits in the
// stable half above the spine and the overview, so the prefix would end there
// and everything under it would be written again.
test("an aside drawn far from the reader's page still matches the lesson's prompt", async () => {
  const papers = [
    notePaper("near-a", [2]),
    notePaper("near-b", [2]),
    notePaper("far-a", [7]),
    notePaper("far-b", [7]),
  ];
  for (const p of papers) await writePrepNote(BOOK, p.slug, `body of ${p.slug}`);
  // The reader is on page 2; the mark the aside was drawn on is on page 7.
  const far = { id: "ann-far", text: "a sentence on page seven", position: { pageIndex: 6 } } as unknown as Annotation;
  const withPrep = {
    getPipeline: () => pipeline(chaptered(papers)),
    annotations: [far],
    fulltext: chaptersBook(),
  };

  createBookThread(BOOK, "lesson-far");
  createAsideThread(BOOK, "aside-far", { parentThreadId: "lesson-far", annotationId: "ann-far" });

  const lessonTurn = await buildReadingTurn(
    input({ ...withPrep, threadId: "lesson-far", annotationId: "", annotation: undefined }),
  );
  const asideTurn = await buildReadingTurn(
    input({ ...withPrep, threadId: "aside-far", annotationId: "ann-far", annotation: far }),
  );

  const stable = (out: string): string => out.slice(0, out.indexOf("Current reading context:"));
  expect(stable(asideTurn!.systemPrompt)).toBe(stable(lessonTurn!.systemPrompt));
  expect(stable(asideTurn!.systemPrompt)).toContain("body of near-a");
});

// The focus is what puts the chapter's body in the prompt, overrides the
// position line, picks the observation window and orders the prep notes. An
// aside that lost it would be answering about a sentence from a chapter it can
// no longer see.
test("an aside inherits the chapter its parent is parked on", async () => {
  const { aside } = lessonWithAside("focus", 4);
  const turn = await buildReadingTurn(bookTurn(aside));

  expect(turn!.inline).toBe("chapter");
  expect(turn!.systemPrompt).toContain("=== Page 61 === [p.61]");
  expect(turn!.systemPrompt).toContain("The lesson this came out of is on chapter 3");
  expect(turn!.systemPrompt).toContain('the full text of chapter 3 ("第 3 章 编码注意力机制")');
});

// The span goes where a marked passage goes — tier 0 on the ladder, never
// dropped — and is stored as text, so this is the string the reader selected.
test("a chat-span aside carries its span and says where it came from", async () => {
  const { aside } = lessonWithAside("span", 4);
  const turn = await buildReadingTurn(bookTurn(aside));

  expect(turn!.systemPrompt).toContain(
    'wrote earlier in the lesson: "编码注意力机制 as a routing problem"',
  );
  expect(turn!.systemPrompt).toContain("This turn is a side conversation");
  expect(turn!.systemPrompt).toContain("pulled one\nsentence out of the lesson");
  // Page-anchored blocks have no meaning for words out of a reply.
  expect(turn!.systemPrompt).not.toContain("Text around the marked passage");
  expect(turn!.messages.some((m) => m.images?.length)).toBe(false);
});

// The tail the aside opens on: the message the span came from, back through
// three of the reader's questions, then this conversation's own messages.
test("an aside replays the stretch of the lesson its span came out of", async () => {
  const { lesson, aside } = lessonWithAside("history", 4);
  const said = [
    { role: "user" as const, text: "u1", ts: 1 },
    { role: "ai" as const, text: "a1", ts: 2 },
    { role: "user" as const, text: "u2", ts: 3 },
    { role: "ai" as const, text: "a2", ts: 4 },
    { role: "user" as const, text: "u3", ts: 5 },
    { role: "ai" as const, text: "a3", ts: 6 },
  ];
  for (const m of said) appendMessage(BOOK, lesson, m);
  appendMessage(BOOK, aside, { role: "user", text: "what does routing mean here", ts: 7 });

  const turn = await buildReadingTurn(bookTurn(aside));
  expect(turn!.messages.map((m) => m.text)).toEqual([
    "u1",
    "a1",
    "u2",
    "a2",
    "what does routing mean here",
  ]);
  // Nothing is copied onto the aside's own record.
  expect(getThread(BOOK, aside)?.messages.map((m) => m.text)).toEqual([
    "what does routing mean here",
  ]);
});

// Whether the lesson's stretch is there is a fact about the assembled turn, and
// the prompt has to follow it: an aside whose parent is gone replays nothing of
// it, and one long enough to fill the history on its own trims it off the front.
test("an aside with no lesson replayed does not claim to open on one", async () => {
  createAsideThread(BOOK, "aside-orphan", { parentThreadId: "no-such-lesson" });
  appendMessage(BOOK, "aside-orphan", { role: "user", text: "about that", ts: 1 });
  const orphan = await buildReadingTurn(bookTurn("aside-orphan"));

  expect(orphan!.systemPrompt).toContain("None of the lesson itself is replayed");
  expect(orphan!.systemPrompt).not.toContain("open on the stretch of the lesson");
  expect(orphan!.messages.map((m) => m.text)).toEqual(["about that"]);

  // And the same when it is the length of this conversation that pushed it out.
  const { lesson, aside } = lessonWithAside("crowded", 2);
  appendMessage(BOOK, lesson, { role: "user", text: "u1", ts: 1 });
  appendMessage(BOOK, lesson, { role: "ai", text: "a1", ts: 2 });
  for (let i = 0; i < HISTORY_KEEP; i++) {
    appendMessage(BOOK, aside, { role: i % 2 === 0 ? "user" : "ai", text: `s${i}`, ts: 100 + i });
  }
  const crowded = await buildReadingTurn(bookTurn(aside));
  expect(crowded!.messages).toHaveLength(HISTORY_KEEP);
  expect(crowded!.systemPrompt).toContain("None of the lesson itself is replayed");
});

// The lesson's stretch is replayed history too, so a reply marked in the lesson
// says so inside the aside as well — including the very passage the aside was
// pulled out of.
test("the lesson's replayed stretch carries what was marked on it", async () => {
  const { lesson, aside } = lessonWithAside("marked", 2);
  appendMessage(BOOK, lesson, { role: "user", text: "u1", ts: 1 });
  appendMessage(BOOK, lesson, { role: "ai", text: "a1", ts: 2 });
  appendMessage(BOOK, aside, { role: "user", text: "about that", ts: 3 });

  const turn = await buildReadingTurn({
    ...bookTurn(aside),
    annotations: [chatMark(lesson, 2, "a1")],
  });
  expect(turn!.messages.map((m) => m.text)).toEqual([
    "u1",
    "a1\n\n[marked by the reader in this reply: “a1”]",
    "about that",
  ]);
});

// Every provider wants the exchange to open on a user turn, and an aside's tail
// legitimately opens on a reply. The mark thread's stand-in would send the model
// looking for a passage the prompt does not carry.
test("a tail that opens on a reply gets the aside's own stand-in, not the mark's", async () => {
  const { lesson, aside } = lessonWithAside("kickoff", 1);
  appendMessage(BOOK, lesson, { role: "ai", text: "a0", ts: 1 });
  appendMessage(BOOK, aside, { role: "user", text: "about that", ts: 2 });

  const turn = await buildReadingTurn(bookTurn(aside));
  expect(turn!.messages[0].role).toBe("user");
  expect(turn!.messages[0].text).not.toBe(EXPLAIN_KICKOFF);
  expect(turn!.messages.map((m) => m.text).slice(1)).toEqual(["a0", "about that"]);
});

// An aside drawn on the page has a mark and a page, so it is a marked passage
// like any other and gets the blocks that go with one.
test("an aside drawn on the page keeps the mark-anchored blocks", async () => {
  createBookThread(BOOK, "lesson-drawn");
  createAsideThread(BOOK, "aside-drawn", {
    parentThreadId: "lesson-drawn",
    annotationId: "ann-1",
  });
  const turn = await buildReadingTurn(
    input({ threadId: "aside-drawn", fulltext: chaptersBook() }),
  );

  expect(turn!.systemPrompt).toContain('- Marked passage: "inline caches"');
  expect(turn!.systemPrompt).toContain("marked a\npassage on the page mid-lesson");
  expect(turn!.systemPrompt).not.toContain("taken by the reader out of something you");
});

// Writing a focus on itself would be dead — the focus it reads is the parent's —
// and writing one on the parent would let a side conversation move the lesson
// the reader is going back to.
test("read_chapter on an aside parks nothing, on either end", async () => {
  const { lesson, aside } = lessonWithAside("park", 4);
  const turn = await buildReadingTurn(bookTurn(aside));
  const out = (await turn!.tools
    .find((t) => t.name === "read_chapter")!
    .execute({ chapter: 2 })) as string;

  expect(out).toContain("=== Page 31 === [p.31]");
  expect(getThread(BOOK, aside)?.focusChapter).toBeUndefined();
  expect(getThread(BOOK, lesson)?.focusChapter).toBe(3);
});
