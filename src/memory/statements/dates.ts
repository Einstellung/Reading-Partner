// Dating a statement from its evidence, pure. A statement carries no date a
// model wrote: `established` and `lastSupported` are the first and last day the
// things it points at actually cover.
//
// Two kinds of evidence date differently. An observation is already dated by
// its own evidence and covers a span (created…updated), so a statement built on
// one inherits that whole span. A message anchor is one turn of a conversation
// and covers the day that turn happened, on the reader's own clock — localDate
// rather than isoDate, because at UTC+8 an hour of late-night reading falls on
// the previous UTC day and would be written up as the day before.

import { parseMessageAnchor } from "../observations/anchors";
import { localDate } from "../observations/files";

// A closed span of days, both ends inclusive, "YYYY-MM-DD".
export interface DaySpan {
  first: string;
  last: string;
}

// Either width while both exist on disk: the 0.12 migration widens observation
// ids from 8 hex to 16 and a device that has not run it still writes narrow
// ones (src/migrate). Narrows to 16 at 0.13, with the rest of them.
const OBSERVATION_ID = /^m-(?:[0-9a-f]{16}|[0-9a-f]{8})$/;

// Whether a piece of evidence names an observation rather than a message. Asked
// first, because a bare observation id would otherwise parse as a message
// anchor's id half and resolve against nothing.
export function isObservationId(evidence: string): boolean {
  return OBSERVATION_ID.test(evidence.trim());
}

// The day a message anchor points at, or null when the anchor carries no
// timestamp to date. Null is the answer for the id-only form ("t-<16hex>",
// written where the thread was not in scope): it names a turn without saying
// when that turn was, and nothing here can find out.
export function anchorSpan(evidence: string): DaySpan | null {
  const parsed = parseMessageAnchor(evidence);
  if (!parsed || parsed.ts === undefined) return null;
  if (!Number.isFinite(parsed.ts) || parsed.ts <= 0) return null;
  const day = localDate(parsed.ts);
  return { first: day, last: day };
}

// The span covering every one of them. Null for an empty list — a statement
// with nothing behind it has no date, and that is a refusal rather than a
// default.
export function unionSpans(spans: readonly DaySpan[]): DaySpan | null {
  let first: string | null = null;
  let last: string | null = null;
  for (const span of spans) {
    if (first === null || span.first < first) first = span.first;
    if (last === null || span.last > last) last = span.last;
  }
  return first === null || last === null ? null : { first, last };
}

// The later of two days. `lastSupported` never moves backwards: evidence is
// appended oldest-first as often as newest-first (a dream pass works through a
// backlog), and a statement must not look staler for having been given more to
// stand on.
export function laterDay(a: string, b: string): string {
  return a > b ? a : b;
}
