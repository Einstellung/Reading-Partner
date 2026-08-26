// The outline panel's logic, without React (docs/44): which segment is up and
// what pressing Next means.
//
// The panel replaced a deck in an iframe, and the one thing that did not change
// is what a rehearsal records. A deck used to post a page turn and the host
// stamped the time; now the reader presses Next and the host stamps the time.
// The event is the same event — `{ kind: "slide", at, index, slideKind, title }`
// — with the segment's position as the index and its id as the kind, so
// buildRun goes on hanging each utterance on whatever was up when it started
// without knowing any of this happened.

import type { RehearsalEvent } from "../../../reading/rehearsal";
import { segmentLabel, type TalkSegment } from "../../../reading/talk";

// One segment going up, as the run records it. The id travels in `slideKind`
// because that field is free text and the run needs an identity that survives
// the outline being reordered between passes; the position travels in `index`
// because that is what buildRun keys a page on.
export function segmentEvent(segment: TalkSegment, index: number, at: number): RehearsalEvent {
  return { kind: "slide", at, index, slideKind: segment.id, title: segmentTitle(segment) };
}

// Whether putting this position up is a move. Jumping to the segment already on
// screen is not: it would leave a departure and an arrival a millisecond apart
// in the run, and it would cut the recording in the middle of a segment.
export function isSegmentChange(events: readonly RehearsalEvent[], index: number): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "slide") continue;
    return e.index !== index;
  }
  return true;
}

// Append a segment event, unless it repeats the segment already on screen.
export function withSegmentEvent(
  events: readonly RehearsalEvent[],
  segment: TalkSegment,
  index: number,
  at: number,
): RehearsalEvent[] {
  if (!isSegmentChange(events, index)) return events.slice();
  return [...events, segmentEvent(segment, index, at)];
}

// The position Next goes to, or null at the end of the outline. Next stops at
// the end rather than wrapping: the pass is over, and wrapping round to the
// opening would record a second visit to it.
export function nextSegmentIndex(current: number, total: number): number | null {
  const next = current + 1;
  return next >= 0 && next < total ? next : null;
}

// What a segment is called on screen. The note has no title field, so the name
// is read off the block itself (reading/talk/types.ts) — one place, because the
// pass handed to the coach has to name a segment the same way the list does.
export function segmentTitle(segment: TalkSegment): string {
  return segmentLabel(segment);
}

// The title of what comes after this one, or null at the end. It is on screen
// the whole time the reader is talking (docs/44): the hard part of giving a talk
// is the turn, and a segment can only be landed somewhere the next one picks up
// from if the next one is known while the current one is still being said.
export function nextTitle(segments: readonly TalkSegment[], current: number): string | null {
  const at = nextSegmentIndex(current, segments.length);
  if (at === null) return null;
  return segmentTitle(segments[at]);
}
