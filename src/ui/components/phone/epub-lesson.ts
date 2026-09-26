// The phone's EPUB lesson (docs/77), the parts of it that are not React: when
// the lesson is the screen, what a citation tapped in it does to the book, and
// the gate that holds that jump until the reading column can take it.
//
// The lesson is the iPad's book-level call (reading/session/use-call.ts). The
// phone draws it full screen while the call's view is "chat-main" and draws the
// page otherwise; "chat-pip" is the call left open behind the page, which the
// phone does not draw at all (no corner cards on this shell).

import type { CallRow, CallView } from "../../../reading/turn/call-state";
import type { TableChapter } from "../../../reading/chapters";
import type { FlowReaderView } from "../../../reading/epub/flow/flow-contract";
import type { Figure } from "../../../reading/figures";
import type { Fulltext } from "../../../fulltext";
import type { Citation } from "../../../reading/prep";
import { quoteSearchText, routeCitation } from "../../../reading/session/citations";
import type { ChapterFocus } from "../chat/chapterFocus";

/** Whether the lesson covers the page: the book's call, in its full-screen view. */
export function lessonOnScreen(call: { isBook?: boolean; view: CallView } | null): boolean {
  return call?.isBook === true && call.view === "chat-main";
}

/** Whether the conversation's newest row is a reply still being written. */
export function replyStreaming(messages: readonly Pick<CallRow, "role" | "streaming">[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "ai" && last.streaming === true;
}

/** The focus line's words, from the chapter the conversation is parked on. */
export function focusLine(chapter: TableChapter | null): ChapterFocus | null {
  if (!chapter) return null;
  return { chapter: chapter.title, firstPage: chapter.startPage, lastPage: chapter.endPage };
}

// Where a tapped citation takes the reader. The phone has no supplements and no
// prep panel, so a page (a figure is its page) or a line saying why not.
export type CitationJump =
  | { kind: "page"; pageIndex: number; quote?: string }
  | { kind: "warn"; message: string };

/**
 * The jump a citation asks for, through the desk's own routing. Null for the two
 * kinds the phone cannot reach: a supplement (the list is empty) and a prepped
 * paper (a slug is not linkified here; an empty paper list turns one into a
 * warning before it could get this far).
 */
export function citationJump(c: Citation, figures: readonly Figure[]): CitationJump | null {
  const route = routeCitation(c, { figures: [...figures], supplements: [], papers: [] });
  if (route.kind === "warn") return route;
  if (route.kind !== "page") return null;
  return route.quote
    ? { kind: "page", pageIndex: route.pageIndex, quote: route.quote }
    : { kind: "page", pageIndex: route.pageIndex };
}

/**
 * Take the column to the cited page and, with a quote, mark it in the iPad's
 * quote colour. The words searched for are the page's own (quoteSearchText);
 * with no text to check against, the model's quote as it wrote it.
 */
export async function jumpInBook(
  view: Pick<FlowReaderView, "goToPage" | "highlightQuote">,
  jump: { pageIndex: number; quote?: string },
  fulltext: Promise<Fulltext | null> | null,
): Promise<void> {
  const { pageIndex, quote } = jump;
  if (!quote) {
    view.goToPage(pageIndex);
    return;
  }
  let searchText = quote;
  try {
    searchText = quoteSearchText(await fulltext, pageIndex, quote);
  } catch {
    // No text to check against: the quote as the reply has it.
  }
  await view.highlightQuote(pageIndex, { searchText, displayText: quote });
}

// A jump waits for the column: the handle arrives with onView, and a quote can
// only be found once the pane has laid the book out (onInitialized). A lesson
// can be opened before that — a thread started on the iPad has citations in it
// from the first frame — so a tap that lands early is held, and the newest one
// wins.
export interface ViewGate<V> {
  attach(view: V): void;
  ready(): void;
  detach(): void;
  run(act: (view: V) => void): void;
}

export function createViewGate<V>(): ViewGate<V> {
  let view: V | null = null;
  let isReady = false;
  let pending: ((view: V) => void) | null = null;
  const flush = () => {
    if (!view || !isReady || !pending) return;
    const act = pending;
    pending = null;
    act(view);
  };
  return {
    attach(next) {
      view = next;
      flush();
    },
    ready() {
      isReady = true;
      flush();
    },
    detach() {
      view = null;
      isReady = false;
      pending = null;
    },
    run(act) {
      pending = act;
      flush();
    },
  };
}
