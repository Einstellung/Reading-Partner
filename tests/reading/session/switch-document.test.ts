// Stepping between the book and one of its supplements without leaving the
// reading session (src/reading/session/open-book.ts: switchDocument, docs/67).
// The whole point of the mode is what it does *not* do, so that is what this
// file pins. No React. Run: bun test.

import { expect, test } from "bun:test";
import { openBook, switchDocument, type BookOpenIo } from "../../../src/reading/session/open-book";
import type { ReaderShell } from "../../../src/reading/session/shell";
import type { Annotation, ViewState } from "../../../src/platform/app/reader-contract";
import type { Fulltext } from "../../../src/fulltext";
import { FIGURES_VERSION, type FiguresIndex } from "../../../src/reading/figures";

const BOOK_TEXT: Fulltext = { version: 1, status: "ok", pages: ["the book"], outline: [] };
const SUPP_TEXT: Fulltext = { version: 1, status: "ok", pages: ["the article"], outline: [] };
const FIGURES: FiguresIndex = { version: FIGURES_VERSION, status: "ok", figures: [] };

interface Call {
  name: string;
  args: unknown[];
}

function fakeShell(log: Call[], docId: () => string | null): ReaderShell {
  return new Proxy(
    {},
    {
      get(_t, name: string) {
        return (...args: unknown[]) => {
          log.push({ name, args });
          if (name === "currentDocId") return docId();
          if (name === "resumePrep" || name === "resumeChapterSpine") return Promise.resolve();
          return undefined;
        };
      },
    },
  ) as ReaderShell;
}

const BOOK_BYTES = new Uint8Array([1, 1, 1]);
const SUPP_BYTES = new Uint8Array([2, 2, 2]);

function fakeIo(log: Call[]): BookOpenIo {
  const record =
    <T>(name: string, value: (id: string) => T) =>
    (...args: unknown[]) => {
      log.push({ name, args });
      return value(String(args[0]));
    };
  return {
    getViewState: record("getViewState", () => Promise.resolve(null as ViewState | null)),
    loadAnnotations: record("loadAnnotations", () => Promise.resolve([] as Annotation[])),
    loadThreads: record("loadThreads", () => Promise.resolve({})),
    ensureFulltext: record("ensureFulltext", (id) =>
      Promise.resolve(id === "book-1" ? BOOK_TEXT : SUPP_TEXT),
    ),
    ensureFigures: record("ensureFigures", () => Promise.resolve(FIGURES)),
    clearFigureCache: record("clearFigureCache", () => undefined),
    seedReadingPosition: record("seedReadingPosition", () => undefined),
    sweepDistillation: record("sweepDistillation", () => undefined),
  };
}

const supplement = {
  bookId: "book-1",
  docId: "supp-1",
  name: "An Article",
  bytes: SUPP_BYTES,
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const names = (log: Call[]) => log.map((c) => c.name);
const argsOf = (log: Call[], name: string) => log.filter((c) => c.name === name).map((c) => c.args);
// No Array.prototype.at: the test tsconfig's lib does not have it (pitfall 320).
const lastOf = (log: Call[], name: string): unknown[] | undefined => {
  const all = argsOf(log, name);
  return all[all.length - 1];
};

test("a document switch settles nothing: the conversation and the prep run go on", async () => {
  const log: Call[] = [];
  await switchDocument(fakeShell(log, () => "supp-1"), supplement, fakeIo(log));
  await settle();

  for (const skipped of [
    "captureHangup",
    "closeCall",
    "endBookTurns",
    "sweepDistillation",
    "discardStagedImages",
    "resetPrep",
    "resetChapterSpine",
    "resumePrep",
    "resumeChapterSpine",
    "takeSession",
    "finalPassPrep",
  ]) {
    expect(names(log)).not.toContain(skipped);
  }
});

test("everything sliced off the bytes follows the document on screen", async () => {
  const log: Call[] = [];
  await switchDocument(fakeShell(log, () => "supp-1"), supplement, fakeIo(log));
  await settle();

  for (const perDoc of [
    "getViewState",
    "loadAnnotations",
    "loadThreads",
    "seedReadingPosition",
    "ensureFulltext",
    "ensureFigures",
  ]) {
    expect(argsOf(log, perDoc)[0]?.[0]).toBe("supp-1");
  }
  expect(argsOf(log, "takeDoc")[0]?.[0]).toBe("supp-1");
  expect(names(log)).toContain("readerNotReady");
  expect(lastOf(log, "showTitle")?.[0]).toBe("An Article");
  const mounted = argsOf(log, "mountReader")[0]?.[0] as { docId: string; buffer: ArrayBuffer };
  expect(mounted.docId).toBe("supp-1");
  expect([...new Uint8Array(mounted.buffer)]).toEqual([2, 2, 2]);
});

test("the book's own text is kept for the outline, and the supplement's is not", async () => {
  const log: Call[] = [];
  const io = fakeIo(log);
  let showing = "book-1";
  const shell = fakeShell(log, () => showing);
  await openBook(shell, { bookId: "book-1", name: "A Book", bytes: BOOK_BYTES }, io);
  await settle();
  expect(lastOf(log, "keepBookFulltext")).toEqual([BOOK_TEXT, false]);

  log.length = 0;
  showing = "supp-1";
  await switchDocument(shell, supplement, io);
  await settle();
  // The reading pane is told about the supplement; the outline is not.
  expect(lastOf(log, "showFulltext")).toEqual([SUPP_TEXT, false]);
  expect(names(log)).not.toContain("keepBookFulltext");
});

test("going back to the book hands the engine the book's bytes again", async () => {
  const log: Call[] = [];
  const io = fakeIo(log);
  let showing = "supp-1";
  const shell = fakeShell(log, () => showing);
  await switchDocument(shell, supplement, io);
  log.length = 0;
  showing = "book-1";
  await switchDocument(
    shell,
    { bookId: "book-1", docId: "book-1", name: "A Book", bytes: BOOK_BYTES },
    io,
  );
  await settle();

  const mounted = argsOf(log, "mountReader")[0]?.[0] as { docId: string; buffer: ArrayBuffer };
  expect(mounted.docId).toBe("book-1");
  expect([...new Uint8Array(mounted.buffer)]).toEqual([1, 1, 1]);
  expect(lastOf(log, "showTitle")?.[0]).toBe("A Book");
  // Back on the book, its text is the outline's again.
  expect(lastOf(log, "keepBookFulltext")).toEqual([BOOK_TEXT, false]);
  // And still no session bookkeeping: this was one session all along.
  expect(names(log)).not.toContain("sweepDistillation");
});
