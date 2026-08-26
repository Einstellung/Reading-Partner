// A pass, written out for the conversation (docs/44: stopping is handing it in).
//
// The transcript reaches the coach as one message from the reader, in the
// conversation anchored on the outline — so the second pass is read with the
// first pass and everything said about it still in the thread. Which is why this
// is a message and not a prompt section: a prompt section would be replaced by
// the next pass, and "come back and give it again" is the whole point.
//
// The one thing it has to be exact about is coverage. A pass is the segments
// given this time and not "the nth time through" (types.ts), so going over one
// segment five times is five passes of one segment each — and a coach that
// judged the talk on a pass covering three of twelve would be marking the reader
// down for the nine they deliberately skipped.

import { segmentLabel, type TalkOutline } from "../talk";
import { runSummary } from "./summary";
import type { RehearsalPage, RehearsalRunEntry } from "./types";

export interface PassHandoff {
  // The pass as the store recorded it, for the ordinal and the counts.
  entry: RehearsalRunEntry;
  // What was said, one entry per segment that was up (store.ts keeps these in a
  // file of their own).
  pages: readonly RehearsalPage[];
  // The talk as it stands, for the numbering and the titles. Read at handoff
  // time rather than when the pass started: a segment renamed mid-pass is named
  // here the way the reader will see it in the outline.
  outline: TalkOutline;
}

// "1, 2 and 5" — the way the reader would say which segments they gave.
function listed(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The message a finished pass puts into the talk's conversation, as the reader.
 *
 * Empty when nothing was said at all: a pass that recorded segments and no words
 * — no STT key on the desktop, no dictation on the host — has nothing for a
 * coach to hear, and a message saying so would only invite a reply about the
 * silence.
 */
export function passMessage(input: PassHandoff): string {
  const { entry, pages, outline } = input;
  const place = new Map(outline.segments.map((s, i) => [s.id, i + 1]));
  if (!pages.some((p) => p.transcript.trim())) return "";

  const summary = runSummary(entry);
  const label = (page: RehearsalPage): string => {
    const at = place.get(page.kind);
    const found = outline.segments.find((s) => s.id === page.kind);
    const title = found ? segmentLabel(found) : page.title;
    // A segment dropped from the talk between passes has no place in it any
    // more, and saying so is better than printing a number that now belongs to
    // somebody else.
    const head = at ? `Segment ${at}` : "A segment that is no longer in the talk";
    return `${head}. ${title || "(untitled)"}${page.kind ? ` (id: ${page.kind})` : ""}`;
  };

  const given = pages.map((p) => `${place.get(p.kind) ?? "?"}`);
  const total = outline.segments.length;
  const lines: string[] = [
    `I have just given this talk out loud — pass ${summary.ordinal}, about ` +
      `${summary.minutes} minute(s) and ${summary.wordsSpoken} words.`,
    "",
    given.length >= total
      ? `I went through all ${total} segment(s).`
      : `I gave ${given.length} of the ${total} segment(s) in the talk: ${listed(given)}. ` +
        "I did not give the rest this time, so there is nothing about them to hear.",
    "",
    "This is what I said, as the recogniser heard it — a wrong homophone in here is",
    "its mistake and not mine:",
  ];
  for (const page of pages) {
    lines.push("", `--- ${label(page)} ---`);
    lines.push(page.transcript.trim() || "(I said nothing on this one.)");
  }
  return lines.join("\n");
}
