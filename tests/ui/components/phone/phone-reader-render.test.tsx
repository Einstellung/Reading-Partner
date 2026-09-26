// The phone's reading screen on a real DOM (docs/70), against a stub pane: the
// page text the desk prints, the two sheets, and the two AI controls drawn and
// unpressable. The pane itself is another file's; what is pinned here is the
// shell it is handed to. Run: bun test.

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { useEffect } from "react";
import type { Annotation, ViewStats } from "../../../../src/platform/app/reader-contract";
import type { Settings } from "../../../../src/platform/app/settings";
import type { Thread, ThreadMessage } from "../../../../src/platform/app/threads";
import * as events from "../../../../src/platform/app/events";
import * as memory from "../../../../src/memory";
import * as threads from "../../../../src/platform/app/threads";
import * as agent from "../../../../src/legion/execute/turn";
import * as turn from "../../../../src/reading/turn";
import type { AgentCallbacks } from "../../../../src/legion/execute/contract";
import { callSettings, emptyReadingTurn } from "../../../support/use-call";
import { bookThreadIo } from "../../../../src/reading/session/book-thread";
import type { LessonTopic } from "../../../../src/ui/components/phone/use-book-lesson";
import type { FlowReaderPaneProps } from "../../../../src/reading/epub/flow-contract";
import {
  FLOW_DISPLAY_DEFAULT,
  FLOW_DISPLAY_KEY,
  type FlowDisplay,
} from "../../../../src/reading/epub/flow-display";
import { AI_PEN_NOT_ON_PHONE } from "../../../../src/ui/components/phone/reader-gate";
import type { PhoneBookIo } from "../../../../src/reading/session/open-epub";
import { useDom } from "../../../support/dom";

// The window first: the screen pulls in Radix, which pulls in react-dom, and
// react-dom decides once at evaluation whether it is in a browser (support/dom).
const { render, cleanup, fireEvent, act } = await useDom();
const { default: PhoneReader } = await import(
  "../../../../src/ui/components/phone/PhoneReader"
);

afterEach(cleanup);

const STATS: ViewStats = {
  pageIndex: 36,
  pageLabel: "37",
  printedLabel: "52",
  pagesCount: 385,
  canZoomIn: false,
  canZoomOut: false,
  canZoomReset: false,
  layout: "vertical",
};

const pages: number[] = [];
// Every display the pane has been handed, the one it mounted at included. The
// real pane turns a change into view.setDisplay; the shell's half is the prop.
const displays: FlowDisplay[] = [];
// Every quote the column was asked to mark, and how many times a pane mounted.
const highlights: [number, string][] = [];
let paneMounts = 0;

// What the reflow pane does as far as this screen is concerned: it comes up,
// reports where the reader is, and hands back a handle. Nothing of the real
// one is needed to know whether the shell around it is wired.
function StubPane(props: FlowReaderPaneProps) {
  useEffect(() => {
    displays.push(props.display);
  }, [props.display]);
  useEffect(() => {
    paneMounts += 1;
    props.onView({
      goToCfi() {},
      goToHref() {},
      goToPage(pageIndex) {
        pages.push(pageIndex);
      },
      goToChapter(pageIndex) {
        pages.push(pageIndex);
      },
      highlightQuote: async (pageIndex, req) => {
        highlights.push([pageIndex, req.searchText]);
        return true;
      },
      clearQuoteHighlight() {},
      removeAnnotations() {},
      setTool() {},
      setDisplay() {},
      destroy() {},
    });
    props.onInitialized();
    props.onChangeViewStats(STATS);
  }, []);
  return <div data-testid="pane">the book</div>;
}

const io: PhoneBookIo = {
  async readBook() {
    return new Uint8Array([1, 2, 3]);
  },
  async getViewState() {
    return null;
  },
  async prepare() {
    return {
      outline: [
        { title: "One: the machine", page: 2, level: 0 },
        { title: "Two: the tape", page: 40, level: 1 },
      ],
      recut: false,
    };
  },
  async loadAnnotations(): Promise<Annotation[]> {
    return [];
  },
  ensureFulltext: () => new Promise(() => {}),
  ensureFigures: () => new Promise(() => {}),
  clearFigureCache() {},
  seedReadingPosition() {},
  keepReadingPosition() {},
  release() {},
  async markOpened() {},
};

// The shell's one back, as the reader registers it (nav-stack.ts): what the
// lesson hands over while it is on screen, null when it is not.
let overlay: (() => void) | null = null;
const toasts: string[] = [];

// No topic unless a test asks for one: with a topic, leaving the book logs the
// call's end and starts distillation, both of which write to disk.
async function openReader(topic: LessonTopic | null = null, settings = {} as Settings) {
  const view = render(
    <PhoneReader
      Pane={StubPane}
      bookId="b1"
      name="A book"
      topicId="t1"
      path="/books/a.epub"
      topic={topic}
      settingsRef={{ current: settings }}
      pushToast={(_kind, message) => toasts.push(message)}
      onOverlayChange={(dismiss) => {
        overlay = dismiss;
      }}
      io={io}
      onBack={() => {}}
    />,
  );
  // The open sequence is asynchronous end to end; let it land before reading
  // anything off the screen.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

test("the book comes up and the bar counts in the pages the desk counts in", async () => {
  const { getByTestId, container } = await openReader();
  expect(getByTestId("pane").textContent).toBe("the book");
  expect(container.textContent).toContain("37 / 385");
  expect(container.textContent).toContain("printed 52");
});

test("the AI pen is on screen with its reason, and Learn can be pressed", async () => {
  const { container, getByLabelText } = await openReader();
  const dim = [...container.querySelectorAll("button[disabled]")];
  const reasons = dim.map((b) => b.getAttribute("title"));
  expect(reasons.filter((r) => r === AI_PEN_NOT_ON_PHONE).length).toBe(1);
  expect((getByLabelText("Learn this book with AI") as HTMLButtonElement).disabled).toBe(false);
});

// --- the lesson (docs/77) ---------------------------------------------------

// The book's thread, from its file (book-thread.ts): none yet, so one is made.
function bookThread(messages: ThreadMessage[]): Thread {
  return { id: "th1", annotationId: "", book: true, path: "b1", createdAt: 1, messages };
}

async function openLesson(
  messages: ThreadMessage[] = [],
  topic: LessonTopic | null = null,
  settings?: Settings,
) {
  spyOn(bookThreadIo, "loadThreads").mockResolvedValue({});
  spyOn(bookThreadIo, "getBookThread").mockReturnValue(bookThread(messages));
  const view = await openReader(topic, settings);
  await act(async () => {
    fireEvent.click(view.getByLabelText("Learn this book with AI"));
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

afterEach(() => {
  mock.restore();
  overlay = null;
  pages.length = 0;
  highlights.length = 0;
});

test("Learn puts the book's lesson over the reader, and the reader stays mounted under it", async () => {
  const mountsBefore = paneMounts;
  const { container, getByTestId } = await openLesson();
  const lesson = container.querySelector('[aria-label="Lesson"]');
  expect(lesson).not.toBeNull();
  // The empty lesson says what it is for, and that the text is still coming.
  expect(lesson?.querySelector("h1")?.textContent).toBe("A book");
  expect(lesson?.querySelector("textarea")?.getAttribute("placeholder")).toBe(
    "Ask me to teach you part of this book…",
  );
  expect(lesson?.textContent).toContain("Still reading through this book");
  // No dictation, no hang-up: the bar's back is the way out.
  expect(lesson?.querySelector('[aria-label="Hang up"]')).toBeNull();
  expect(lesson?.querySelector('[aria-label="Back to the page"]')).not.toBeNull();
  // The column was not unmounted to make room.
  expect(getByTestId("pane")).not.toBeNull();
  expect(paneMounts).toBe(mountsBefore + 1);
  // And the shell's back is told to close it before it leaves the book.
  expect(overlay).not.toBeNull();
});

test("back from the lesson is the page, with the same column and the call left open", async () => {
  const mountsBefore = paneMounts;
  const { container, getByLabelText } = await openLesson();
  await act(async () => {
    fireEvent.click(getByLabelText("Back to the page"));
  });
  expect(container.querySelector('[aria-label="Lesson"]')).toBeNull();
  expect(paneMounts).toBe(mountsBefore + 1);
  expect(overlay).toBeNull();
  // Learn again goes straight back in: the call is still there, no file read.
  const reads = (bookThreadIo.loadThreads as unknown as { mock: { calls: unknown[] } }).mock.calls
    .length;
  await act(async () => {
    fireEvent.click(getByLabelText("Learn this book with AI"));
  });
  expect(container.querySelector('[aria-label="Lesson"]')).not.toBeNull();
  expect(
    (bookThreadIo.loadThreads as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
  ).toBe(reads);
});

test("the shell's back closes the lesson rather than leaving the book", async () => {
  const { container } = await openLesson();
  await act(async () => {
    overlay?.();
  });
  expect(container.querySelector('[aria-label="Lesson"]')).toBeNull();
});

test("a reply finished while the reader was in the lesson leaves no dot on Learn", async () => {
  const { container, getByLabelText } = await openLesson([
    { role: "user", text: "Teach me chapter 1.", ts: 1 },
    { role: "ai", text: "Chapter I is one conversation.", ts: 2 },
  ]);
  await act(async () => {
    fireEvent.click(getByLabelText("Back to the page"));
  });
  expect(container.querySelector("[data-lesson-dot]")).toBeNull();
});

test("going back to the page does not end the lesson; leaving the book does", async () => {
  const logged = spyOn(events, "logEvent").mockImplementation(() => {});
  const distilled = spyOn(memory, "distillThread").mockResolvedValue(undefined as never);
  const { getByLabelText, unmount } = await openLesson([], { id: "t1", name: "Novels", files: [] });
  await act(async () => {
    fireEvent.click(getByLabelText("Back to the page"));
  });
  const ends = () => logged.mock.calls.filter((c) => c[1] === "call-end");
  expect(ends()).toEqual([]);
  unmount();
  expect(ends().map((c) => c[2])).toEqual([{ threadId: "th1", book: true }]);
  await act(async () => {
    await Promise.resolve();
  });
  expect(distilled).toHaveBeenCalledTimes(1);
});

// The turn waits on the book's text and figures before it is assembled, and
// the io above never finishes them. It also needs a provider (callSettings).
function bookTextResolved() {
  spyOn(io, "ensureFulltext").mockResolvedValue(null as never);
  spyOn(io, "ensureFigures").mockResolvedValue(null as never);
}

// A turn that fails: the lesson is sent a question, and the model call comes
// back with an error — with the lesson on screen, or after the reader went back
// to the page.
async function failTurn(view: Awaited<ReturnType<typeof openLesson>>, pageFirst: boolean) {
  const stored: ThreadMessage[] = [];
  spyOn(threads, "getThread").mockImplementation(
    () => ({ ...bookThread([]), messages: stored.slice() }) as Thread,
  );
  spyOn(threads, "appendMessage").mockImplementation((_b, _t, m) => void stored.push(m));
  spyOn(turn, "buildReadingTurn").mockResolvedValue(emptyReadingTurn());
  let fail: ((message: string) => void) | null = null;
  spyOn(agent, "runAgentTurn").mockImplementation((params) => {
    fail = (message) => (params as unknown as AgentCallbacks).onError(message);
    return new Promise<void>(() => {});
  });
  const box = view.container.querySelector('[aria-label="Lesson"] textarea') as HTMLTextAreaElement;
  await act(async () => {
    fireEvent.change(box, { target: { value: "Teach me chapter 1." } });
  });
  await act(async () => {
    fireEvent.click(view.getByLabelText("Send"));
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(fail).not.toBeNull();
  if (pageFirst) {
    await act(async () => {
      fireEvent.click(view.getByLabelText("Back to the page"));
    });
  }
  toasts.length = 0;
  await act(async () => {
    fail!("503 overloaded");
  });
}

test("a turn that fails with the lesson on screen says so in the lesson, with no toast over the composer", async () => {
  bookTextResolved();
  const view = await openLesson([], null, callSettings);
  await failTurn(view, false);
  expect(toasts).toEqual([]);
  const lesson = view.container.querySelector('[aria-label="Lesson"]');
  expect(lesson?.textContent).toContain("Couldn't reach the model. 503 overloaded");
  expect([...(lesson?.querySelectorAll("button") ?? [])].some((b) => b.textContent === "Retry")).toBe(
    true,
  );
});

test("a turn that fails with the reader on the page raises the toast and lights Learn", async () => {
  bookTextResolved();
  const view = await openLesson([], null, callSettings);
  await failTurn(view, true);
  expect(toasts).toEqual(["AI reply failed"]);
  expect(view.container.querySelector('[data-lesson-dot="unseen"]')).not.toBeNull();
});

test("a page citation closes the lesson and takes the column to the page", async () => {
  const { container } = await openLesson([
    { role: "user", text: "Where does Darcy snub her?", ts: 1 },
    { role: "ai", text: "On the page after the ball [p.14].", ts: 2 },
  ]);
  // The reply is markdown, rendered lazily.
  let chip: Element | null = null;
  for (let i = 0; i < 50 && !chip; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    chip = container.querySelector('[aria-label="Lesson"] a[href="#rp-page-14"]');
  }
  expect(chip).not.toBeNull();
  await act(async () => {
    fireEvent.click(chip as Element);
  });
  expect(container.querySelector('[aria-label="Lesson"]')).toBeNull();
  expect(pages).toEqual([13]);
});

test("the outline sheet lists the chapters and navigates by block", async () => {
  const { container, getByLabelText } = await openReader();
  await act(async () => {
    fireEvent.click(getByLabelText("Outline"));
  });
  // Portalled, so it is the document rather than the container that has it.
  const sheet = document.body.textContent ?? "";
  expect(sheet).toContain("One: the machine");
  expect(sheet).toContain("Two: the tape");
  const entry = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Two: the tape"),
  );
  await act(async () => {
    fireEvent.click(entry as Element);
  });
  // The outline counts pages 1-based; the view takes an index.
  expect(pages).toEqual([39]);
  // And the sheet puts itself away behind the reader it navigated.
  expect(container.textContent).toContain("37 / 385");
});

// --- the display sheet ----------------------------------------------------

test("the rack draws no navigation lock, and an Aa stands where it would have", async () => {
  const { container } = await openReader();
  expect(container.querySelector('button[aria-label^="Navigate only"]')).toBeNull();
  expect(container.querySelector('button[aria-label="Display"]')).not.toBeNull();
});

test("the sheet's choices reach the pane and the slot on this device", async () => {
  localStorage.removeItem(FLOW_DISPLAY_KEY);
  displays.length = 0;
  const { container, getByLabelText } = await openReader();
  await act(async () => {
    fireEvent.click(getByLabelText("Display"));
  });
  const larger = document.body.querySelector('button[aria-label="Larger text"]');
  await act(async () => {
    fireEvent.click(larger as Element);
  });
  const dark = document.body.querySelector('button[aria-label="Dark"]');
  await act(async () => {
    fireEvent.click(dark as Element);
  });

  // Applied on the press, both of them, and nothing was confirmed.
  expect(displays.length).toBe(3);
  expect(displays[0]).toEqual(FLOW_DISPLAY_DEFAULT);
  expect(displays[1].fontPx).toBeGreaterThan(FLOW_DISPLAY_DEFAULT.fontPx);
  expect(displays[2].paper).toBe("dark");
  // The screen wears the paper, so the bar and the mark popup turn with it.
  expect(container.querySelector('[data-reader-paper="dark"]')).not.toBeNull();
  // And it is this device's, written where a relaunch will find it.
  expect(JSON.parse(localStorage.getItem(FLOW_DISPLAY_KEY) as string)).toEqual(displays[2]);
});

test("a book opens at the settings the reader left, not at the default", async () => {
  localStorage.setItem(
    FLOW_DISPLAY_KEY,
    JSON.stringify({ fontPx: 21, lineHeight: 1.4, padX: 36, paper: "green" }),
  );
  displays.length = 0;
  await openReader();
  // The pane was mounted with them: no 17px frame first, and nothing pushed in
  // after.
  // A slot written before the paged mode existed reads as the scrolled column.
  expect(displays).toEqual([{ fontPx: 21, lineHeight: 1.4, padX: 36, paper: "green", mode: "scroll" }]);
  localStorage.removeItem(FLOW_DISPLAY_KEY);
});
