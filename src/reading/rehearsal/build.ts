// Events in, one run out. The whole of what a rehearsal means is here, and it
// is a pure function: the deck reports pages, the transcript source reports
// utterances, and neither of them has to know what a run looks like on disk.
//
// The rules, in one place because they are the layer:
//   - An utterance belongs to whichever page was up at the moment it started.
//     A sentence that runs past a page turn counts for the page it began on —
//     the reader was talking about that page and then moved on, not the other
//     way round.
//   - Anything said before the first slide event is dropped. Nothing was on
//     screen yet, so it belongs to no page, and there is no bin for it. That is
//     the normal case (the microphone opens before the deck does), not an error.
//   - A page revisited is one page, not two. Its transcript is both visits.
//   - Events are sorted by their timestamp before anything is decided, so a
//     source that reports an utterance a moment late does not shuffle the
//     transcript into the wrong page.

import type { BuiltRun, RehearsalEvent, RehearsalPage } from "./types";

export interface BuildRunInput {
  id: string;
  ordinal: number;
  rehearsalId: string;
  startedAt: number;
  events: readonly RehearsalEvent[];
}

// At one instant, the page change happened before anything said at that
// instant, and the run ended after everything said at it. Otherwise the first
// utterance of a page could land on the previous one, and the last word before
// the reader stopped could be lost.
const ORDER: Record<RehearsalEvent["kind"], number> = { slide: 0, utterance: 1, end: 2 };

function sorted(events: readonly RehearsalEvent[]): RehearsalEvent[] {
  return events
    .map((event, seq) => ({ event, seq }))
    .sort((a, b) => {
      if (a.event.at !== b.event.at) return a.event.at - b.event.at;
      if (ORDER[a.event.kind] !== ORDER[b.event.kind]) {
        return ORDER[a.event.kind] - ORDER[b.event.kind];
      }
      // Two of a kind at one millisecond keep the order they were reported in.
      return a.seq - b.seq;
    })
    .map((e) => e.event);
}

// One newline between what was said at two different moments, and never a blank
// line: the transcript is read as prose, and an empty utterance (a source that
// heard nothing) must not open a gap in it.
function appendSaid(transcript: string, text: string): string {
  const said = text.trim();
  if (!said) return transcript;
  return transcript ? `${transcript}\n${said}` : said;
}

export function buildRun(input: BuildRunInput): BuiltRun {
  const pages = new Map<number, RehearsalPage>();
  let current: RehearsalPage | null = null;
  let endedAt: number | null = null;

  for (const event of sorted(input.events)) {
    if (event.kind === "end") {
      // The first end is the end. A run cannot resume, so whatever a source
      // reports after it is not part of this run.
      endedAt = event.at;
      if (current) current.leftAt = event.at;
      break;
    }
    if (event.kind === "utterance") {
      // Before the first slide there is no page to hang it on.
      if (current) current.transcript = appendSaid(current.transcript, event.text);
      continue;
    }
    // A slide event: the deck says what is on screen now. It re-sends on resize,
    // so the same index twice in a row is the same visit — not a departure and
    // an arrival a millisecond apart, which would split the page's time in two
    // and leave a leftAt that never happened.
    let page = pages.get(event.index);
    if (!page) {
      page = {
        index: event.index,
        kind: event.slideKind,
        title: event.title,
        enteredAt: event.at,
        leftAt: null,
        transcript: "",
      };
      pages.set(event.index, page);
    } else {
      // The deck is the authority on what a page is called; a later report of
      // the same page wins, so an edit mid-run does not leave a stale title.
      page.kind = event.slideKind;
      page.title = event.title;
    }
    if (current === page) continue;
    if (current) current.leftAt = event.at;
    // Coming back to a page reopens it: leftAt is the last departure, and this
    // visit has not ended yet.
    page.leftAt = null;
    current = page;
  }

  return {
    id: input.id,
    ordinal: input.ordinal,
    rehearsalId: input.rehearsalId,
    startedAt: input.startedAt,
    endedAt,
    pages: [...pages.values()].sort((a, b) => a.index - b.index),
  };
}
