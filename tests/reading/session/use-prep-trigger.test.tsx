// The two triggers as the shell actually calls them
// (src/reading/session/use-prep-trigger.ts): what the debounce does, that the
// entry press does not wait for it, that the document's own text picks which
// pipeline is started, and that a mark and a press never start two runs.
//
// Nothing is on disk here, so hasPrepState / hasNotesState both answer false
// through their own catch and the presence probe is honest about a fresh
// document. What is left under test is exactly the wiring.
//
// Run: bun test.
import { afterEach, expect, test } from "bun:test";
import { usePrepTrigger, type PrepTriggerHost } from "../../../src/reading/session/use-prep-trigger";
import { FULLTEXT_VERSION, type Fulltext } from "../../../src/fulltext/types";
import type { Annotation } from "../../../src/platform/app/reader-contract";
import { useDom } from "../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

// A document of `chars` characters carrying `citations` inline [N] markers —
// the same synthetic shape tests/fulltext/citations.test.ts measures with.
function doc(citations: number, chars: number): Fulltext {
  const body = "x".repeat(Math.max(0, chars - citations * 4));
  const marks = Array.from({ length: citations }, (_, i) => `[${(i % 99) + 1}]`).join("");
  return { version: FULLTEXT_VERSION, status: "ok", pages: [body + marks], outline: [] };
}

const BOOK = doc(12, 214_292); // 0.6 markers / 10k — a book
const PAPER = doc(721, 125_340); // 57.5 / 10k — a paper
const NO_TEXT: Fulltext = { version: FULLTEXT_VERSION, status: "no-text-layer", pages: [], outline: [] };

const MARK = { id: "a1", position: { pageIndex: 3 } } as unknown as Annotation;

interface Started {
  chapters: string[];
  papers: string[];
}

function harness(over: { fulltext?: Fulltext | null; marks?: Annotation[]; bookId?: string } = {}) {
  const started: Started = { chapters: [], papers: [] };
  const host: PrepTriggerHost = {
    bookIdRef: { current: over.bookId ?? "book-1" },
    ctxRef: { current: { fileName: "A Document.pdf" } },
    currentFulltextRef: {
      current: "fulltext" in over && over.fulltext === null ? null : Promise.resolve(over.fulltext ?? BOOK),
    },
    annsRef: { current: new Map((over.marks ?? []).map((a) => [a.id, a])) },
    startChapters: async (id) => {
      started.chapters.push(id);
    },
    startPapers: (id) => {
      started.papers.push(id);
    },
  };
  return { started, host };
}

// Let the debounce elapse and every promise inside fire() settle.
async function settle(ms = 0): Promise<void> {
  if (ms) await new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

// The real window is four seconds (MARK_DEBOUNCE); the hook takes it as an
// argument so this file does not have to spend them.
const DEBOUNCE = 10;

test("a mark starts nothing until the debounce elapses, then starts once", async () => {
  const { started, host } = harness({ marks: [MARK] });
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));

  await act(async () => {
    result.current.onMark();
    result.current.onMark();
    result.current.onMark();
    await settle();
  });
  expect(started.chapters).toEqual([]);

  await act(async () => {
    await settle(DEBOUNCE + 20);
  });
  expect(started.chapters).toEqual(["book-1"]);
  expect(started.papers).toEqual([]);
});

test("a mark on a document with nothing marked in it starts nothing", async () => {
  const { started, host } = harness({ marks: [] });
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));
  await act(async () => {
    result.current.onMark();
    await settle(DEBOUNCE + 20);
  });
  expect(started).toEqual({ chapters: [], papers: [] });
});

// The hole this whole change exists to close.
test("the entry starts a run on a document with no marks, without waiting", async () => {
  const { started, host } = harness({ marks: [] });
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));
  await act(async () => {
    result.current.onEntry();
    await settle();
  });
  expect(started.chapters).toEqual(["book-1"]);
});

// The dedup that matters: mark then press must not spend twice. The press
// answers the pending debounce, so only one start reaches a pipeline.
test("a press after a mark starts one run, not one each", async () => {
  const { started, host } = harness({ marks: [MARK] });
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));
  await act(async () => {
    result.current.onMark();
    result.current.onEntry();
    await settle(DEBOUNCE + 20);
  });
  expect(started.chapters).toEqual(["book-1"]);
  expect(started.papers).toEqual([]);
});

test("the document's own text picks the pipeline, for both triggers", async () => {
  const paper = harness({ fulltext: PAPER, marks: [MARK] });
  const paperHook = renderHook(() => usePrepTrigger(paper.host, DEBOUNCE));
  await act(async () => {
    paperHook.result.current.onEntry();
    await settle();
  });
  expect(paper.started.papers).toEqual(["book-1"]);
  expect(paper.started.chapters).toEqual([]);

  const book = harness({ fulltext: BOOK, marks: [MARK] });
  const bookHook = renderHook(() => usePrepTrigger(book.host, DEBOUNCE));
  await act(async () => {
    bookHook.result.current.onMark();
    await settle(DEBOUNCE + 20);
  });
  expect(book.started.chapters).toEqual(["book-1"]);
  expect(book.started.papers).toEqual([]);
});

test("a document with no text layer starts nothing, even from the entry", async () => {
  const { started, host } = harness({ fulltext: NO_TEXT, marks: [MARK] });
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));
  await act(async () => {
    result.current.onEntry();
    await settle();
  });
  expect(started).toEqual({ chapters: [], papers: [] });
});

test("nothing open starts nothing", async () => {
  const started: Started = { chapters: [], papers: [] };
  const host: PrepTriggerHost = {
    bookIdRef: { current: null },
    ctxRef: { current: { fileName: "" } },
    currentFulltextRef: { current: Promise.resolve(BOOK) },
    annsRef: { current: new Map() },
    startChapters: async (id) => void started.chapters.push(id),
    startPapers: (id) => void started.papers.push(id),
  };
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));
  await act(async () => {
    result.current.onEntry();
    result.current.onClose();
    await settle(DEBOUNCE + 20);
  });
  expect(started).toEqual({ chapters: [], papers: [] });
});

// Closing is the last moment a session's marks are all in, and the mark trigger
// is debounced, so the close runs the same decision without waiting for it.
test("closing runs the mark decision immediately", async () => {
  const { started, host } = harness({ marks: [MARK] });
  const { result } = renderHook(() => usePrepTrigger(host, DEBOUNCE));
  await act(async () => {
    result.current.onMark();
    result.current.onClose();
    await settle();
  });
  expect(started.chapters).toEqual(["book-1"]);

  // And the debounce it cancelled does not fire a second one later.
  await act(async () => {
    await settle(DEBOUNCE + 20);
  });
  expect(started.chapters).toEqual(["book-1"]);
});
