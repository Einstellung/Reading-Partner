// The order a book opens in on the phone (docs/70): the pages before the marks,
// the position seeded before the pane is handed anything, and what leaving the
// book still owes. A fake io, so none of it needs a webview. Run: bun test.

import { expect, test } from "bun:test";
import type { Fulltext } from "../../../src/fulltext/types";
import type { FiguresIndex } from "../../../src/reading/figures";
import type { Annotation, ViewState } from "../../../src/platform/app/reader-contract";
import {
  closePhoneBook,
  cuttingStatus,
  mergeSavedMarks,
  openPhoneBook,
  phoneViewState,
  type PhoneBookIo,
} from "../../../src/reading/session/open-epub";

const MARK: Annotation = {
  id: "m1",
  type: "highlight",
  color: "#ffd54f",
  position: { pageIndex: 3, rects: [] },
} as unknown as Annotation;

// A mark drawn on an AI reply: no page under it, so the pane never sees it.
const CHAT_MARK: Annotation = {
  id: "m2",
  type: "highlight",
  color: "#ffd54f",
  chatAnchor: { threadId: "t", messageTs: 1, text: "a phrase", occurrence: 0, pen: "underline" },
} as unknown as Annotation;

const FULLTEXT = { status: "ok", pages: ["one", "two"], outline: [] } as unknown as Fulltext;
const FIGURES = { figures: [] } as unknown as FiguresIndex;

function fakeIo(log: string[], over: Partial<PhoneBookIo> = {}): PhoneBookIo {
  return {
    async readBook() {
      log.push("readBook");
      return new Uint8Array([1, 2, 3]);
    },
    async getViewState() {
      log.push("getViewState");
      return null;
    },
    async prepare(_id, _buffer, onProgress) {
      log.push("prepare");
      onProgress(1, 4);
      return { outline: [{ title: "One", page: 2, level: 0 }], recut: false };
    },
    async loadAnnotations() {
      log.push("loadAnnotations");
      return [MARK, CHAT_MARK];
    },
    async ensureFulltext(_id, _buffer, stale) {
      log.push(`ensureFulltext stale=${stale}`);
      return FULLTEXT;
    },
    async ensureFigures(_id, _buffer, stale) {
      log.push(`ensureFigures stale=${stale}`);
      return FIGURES;
    },
    clearFigureCache() {
      log.push("clearFigureCache");
    },
    seedReadingPosition() {
      log.push("seedReadingPosition");
    },
    keepReadingPosition() {
      log.push("keepReadingPosition");
    },
    release() {
      log.push("release");
    },
    async markOpened() {
      log.push("markOpened");
    },
    ...over,
  };
}

test("the pages are cut before the marks are read", async () => {
  const log: string[] = [];
  const status: (string | null)[] = [];
  const opened = await openPhoneBook("b1", fakeIo(log), (line) => status.push(line));
  // A mark's page number is read off the table that was just written, so the
  // cut cannot come after the load.
  expect(log).toEqual([
    "readBook",
    "getViewState",
    "prepare",
    "loadAnnotations",
    "seedReadingPosition",
    // What a lesson turn reads, started after everything the pane needs and in
    // the desk's order (open-book.ts).
    "clearFigureCache",
    "ensureFigures stale=false",
    "ensureFulltext stale=false",
  ]);
  // The reader is told what is happening while the book is being laid out, and
  // told it in the same words the desk uses.
  expect(status).toEqual([cuttingStatus(1, 4), null]);
  expect(opened.outline).toEqual([{ title: "One", page: 2, level: 0 }]);
});

test("the pane is handed the page-anchored marks only", async () => {
  const opened = await openPhoneBook("b1", fakeIo([]), () => {});
  expect(opened.annotations.map((a) => a.id)).toEqual(["m1"]);
  expect(opened.allAnnotations.map((a) => a.id)).toEqual(["m1", "m2"]);
});

test("a position that will not load is not a book that will not open", async () => {
  const log: string[] = [];
  const io = fakeIo(log, {
    async getViewState() {
      log.push("getViewState");
      throw new Error("no");
    },
    async prepare() {
      log.push("prepare");
      throw new Error("no ruler here");
    },
    async loadAnnotations() {
      log.push("loadAnnotations");
      throw new Error("no");
    },
  });
  const opened = await openPhoneBook("b1", io, () => {});
  expect(opened.outline).toEqual([]);
  expect(opened.annotations).toEqual([]);
  expect(opened.viewState.pageIndex).toBe(0);
});

test("a book left paged on the iPad opens on the phone as a scroll", () => {
  const saved = { pageIndex: 12, scale: 1.5, scrollMode: 0, layout: "paged", cfi: "x" } as ViewState;
  const state = phoneViewState(saved);
  expect(state.layout).toBe("vertical");
  // Everything that says where in the book the reader was is kept.
  expect(state.pageIndex).toBe(12);
  expect(state.cfi).toBe("x");
  expect(phoneViewState(null).layout).toBe("vertical");
});

test("leaving the book writes the position, lets go and records the read", () => {
  const log: string[] = [];
  const state = { pageIndex: 4, scale: "auto", scrollMode: 0 } as ViewState;
  closePhoneBook(fakeIo(log), { bookId: "b1", topicId: "t1", path: "/books/a.epub" }, state);
  expect(log).toEqual(["keepReadingPosition", "release", "markOpened"]);
});

test("leaving a book the pane never reported on writes no position", () => {
  const log: string[] = [];
  closePhoneBook(fakeIo(log), { bookId: "b1", topicId: "t1", path: "/books/a.epub" }, null);
  expect(log).toEqual(["release", "markOpened"]);
});

test("what the pane hands back never drops the marks it cannot hold", () => {
  const redrawn = { ...MARK, color: "#aaddff" } as Annotation;
  const merged = mergeSavedMarks([MARK, CHAT_MARK], [redrawn]);
  expect(merged.map((a) => a.id)).toEqual(["m2", "m1"]);
  expect(merged[1]).toBe(redrawn);
});

test("the book is handed over before its text is in", async () => {
  let finish: (ft: Fulltext) => void = () => {};
  const io = fakeIo([], {
    ensureFulltext: () => new Promise<Fulltext>((resolve) => (finish = resolve)),
  });
  const opened = await openPhoneBook("b1", io, () => {});
  // The pane can mount now; the lesson waits on the promise.
  let landed: Fulltext | null | undefined;
  void opened.fulltext.then((ft) => (landed = ft));
  await Promise.resolve();
  expect(landed).toBeUndefined();
  finish(FULLTEXT);
  expect(await opened.fulltext).toBe(FULLTEXT);
  expect(await opened.figures).toBe(FIGURES);
});

test("a table cut again makes both caches stale", async () => {
  const log: string[] = [];
  const io = fakeIo(log, {
    async prepare() {
      return { outline: [], recut: true };
    },
  });
  await openPhoneBook("b1", io, () => {});
  expect(log).toContain("ensureFigures stale=true");
  expect(log).toContain("ensureFulltext stale=true");
});

test("an extraction that fails is a lesson with nothing to read, not a book that will not open", async () => {
  const io = fakeIo([], {
    ensureFulltext: async () => {
      throw new Error("no text");
    },
    ensureFigures: async () => {
      throw new Error("no figures");
    },
  });
  const opened = await openPhoneBook("b1", io, () => {});
  expect(opened.outline).toEqual([{ title: "One", page: 2, level: 0 }]);
  expect(await opened.fulltext).toBeNull();
  expect(await opened.figures).toBeNull();
});
