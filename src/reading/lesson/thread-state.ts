// What a lesson's own conversation says about where the lesson is (docs/74).
//
// The screen shows three things it does not own: which chapters have been
// taught, which page the last quotation came off, and whether this is a lesson
// being resumed rather than one under way. All three are already in the thread
// file — nothing new is written down for them — so all three are derived here,
// pure, and the hook that draws them only reads.
//
// The taught set comes off the settled tool trace rather than off the messages'
// prose: a call's arguments are not persisted (platform/app/threads.ts), its
// name and label are, and read_chapter's label carries the printed chapter
// number (reading/lecture/tools.ts).

import type { Thread } from "../../platform/app/threads";
import { chapterOfReadChapterLabel } from "../lecture/tools";
import { parseAnchor } from "../prep/anchors";

/**
 * Every chapter this thread's read_chapter calls have covered, by the number
 * printed in the book — the same key the focus is in, because an index would
 * name the wrong chapter in two of the five measured books
 * (reading/chapters/table.ts).
 *
 * A call that errored counts: the reader was taken there and the lesson went on
 * from it, and a chapter dropping out of the sheet because one fetch failed
 * would be a lie about where they have been.
 */
export function taughtChapters(thread: Thread | undefined): Set<number> {
  const taught = new Set<number>();
  for (const m of thread?.messages ?? []) {
    for (const part of m.parts ?? []) {
      if (part.type !== "trace") continue;
      for (const tool of part.tools) {
        if (tool.name !== "read_chapter") continue;
        const n = chapterOfReadChapterLabel(tool.label);
        if (n !== null) taught.add(n);
      }
    }
  }
  return taught;
}

// A bracket that might be a citation. The same candidate shape the renderer
// scans for (reading/prep/anchors.ts); what decides a match is parseAnchor, so
// the page this reports is the page the chip in the reply leads to.
const BRACKET = /\[([^[\]\n]{1,240})\]/g;

/**
 * The page the lesson last quoted, or null before it has quoted one.
 *
 * Read backwards from the end and stopping at the first reply that cites
 * anything: a "say that again" answer with no quotation in it is not the lesson
 * moving somewhere else, and the line under the bar should not blank out while
 * one is on screen.
 */
export function lastCitedPage(
  // The two fields both the stored message and the row on screen have. The
  // screen asks this of what it is drawing, streaming row included, so the page
  // arrives with the quotation rather than after the turn.
  messages: readonly { role: "user" | "ai"; text: string }[],
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "ai") continue;
    const page = lastPageIn(m.text);
    if (page !== null) return page;
  }
  return null;
}

function lastPageIn(text: string): number | null {
  let page: number | null = null;
  BRACKET.lastIndex = 0;
  for (let m = BRACKET.exec(text); m; m = BRACKET.exec(text)) {
    const anchor = parseAnchor(m[1]);
    // Only the book's own pages. A supplement's citation names another
    // document, and the focus line is about this paper.
    if (anchor?.kind === "page") page = anchor.page;
  }
  return page;
}

/**
 * Whether the screen is looking at a lesson it did not start: a thread with
 * something in it, and no turn taken since this screen opened.
 *
 * `turnsTaken` is the screen's own count, not the thread's — the thread cannot
 * tell a message written a second ago from one written last week, and what the
 * line is saying ("Continuing from") is about the reader arriving, not about
 * the conversation's age.
 */
export function lessonResumed(thread: Thread | undefined, turnsTaken: number): boolean {
  return turnsTaken === 0 && (thread?.messages.length ?? 0) > 0;
}
