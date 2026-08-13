// What a rehearsal turn gives up when it does not fit the model's context
// window, and in what order (src/budget/ladder.ts owns the walking of it). The
// same tiers as the reading ladder (../ladder.ts), over a different set of
// material: a rehearsal is assembled out of a talk's books rather than the page
// a reader is on, so the reader's own marks are the material here rather than a
// hint, and the whole-book survey never appears.

import type { Rung } from "../../budget";

export type TalkReductionId =
  | "figure-catalog"
  | "observation-trim"
  | "rehearsal-notes"
  | "tool-result-stubs"
  | "rehearsal-marks"
  | "history-trim";

export const TALK_LADDER: readonly Rung<TalkReductionId>[] = [
  // tier 1: redundancy.
  { id: "figure-catalog" },
  { id: "observation-trim" },
  // tier 2: gone from the prompt, still reachable by a tool. The inlined chapter
  // note goes before the tool results: the model asked for those and is working
  // from them, while the note was put in front of it unasked and
  // read_chapter_note fetches it straight back.
  { id: "rehearsal-notes", price: "bulk" },
  { id: "tool-result-stubs", price: "none" },
  // tier 3: evidence. The reader's own marks, in the one mode where they are the
  // material rather than a hint (docs/31). Trimmed, not dropped: a rehearsal
  // with no marks in front of it stops being a rehearsal of *their* reading, so
  // what goes is the long tail of each chapter and the length of each quote.
  {
    id: "rehearsal-marks",
    price: "bulk",
    notice: "your highlights are shortened here to fit; ask me to pull a chapter's marks up in full and I'll read them again",
  },
  // Last, for the same reason it is last on the reading ladder: cutting history
  // is a straight loss of the conversation, not a compaction of it.
  {
    id: "history-trim",
    price: "messages",
    notice: "earlier turns of this conversation were left out to make room",
  },
];
