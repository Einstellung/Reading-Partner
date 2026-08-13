// What a reading-companion turn gives up when it does not fit the model's
// context window, and in what order (src/budget/ladder.ts owns the walking of
// it). The order is the judgement; the wording is what the reader is shown.
//
//   tier 0  never dropped, so it is not on the ladder at all: the role and
//           instructions, the current user message, the marked passage and the
//           user's note on it, the current position, this chapter's prep notes,
//           the tool schemas already offered this turn, and the last two rounds
//           of conversation.
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
  | "tool-result-stubs"
  | "classroom-inline"
  | "history-trim";

// The order things are given up in. First to go is the cheapest to lose.
export const READING_LADDER: readonly Rung<ReadingReductionId>[] = [
  // tier 1: redundancy.
  { id: "figure-catalog" },
  { id: "reader-profile" },
  { id: "notes-overview" },
  { id: "booklist-thin" },
  { id: "observation-trim" },
  // tier 2: gone from the prompt, still reachable by a tool, and the stub says
  // so. Applied inside the agent loop rather than here, since this assembly has
  // no tool results yet; it stays on the ladder because its position is the
  // statement that the model's own fetches outlive the material it was handed.
  { id: "tool-result-stubs", price: "none" },
  // tier 3: evidence. An order of magnitude bigger than everything above it, so
  // it is priced against the full prompt rather than alongside the small rungs.
  {
    id: "classroom-inline",
    price: "bulk",
    notice: "the book didn't fit in context, so I read the pages I needed instead of having all of it in view",
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
