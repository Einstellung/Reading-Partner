// The phone's EPUB lesson, the parts that are not React
// (src/ui/components/phone/epub-lesson.ts, docs/77): when the lesson is the
// screen, where a tapped citation goes, and the gate that holds the jump until
// the column can take it. Run: bun test.

import { expect, test } from "bun:test";
import type { Fulltext } from "../../../../src/fulltext";
import type { Figure } from "../../../../src/reading/figures";
import {
  citationJump,
  createViewGate,
  focusLine,
  jumpInBook,
  lessonOnScreen,
  replyStreaming,
} from "../../../../src/ui/components/phone/epub-lesson";

test("the lesson covers the page only as the book's call in its full view", () => {
  expect(lessonOnScreen(null)).toBe(false);
  expect(lessonOnScreen({ isBook: true, view: "chat-main" })).toBe(true);
  // Left open behind the page: the phone draws nothing for it.
  expect(lessonOnScreen({ isBook: true, view: "chat-pip" })).toBe(false);
  expect(lessonOnScreen({ isBook: false, view: "chat-main" })).toBe(false);
});

test("a reply is streaming only while the newest row is one being written", () => {
  expect(replyStreaming([])).toBe(false);
  expect(replyStreaming([{ role: "user" }])).toBe(false);
  expect(replyStreaming([{ role: "user" }, { role: "ai", streaming: true }])).toBe(true);
  expect(replyStreaming([{ role: "ai", streaming: true }, { role: "user" }])).toBe(false);
  expect(replyStreaming([{ role: "ai" }])).toBe(false);
});

test("the focus line names the chapter and its pages, and nothing without one", () => {
  expect(focusLine(null)).toBeNull();
  expect(
    focusLine({ index: 3, number: 3, title: "Chapter III", startPage: 11, endPage: 15 }),
  ).toEqual({ chapter: "Chapter III", firstPage: 11, lastPage: 15 });
});

const FIGURE = { id: "3", page: 14 } as Figure;

test("a page citation jumps to its page as an index, the quote with it", () => {
  expect(citationJump({ kind: "page", page: 14, quote: "not handsome enough" }, [])).toEqual({
    kind: "page",
    pageIndex: 13,
    quote: "not handsome enough",
  });
  expect(citationJump({ kind: "page", page: 7 }, [])).toEqual({ kind: "page", pageIndex: 6 });
});

test("a figure citation jumps to the figure's page, or says there is none", () => {
  expect(citationJump({ kind: "figure", id: "3" }, [FIGURE])).toEqual({
    kind: "page",
    pageIndex: 13,
  });
  expect(citationJump({ kind: "figure", id: "9" }, [FIGURE])?.kind).toBe("warn");
});

test("a paper citation has nowhere to go on the phone and says so", () => {
  expect(citationJump({ kind: "paper", slug: "bert", page: 2 }, [])?.kind).toBe("warn");
});

function fakeView() {
  const calls: unknown[] = [];
  return {
    calls,
    view: {
      goToPage(pageIndex: number) {
        calls.push(["page", pageIndex]);
      },
      async highlightQuote(pageIndex: number, req: { searchText: string; displayText: string }) {
        calls.push(["quote", pageIndex, req]);
        return true;
      },
    },
  };
}

function text(pages: string[]): Fulltext {
  return { status: "ok", pages, outline: [], kind: "epub" } as unknown as Fulltext;
}

test("a citation without a quote goes to the page", async () => {
  const { calls, view } = fakeView();
  await jumpInBook(view, { pageIndex: 6 }, Promise.resolve(null));
  expect(calls).toEqual([["page", 6]]);
});

test("a quote is marked on its page", async () => {
  const { calls, view } = fakeView();
  const quote = "She is tolerable";
  await jumpInBook(
    view,
    { pageIndex: 0, quote },
    Promise.resolve(text(["and coldly said: She is tolerable, but not handsome enough"])),
  );
  expect(calls.length).toBe(1);
  const [kind, pageIndex, req] = calls[0] as [string, number, { searchText: string; displayText: string }];
  expect(kind).toBe("quote");
  expect(pageIndex).toBe(0);
  expect(req.displayText).toBe(quote);
  expect(req.searchText).toContain("She is tolerable");
});

test("with no text to check against, the quote is searched as the reply wrote it", async () => {
  const { calls, view } = fakeView();
  await jumpInBook(view, { pageIndex: 2, quote: "a quote" }, Promise.reject(new Error("no text")));
  expect(calls).toEqual([["quote", 2, { searchText: "a quote", displayText: "a quote" }]]);
});

test("the gate holds a jump until the column has its handle and is laid out", () => {
  const gate = createViewGate<string>();
  const ran: string[] = [];
  gate.run((v) => ran.push(`first:${v}`));
  gate.run((v) => ran.push(`second:${v}`));
  gate.attach("column");
  expect(ran).toEqual([]);
  gate.ready();
  // The newest tap wins; the one it replaced never runs.
  expect(ran).toEqual(["second:column"]);
  gate.run((v) => ran.push(`now:${v}`));
  expect(ran).toEqual(["second:column", "now:column"]);
});

test("a detached gate drops what it held and waits again", () => {
  const gate = createViewGate<string>();
  const ran: string[] = [];
  gate.attach("column");
  gate.run(() => ran.push("held"));
  gate.detach();
  gate.attach("column");
  gate.ready();
  expect(ran).toEqual([]);
});
