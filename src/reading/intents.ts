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

// The book-level thread (top-bar AI button): no passage is marked, so nothing
// here may point at one. The reader's position is in the prompt, which is what
// "the chapter I'm on" resolves against.
export const BOOK_INTENTS: readonly ReadingIntent[] = [
  {
    id: "chapter",
    label: "What's this chapter about",
    message: "What is the chapter I'm on about?",
  },
  {
    id: "start",
    label: "Where should I start",
    message: "I'm new to this book. Where should I start, and what should I read it for?",
  },
  {
    id: "so-far",
    label: "Key ideas so far",
    message: "What are the key ideas of this book up to where I am now?",
  },
];

// Which set a thread opens with. The book-level thread is the one with no mark
// (annotationId ""), so that is the whole test.
export function openingIntents(isBookLevel: boolean): readonly ReadingIntent[] {
  return isBookLevel ? BOOK_INTENTS : MARK_INTENTS;
}
