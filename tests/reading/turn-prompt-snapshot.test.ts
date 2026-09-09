// The reading turn's system prompt, whole, on two fixed inputs. The other tests
// here assert substrings, which is what catches a block that stopped being
// written; this one catches the opposite — a block that moved, a blank line that
// appeared, a paragraph that came out in a different order. The provider's cache
// matches on a prefix (docs/09), so a byte that moves in the stable half is a
// re-write of everything below it, and nothing else in the suite would say so.
//
// Recorded before the assembly moved onto the desk (docs/61) and kept as the
// guard that it came out the same afterwards. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import type { Fulltext } from "../../src/fulltext/types";
import type { Annotation } from "../../src/platform/app/reader-contract";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  createBookThread,
  createThread,
  rebuildThreadStoreForTests,
} from "../../src/platform/app/threads";
import type { Figure } from "../../src/reading/figures/types";
import { writePrepNote } from "../../src/reading/prep/papers/store";
import type { PrepPaper, PrepState } from "../../src/reading/prep/papers/types";
import type { SavedArticle } from "../../src/reading/saved-articles";
import { buildReadingTurn } from "../../src/reading/turn";
import { installAppData } from "../support/appdata-fake";

const BOOK = "book-hash";

function fulltext(): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: [
      "Chapter one talks about compilers.",
      "Page two: inline caches.",
      "Page three: deoptimization.",
    ],
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

function pipeline(state: PrepState | null) {
  return {
    snapshot: () => ({ state }),
    ingestSource: async () => {
      throw new Error("not called");
    },
    ingestCaptured: async () => {
      throw new Error("not called");
    },
  } as never;
}

function savedStore(list: SavedArticle[]) {
  return {
    any: async () => list.length > 0,
    all: async () => list,
    body: async () => ({ text: "the kept body", html: "<p>the kept body</p>" }),
  };
}

const savedArticle: SavedArticle = {
  id: "https://feed.test/piece",
  topicId: "brief",
  url: "https://feed.test/piece",
  title: "A kept piece",
  source: "feed",
  sourceName: "The Feed",
  publishedAt: "2026-07-20T08:00:00Z",
  savedAt: 1,
  summaryOnly: false,
  bodyHash: "0123456789abcdef0123456789abcdef",
  textChars: 13,
};

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

const figures: Figure[] = [{ id: "1", page: 2, caption: "Inline cache layout", source: { kind: "pdf" as const, bbox: null } }];

// Everything a turn can carry that does not need a canvas: a text layer, a
// chapter, a figure index, a prep run with a note on disk, a kept article, and a
// topic (so the memory paragraph and the observation tools ride).
function input(over: Record<string, unknown> = {}) {
  return {
    bookId: BOOK,
    threadId: "thread-1",
    annotationId: "ann-1",
    annotation: {
      id: "ann-1",
      text: "inline caches",
      comment: "why is this fast?",
      position: { pageIndex: 1 },
    } as unknown as Annotation,
    annotations: [] as Annotation[],
    fulltext: fulltext(),
    figures,
    buffer: null,
    context: {
      topicId: "topic-1",
      topicName: "JITs",
      fileName: "survey.pdf",
      pageLabel: "2",
      pageIndex: 1,
      files: [{ path: "/books/survey.pdf", name: "survey.pdf", hash: BOOK }],
    },
    settings,
    getPipeline: () => pipeline(prepState()),
    distillAnnotations: () => [],
    savedArticles: savedStore([savedArticle]),
    ...over,
  } as Parameters<typeof buildReadingTurn>[0];
}

beforeEach(async () => {
  installAppData();
  rebuildThreadStoreForTests();
  await writePrepNote(BOOK, "smith2023", "# Smith 2023\n\nThe note body, such as it is.\n");
});

test("the whole prompt of a marked passage's turn", async () => {
  createThread(BOOK, "ann-1", "thread-1");
  const turn = await buildReadingTurn(input());
  expect(turn).not.toBeNull();
  expect(turn!.systemPrompt).toMatchSnapshot();
});

test("the whole prompt of the book-level turn", async () => {
  createBookThread(BOOK, "book-thread");
  const turn = await buildReadingTurn(
    input({ threadId: "book-thread", annotationId: "", annotation: undefined }),
  );
  expect(turn).not.toBeNull();
  expect(turn!.systemPrompt).toMatchSnapshot();
});
