// A pass, written out for the conversation (docs/44: stopping is handing it in).
//
// The transcript reaches the coach as one message from the reader, in the
// conversation anchored on the outline — so the second pass is read with the
// first pass and everything said about it still in the thread. Which is why this
// is a message and not a prompt section: a prompt section would be replaced by
// the next pass, and "come back and give it again" is the whole point.
//
// It is the words and nothing else. The note is not in here — the system prompt
// carries the whole of it already (coach.ts, formatTalkOutline), and a second
// copy would be the note twice in one request — and neither is any map from what
// was said to the block it came from, because the surface the reader talks from
// records no such thing (RehearsalView.tsx). What is left is the one thing the
// coach has to be told rather than work out: that the reader may have given part
// of the talk, or one part several times, and that what is missing was left out
// on purpose.

import { runSummary } from "./summary";
import type { RehearsalPage, RehearsalRunEntry } from "./types";

export interface PassHandoff {
  // The pass as the store recorded it, for the ordinal and the counts.
  entry: RehearsalRunEntry;
  // What was said. One page for a pass given from the note; one per segment for
  // a pass from the days of a block at a time, which reads back the same way
  // here because the transcripts are joined in the order they were spoken.
  pages: readonly RehearsalPage[];
}

/**
 * The message a finished pass puts into the talk's conversation, as the reader.
 *
 * Empty when nothing was said at all: a pass with no words in it — no STT key on
 * the desktop, no dictation on the host — has nothing for a coach to hear, and a
 * message saying so would only invite a reply about the silence.
 */
export function passMessage(input: PassHandoff): string {
  const { entry, pages } = input;
  const said = pages
    .map((p) => p.transcript.trim())
    .filter(Boolean)
    .join("\n");
  if (!said) return "";

  const summary = runSummary(entry);
  return [
    `I have just given this talk out loud — pass ${summary.ordinal}, about ` +
      `${summary.minutes} minute(s) and ${summary.wordsSpoken} words.`,
    "",
    "I may have given the whole talk or only part of it, and I may have gone over",
    "one part several times. Whatever is not below, I left out on purpose, so there",
    "is nothing about it to hear. Nothing recorded which part of the note I was on —",
    "work that out from what I said.",
    "",
    "This is what I said, as the recogniser heard it — a wrong homophone in here is",
    "its mistake and not mine:",
    "",
    said,
  ].join("\n");
}
