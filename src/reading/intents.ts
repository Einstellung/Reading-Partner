// What a fresh conversation can open with (docs/03). Marking a passage used to
// be read as one thing — "explain this" — and the bubble sent it before the
// reader had said anything. A mark is thinner than that: it can mean explain,
// how does this follow from the last page, show me one, or I don't buy it. So
// the bubble sends nothing and offers these instead; picking one sends its
// message down the ordinary send path, and the composer is there for everything
// that is not on the list.
//
// Data only, so the wording is testable and the render layer stays a render
// layer. `label` is what the chip says, `message` is what the reader is taken
// to have said.

export interface ReadingIntent {
  id: string;
  // The chip's text. Short enough to sit two-across in a 360px bubble.
  label: string;
  // The message sent as the reader's own words. Written the way a reader talks,
  // not as an instruction to a model.
  message: string;
}

// The opening ask on a marked passage. Unchanged in wording, and still exported
// under its old name from reading/turn.ts: it is also the synthetic first user
// message a turn falls back to when the replayed history starts with a reply.
export const EXPLAIN_KICKOFF =
  "Please explain the passage I just marked, using the reading context above.";

// A mark-anchored thread: there is a passage, and it is in the prompt.
export const MARK_INTENTS: readonly ReadingIntent[] = [
  { id: "explain", label: "Explain this", message: EXPLAIN_KICKOFF },
  {
    id: "connect",
    label: "How it connects",
    message: "How does this passage follow from what came before it?",
  },
  {
    id: "example",
    label: "Give an example",
    message: "Can you give me a concrete example of what this is saying?",
  },
  {
    id: "doubt",
    label: "I have doubts",
    message: "Something here doesn't add up for me. What am I missing?",
  },
];

// A side conversation opened on words the reader picked out of a reply (docs/03).
// There is no mark and no page here, so nothing in this set may point at one —
// MARK_INTENTS opens on "the passage I just marked", which would send the model
// looking for something the prompt does not carry. The span itself is in the
// prompt; what these ask is what to do with it.
export const SPAN_INTENTS: readonly ReadingIntent[] = [
  {
    id: "span-explain",
    label: "Explain this",
    message: "Explain the part of your answer I just picked out.",
  },
  {
    id: "span-example",
    label: "Give an example",
    message: "Can you give me a concrete example of what that means?",
  },
  {
    id: "span-doubt",
    label: "I have doubts",
    message: "Something there doesn't add up for me. What am I missing?",
  },
];

// Which set an aside opens with. One drawn on the page is a marked passage like
// any other and gets the same chips; one pulled out of a reply is not.
export function asideIntents(from: "chat" | "mark"): readonly ReadingIntent[] {
  return from === "chat" ? SPAN_INTENTS : MARK_INTENTS;
}

// Which set a thread opens with. The book-level thread is the one with no mark
// (annotationId ""), so that is the whole test, and it opens with no chips at
// all (docs/09, 2026-08-20): the reader types.
//
// What was there was written for someone deciding how to read the book
// themselves — where to start, what it holds up to here — which is not who this
// entry is for. The one chip worth keeping said how to teach a chapter; that is
// teaching discipline in the system prompt now (platform/app/context.ts), and
// the chapter it parked the conversation on is written by read_chapter.
const NO_INTENTS: readonly ReadingIntent[] = [];

export function openingIntents(isBookLevel: boolean): readonly ReadingIntent[] {
  return isBookLevel ? NO_INTENTS : MARK_INTENTS;
}

// What a book-level conversation says about itself while it cannot yet teach
// anything out of this book (docs/09). It sits under the composer of the empty
// conversation.
//
// Extracting the text is the shared prerequisite: no text, no chapter table,
// nothing to teach from. On a 400-page book it takes tens of seconds, and for
// all of them the entry offers a composer that cannot yet be answered from the
// book — which reads as the feature being absent rather than a second away.
// This is the sentence that says which it is.
//
// Null when there is nothing to explain: with the text in, a book that still has
// no usable chapter table is an ordinary book (docs/09: four in five) and saying
// so every time would be noise.
export type BookTextState =
  // The extraction is still running.
  | "extracting"
  // The text is in and readable.
  | "ok"
  // The extraction finished with nothing usable, or failed outright.
  | "unreadable";

export function bookTextNotice(state: BookTextState): string | null {
  if (state === "extracting")
    return "Still reading through this book — its pages can't be answered from just yet.";
  if (state === "unreadable") return "This book's pages have no text layer, so they can't be read as text.";
  return null;
}
