// The order a book opens in (src/reading/session/open-book). What the book being
// left is owed, what the next one must have before the pane is mounted, and what
// is joined only if the reader is still on the same book. No React. Run: bun test.

import { expect, test } from "bun:test";
import { openBook, openingViewState, type BookOpenIo } from "../../../src/reading/session/open-book";
import type { ReaderShell } from "../../../src/reading/session/shell";
import type { Annotation, ViewState } from "../../../src/platform/app/reader-contract";
import type { Fulltext } from "../../../src/fulltext";
import type { FiguresIndex } from "../../../src/reading/figures";

const FULLTEXT: Fulltext = { version: 1, status: "ok", pages: ["page one"], outline: [] };
const NO_TEXT: Fulltext = { version: 1, status: "no-text-layer", pages: [], outline: [] };
const FIGURES: FiguresIndex = {
  version: 2,
  figures: [{ id: "1", page: 2, caption: "Figure 1: a schematic", bbox: null }],
};

interface Call {
  name: string;
  args: unknown[];
}

// Every shell method records itself, so the test can read the sequence rather
// than guess at it. Overrides run after recording.
function fakeShell(log: Call[], over: Partial<Record<keyof ReaderShell, (...a: any[]) => unknown>> = {}) {
  return new Proxy(
    {},
    {
      get(_t, name: string) {
        return (...args: unknown[]) => {
          log.push({ name, args });
          return over[name as keyof ReaderShell]?.(...args);
        };
      },
    },
  ) as ReaderShell;
}

function fakeIo(log: Call[], over: Partial<BookOpenIo> = {}): BookOpenIo {
  const record =
    <T>(name: string, value: T) =>
    (...args: unknown[]) => {
      log.push({ name, args });
      return value;
    };
  return {
    getViewState: record("getViewState", Promise.resolve(null)),
    loadAnnotations: record("loadAnnotations", Promise.resolve([] as Annotation[])),
    loadThreads: record("loadThreads", Promise.resolve({})),
    ensureFulltext: record("ensureFulltext", Promise.resolve(FULLTEXT)),
    ensureFigures: record("ensureFigures", Promise.resolve(FIGURES)),
    clearFigureCache: record("clearFigureCache", undefined),
    seedReadingPosition: record("seedReadingPosition", undefined),
    sweepDistillation: record("sweepDistillation", undefined),
    ...over,
  };
}

const BYTES = new Uint8Array([1, 2, 3, 4]);
const book = { bookId: "book-1", name: "A Book.pdf", bytes: BYTES };

// Wait for the background extractions and everything chained onto them.
const settle = () => new Promise((r) => setTimeout(r, 0));

function names(log: Call[]): string[] {
  return log.map((c) => c.name);
}

function last(log: Call[], name: string): Call | undefined {
  const all = log.filter((c) => c.name === name);
  return all[all.length - 1];
}

// Both happened, and in this order. `indexOf` alone would pass for a step that
// stopped happening at all, which is the shape of failure this file is for.
function before(log: Call[], first: string, second: string): void {
  const order = names(log);
  expect(order).toContain(first);
  expect(order).toContain(second);
  expect(order.indexOf(first)).toBeLessThan(order.indexOf(second));
}

function argsOf(log: Call[], name: string): unknown[] {
  return log.find((c) => c.name === name)?.args ?? [];
}

test("the book being left is settled before anything of the next one is read", async () => {
  const log: Call[] = [];
  await openBook(fakeShell(log, { currentBookId: () => "book-1" }), book, fakeIo(log));

  const order = names(log);
  expect(order.slice(0, 7)).toEqual([
    "showStatus",
    "closeAnnotationPopup",
    "captureHangup",
    "sweepDistillation",
    "closeCall",
    "discardStagedImages",
    "clearSelectedMark",
  ]);
  // The hangup reads the refs of the book being left, so nothing may point at
  // the new one before it has run.
  before(log, "captureHangup", "takeBook");
});

test("a book opens with no tool held and nothing selected", async () => {
  const log: Call[] = [];
  await openBook(fakeShell(log), book, fakeIo(log));

  expect(names(log)).toContain("resetTool");
  expect(names(log)).toContain("clearSelectedMark");
});

test("marks that cannot be read cost their sentence, not the book", async () => {
  const log: Call[] = [];
  const io = fakeIo(log, { loadAnnotations: () => Promise.reject(new Error("EIO")) });
  await openBook(fakeShell(log), book, io);

  expect(argsOf(log, "pushToast")).toEqual(["warn", "Saved annotations could not be loaded"]);
  expect(argsOf(log, "showMarks")).toEqual([[]]);
  expect(names(log)).toContain("mountReader");
});

test("conversations that cannot be read say so in their own words", async () => {
  const log: Call[] = [];
  const io = fakeIo(log, { loadThreads: () => Promise.reject(new Error("EIO")) });
  await openBook(fakeShell(log), book, io);

  expect(argsOf(log, "pushToast")).toEqual(["warn", "Saved AI conversations could not be loaded"]);
  expect(names(log)).toContain("mountReader");
});

test("the marks that were read are what the pane is mounted with", async () => {
  const log: Call[] = [];
  const marks = [{ id: "a" } as unknown as Annotation];
  await openBook(fakeShell(log), book, fakeIo(log, { loadAnnotations: async () => marks }));

  expect(argsOf(log, "showMarks")).toEqual([marks]);
  expect((argsOf(log, "mountReader")[0] as { annotations: Annotation[] }).annotations).toBe(marks);
});

test("a book that never chose a layout opens scrolling", () => {
  expect(openingViewState(null)).toEqual({
    pageIndex: 0,
    scale: "auto",
    scrollMode: 0,
    layout: "vertical",
  });
  expect(openingViewState({ pageIndex: 4, scale: "auto", scrollMode: 0 } as ViewState).layout).toBe("vertical");
  expect(
    openingViewState({ pageIndex: 4, scale: "auto", scrollMode: 0, layout: "paged" } as ViewState).layout,
  ).toBe("paged");
});

test("the position the reader will move from is seeded before the pane is mounted", async () => {
  const log: Call[] = [];
  const state = { pageIndex: 12, scale: "auto", scrollMode: 0, layout: "paged" } as ViewState;
  await openBook(fakeShell(log), book, fakeIo(log, { getViewState: async () => state }));

  expect(argsOf(log, "seedReadingPosition")).toEqual(["book-1", state]);
  before(log, "seedReadingPosition", "mountReader");
  expect((argsOf(log, "mountReader")[0] as { viewState: ViewState }).viewState.pageIndex).toBe(12);
});

test("a classroom flag stored with the position comes back on", async () => {
  const log: Call[] = [];
  const state = { pageIndex: 0, scale: "auto", scrollMode: 0, classroom: true } as ViewState;
  const shell = fakeShell(log, { currentBookId: () => "book-1" });
  await openBook(shell, book, fakeIo(log, { getViewState: async () => state }));
  await settle();

  expect(argsOf(log, "resetPrep")).toEqual([true]);
  expect(argsOf(log, "resumePrep")).toEqual(["book-1", "A Book.pdf", FULLTEXT, true]);
});

test("a book opened without the flag starts its prep detached", async () => {
  const log: Call[] = [];
  await openBook(fakeShell(log, { currentBookId: () => "book-1" }), book, fakeIo(log));
  await settle();

  expect(argsOf(log, "resetPrep")).toEqual([false]);
  expect(argsOf(log, "resumePrep")).toEqual(["book-1", "A Book.pdf", FULLTEXT, false]);
  expect(argsOf(log, "resumeNotes")).toEqual(["book-1", "A Book.pdf", FULLTEXT]);
});

test("the full text and the figures land on the panels once they are extracted", async () => {
  const log: Call[] = [];
  await openBook(fakeShell(log, { currentBookId: () => "book-1" }), book, fakeIo(log));
  await settle();

  // Opening blanks both, and each is filled in when its own extraction lands.
  expect(log.filter((c) => c.name === "showFulltext").map((c) => c.args)).toEqual([
    [null, true],
    [FULLTEXT, false],
  ]);
  expect(log.filter((c) => c.name === "showFigures").map((c) => c.args)).toEqual([[[]], [FIGURES.figures]]);
});

test("a book with no text layer resumes neither panel", async () => {
  const log: Call[] = [];
  const io = fakeIo(log, { ensureFulltext: async () => NO_TEXT });
  await openBook(fakeShell(log, { currentBookId: () => "book-1" }), book, io);
  await settle();

  expect(argsOf(log, "showFulltext")).toEqual([null, true]);
  expect(last(log, "showFulltext")?.args).toEqual([NO_TEXT, false]);
  expect(names(log)).not.toContain("resumePrep");
  expect(names(log)).not.toContain("resumeNotes");
});

test("an extraction that lands after the reader moved on is thrown away", async () => {
  const log: Call[] = [];
  // The reader is on another book by the time either extraction resolves.
  await openBook(fakeShell(log, { currentBookId: () => "book-2" }), book, fakeIo(log));
  await settle();

  expect(log.filter((c) => c.name === "showFigures").map((c) => c.args)).toEqual([[[]]]);
  expect(log.filter((c) => c.name === "showFulltext").map((c) => c.args)).toEqual([[null, true]]);
  expect(names(log)).not.toContain("resumePrep");
});

test("a failed extraction leaves the panel empty instead of throwing", async () => {
  const log: Call[] = [];
  const io = fakeIo(log, {
    ensureFigures: () => Promise.reject(new Error("no pdfium")),
    ensureFulltext: () => Promise.reject(new Error("no pdfium")),
  });
  await openBook(fakeShell(log, { currentBookId: () => "book-1" }), book, io);
  await settle();

  expect(last(log, "showFigures")?.args).toEqual([[]]);
  expect(last(log, "showFulltext")?.args).toEqual([null, false]);
});

test("everything that reads the book reads the one copy of it", async () => {
  const log: Call[] = [];
  await openBook(fakeShell(log), book, fakeIo(log));

  const taken = argsOf(log, "takeBook");
  const mounted = argsOf(log, "mountReader")[0] as { buffer: ArrayBuffer };
  const extracted = argsOf(log, "ensureFigures");
  expect(taken[0]).toBe("book-1");
  expect(taken[1]).toBe("A Book.pdf");
  expect(mounted.buffer).toBe(taken[2] as ArrayBuffer);
  expect(extracted[1]).toBe(taken[2] as ArrayBuffer);
  // A copy: the bytes the caller read stay whole even after pdf.js detaches one.
  expect(new Uint8Array(mounted.buffer)).toEqual(BYTES);
  expect(mounted.buffer).not.toBe(BYTES.buffer);
});

test("the pane is mounted last, with the title", async () => {
  const log: Call[] = [];
  await openBook(fakeShell(log), book, fakeIo(log));

  expect(names(log).slice(-2)).toEqual(["mountReader", "showTitle"]);
  expect(argsOf(log, "showTitle")).toEqual(["A Book.pdf"]);
  // The engine is told it has nothing drawable before it is handed a document.
  before(log, "readerNotReady", "mountReader");
});
