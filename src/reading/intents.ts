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

import type { LectureChapter } from "./lecture";

export interface ReadingIntent {
  id: string;
  // The chip's text. Short enough to sit two-across in a 360px bubble.
  label: string;
  // The message sent as the reader's own words. Written the way a reader talks,
  // not as an instruction to a model.
  message: string;
  // The chapter pressing this chip parks the conversation on (docs/09). Only the
  // chapter chip carries one, and it is resolved from the reader's scroll
  // position at the moment the chips are built — the one moment where the scroll
  // position decides anything.
  focusChapter?: number;
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
// here may point at one.
export const BOOK_INTENTS: readonly ReadingIntent[] = [
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

// How much of a chapter title the chip shows before it is cut.
const CHIP_TITLE_CHARS = 22;

function shortTitle(title: string): string {
  const t = title.trim();
  return t.length > CHIP_TITLE_CHARS ? `${t.slice(0, CHIP_TITLE_CHARS - 1)}…` : t;
}

// "Teach me this chapter", the book-level thread's first chip (docs/09).
//
// The message is written the way the reader wrote it themselves, on the turn
// that produced the two answers they accepted: read this page range, teach it
// compressed, go heavier where I got stuck, say what I can skip, end by pointing
// me at something to read myself. It stays in the message rather than moving
// into the system prompt on purpose — the two good answers had these
// requirements typed into the user message, and the turn that had "the whole
// book is in your context" in the system prompt instead came back at 545 tokens
// with no tool call.
//
// Null when the chapter carries no number: the focus is stored as the number the
// reader would say, so a chapter that has none cannot be parked on.
export function chapterIntent(chapter: LectureChapter | null): ReadingIntent | null {
  if (!chapter || chapter.number === null) return null;
  const range = `p.${chapter.startPage}-${chapter.endPage}`;
  return {
    id: "teach-chapter",
    label: `Teach ch.${chapter.number}: ${shortTitle(chapter.title)} · ${range}`,
    message:
      `Read ${range} — chapter ${chapter.number}, "${chapter.title}" — and teach it to me, ` +
      "compressed. Go heavier where I have gotten stuck before. Say plainly which parts I " +
      "can skip. End by pointing me at one passage to read myself.",
    focusChapter: chapter.number,
  };
}

// Which set a thread opens with. The book-level thread is the one with no mark
// (annotationId ""), so that is the whole test; the chapter the reader is
// currently scrolled into adds a chip in front when the book has a usable
// chapter table, and nothing at all when it does not.
export function openingIntents(
  isBookLevel: boolean,
  chapter: LectureChapter | null = null,
): readonly ReadingIntent[] {
  if (!isBookLevel) return MARK_INTENTS;
  const teach = chapterIntent(chapter);
  return teach ? [teach, ...BOOK_INTENTS] : BOOK_INTENTS;
}
