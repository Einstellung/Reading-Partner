// What a reading-companion turn gives up when it does not fit the model's
// context window, and in what order (src/budget/ladder.ts owns the walking of
// it). The order is the judgement; the wording is what the reader is shown.
//
//   tier 0  never dropped, so it is not on the ladder at all: the role and
//           instructions, the current user message, the marked passage and the
//           user's note on it, the current position, the prep status list, the
//           tool schemas already offered this turn, and the last two rounds of
//           conversation.
//   tier 1  redundancy. Nothing the model could not derive or fetch, so it goes
//           silently.
//   tier 2  still silent, because a tool can fetch it back — the stub says so.
//   tier 3  evidence. Dropped only as a last resort, and the reply carries a
//           line saying what was left out.

import type { Rung } from "../budget";

export type ReadingReductionId =
  | "figure-catalog"
  | "reader-profile"
  | "notes-overview"
  | "booklist-thin"
  | "observation-trim"
  | "page-window"
  | "tool-result-stubs"
  | "prep-notes-trim"
  | "chapter-inline"
  | "history-trim";

// The order things are given up in. First to go is the cheapest to lose.
export const READING_LADDER: readonly Rung<ReadingReductionId>[] = [
  // tier 1: redundancy.
  { id: "figure-catalog" },
  { id: "reader-profile" },
  { id: "notes-overview" },
  { id: "booklist-thin" },
  { id: "observation-trim" },
  // The page images around the highlight (reading/figures/page-window.ts). Last
  // of the silent rungs and priced against the messages, because it is the one
  // thing here big enough to be worth several of the rungs above it. It goes
  // without a notice for the same reason they do: the figure catalog names what
  // is on those pages and view_figure fetches any of it back, so what is lost is
  // a look the model can ask for again rather than material it cannot reach.
  { id: "page-window", price: "messages" },
  // tier 2: gone from the prompt, still reachable by a tool, and the stub says
  // so. Applied inside the agent loop rather than here, since this assembly has
  // no tool results yet; it stays on the ladder because its position is the
  // statement that the model's own fetches outlive the material it was handed.
  { id: "tool-result-stubs", price: "none" },
  // tier 3: evidence. Both rungs here are an order of magnitude bigger than
  // everything above them, so they are priced against the full prompt rather
  // than alongside the small rungs.
  //
  // The prep notes go before the inlined book. The survey is the syllabus and
  // every citation is anchored to its pages; the notes are the shelf beside it,
  // each one still reachable whole by read_note, and the prep list left in the
  // prompt names every slug. It carries a notice all the same: which notes the
  // class was taught from is the reader's business, and the model only fetches
  // back what it thinks to fetch.
  {
    id: "prep-notes-trim",
    price: "bulk",
    notice: "some of my notes on the reference papers were left out to make room",
  },
  // The book's text, or the chapter in focus (docs/09: whichever of the two this
  // turn inlined). Giving it up does not take the material away — read_chapter
  // and read_pages still reach every page of it — but it turns a turn that had
  // the chapter in view into one that has to fetch what it needs, so it says so.
  {
    id: "chapter-inline",
    price: "bulk",
    notice: "this didn't fit in context, so I read the pages I needed instead of having it all in view",
  },
  // Last, below even the inlined book, because of what it costs: the fallback
  // distillation meant to capture an older stretch of a thread before it falls
  // out of context is fired and forgotten (turn.ts), so nothing guarantees it
  // has landed by the time the trim happens. Cutting history is a straight loss
  // of the conversation, not a compaction of it.
  {
    id: "history-trim",
    price: "messages",
    notice: "earlier turns of this conversation were left out to make room",
  },
];
