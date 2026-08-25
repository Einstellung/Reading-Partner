// The outline panel's logic, without React (docs/44): which segment is up, what
// pressing Next means, and whether what is on this segment can be on one screen.
//
// The panel replaced a deck in an iframe, and the one thing that did not change
// is what a rehearsal records. A deck used to post a page turn and the host
// stamped the time; now the reader presses Next and the host stamps the time.
// The event is the same event — `{ kind: "slide", at, index, slideKind, title }`
// — with the segment's position as the index and its id as the kind, so
// buildRun goes on hanging each utterance on whatever was up when it started
// without knowing any of this happened.

import type { RehearsalEvent } from "../../../reading/rehearsal";
import type { TalkSegment } from "../../../reading/talk";

// One segment going up, as the run records it. The id travels in `slideKind`
// because that field is free text and the run needs an identity that survives
// the outline being reordered between passes; the position travels in `index`
// because that is what buildRun keys a page on.
export function segmentEvent(segment: TalkSegment, index: number, at: number): RehearsalEvent {
  return { kind: "slide", at, index, slideKind: segment.id, title: segment.title };
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

// The title a segment shows, which is never empty: an untitled segment still has
// to be pickable out of the jump list.
export function segmentTitle(segment: TalkSegment): string {
  return segment.title.trim() || "Untitled segment";
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

// The segment a callback pays back, by id, or null when the outline no longer
// has it — a segment can be removed while another still points at it.
export function callbackLabel(
  segments: readonly TalkSegment[],
  segment: TalkSegment,
): string | null {
  if (!segment.callback) return null;
  const at = segments.findIndex((s) => s.id === segment.callback);
  if (at < 0) return null;
  return `${at + 1}. ${segmentTitle(segments[at])}`;
}

/**
 * One formula as markdown the app's renderer will set as display maths.
 *
 * The fences go on their own lines because that is the only shape remark reads
 * as a block (docs/pitfall — see markdown/mathFences.ts): a `$$` with anything
 * after it on the same line opens a block that loses its first line and never
 * closes. A formula stored with its own fences is unwrapped first rather than
 * fenced twice, since a talk's material is written by hand and by the AI and
 * both write it both ways.
 */
export function displayMath(tex: string): string {
  let body = tex.trim();
  while (body.startsWith("$$")) body = body.slice(2).trim();
  while (body.endsWith("$$")) body = body.slice(0, -2).trim();
  return `$$\n${body}\n$$`;
}

// How wide a run of text is, in columns. An ideograph, a kana and a hangul
// syllable are drawn about twice as wide as a Latin letter at the same size, so
// counting characters would let a Chinese segment overflow at half the length
// this reads as. Same character ranges the word count uses
// (reading/rehearsal/summary.ts), written as code points rather than pasted as
// glyphs (docs/pitfall/170).
const WIDE_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7a3]/gu;

export function columns(text: string): number {
  const wide = text.match(WIDE_CHAR)?.length ?? 0;
  return [...text].length + wide;
}

// The panel's budget, in lines of the size a cue is given. Deliberately coarse:
// the question it answers is "is this segment obviously too much for a screen",
// and the answer has to be the same on every device and in a test, which rules
// out measuring the DOM. A first guess, to be moved once talks have been given
// against it.
const CUE_COLUMNS = 40;
const SCREEN_LINES = 14;
const TITLE_LINES = 2;
const CALLBACK_LINES = 1;
// A formula is one band whatever it says; a figure is the tall thing on the
// screen, and a figure with no picture behind it is its description.
const TEX_LINES = 3;
const FIGURE_LINES = 7;
const FIGURE_DESCRIPTION_COLUMNS = 64;

function wrapped(text: string, width: number): number {
  return Math.max(1, Math.ceil(columns(text) / width));
}

/** How many lines of the panel this segment wants. */
export function segmentLines(segment: TalkSegment): number {
  let lines = TITLE_LINES;
  for (const cue of segment.cues) lines += wrapped(cue, CUE_COLUMNS);
  for (const m of segment.material) {
    if (m.kind === "tex") lines += TEX_LINES;
    else if (m.figId) lines += FIGURE_LINES;
    else lines += wrapped(m.description, FIGURE_DESCRIPTION_COLUMNS);
  }
  if (segment.callback) lines += CALLBACK_LINES;
  return lines;
}

/**
 * What the panel says when a segment does not fit, or null when it does.
 *
 * Nothing is shrunk to make it fit. A segment that wants two screens is a
 * segment that wants splitting (docs/44) — the panel is what holds the outline
 * to one screenful each, and a font size that quietly stepped down would take
 * that away and give back nothing.
 */
export function overflowNotice(segment: TalkSegment): string | null {
  if (segmentLines(segment) <= SCREEN_LINES) return null;
  return "This segment is longer than one screen. Split it — the panel will not shrink it to fit.";
}
