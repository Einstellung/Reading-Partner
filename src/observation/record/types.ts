// Per-topic AI observations (docs/02 part 2, M8): one observation per markdown
// file with a small frontmatter, plus an index file (one line per observation)
// that is what gets loaded into context. Dates are absolute ("YYYY-MM-DD") at
// write time.

// can-explain / cannot-explain come out of a rehearsal (docs/31): the reader has
// finished the book and is being asked to give it back out loud. They are not
// stuck-point in a milder form — stuck-point is not having understood it while
// reading, these two are having understood it and not being able to say it. Nor
// are they one neutral type with a verdict inside, because what the next
// rehearsal keeps when the window is tight is decided by type order
// (reading/talks/turn.ts), and "cannot say this chapter" has to sort near the top.
export const OBSERVATION_TYPES = [
  "reading-position",
  "stuck-point",
  "cannot-explain",
  "can-explain",
  "understood-concept",
  "belief",
  "correction",
] as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export function isObservationType(v: string): v is ObservationType {
  return (OBSERVATION_TYPES as readonly string[]).includes(v);
}

// Evidence anchors: an observation points back to its sources — annotation ids
// and/or message ids ("<threadId>:<ts>") — so it can be traced to the original
// marks and conversation turns.
export interface EvidenceAnchors {
  annotationIds: string[];
  messageIds: string[];
}

export interface Observation {
  id: string;
  type: ObservationType;
  // One line, shown in the index and the opening snapshot.
  summary: string;
  // Full markdown body; evolutions ("was stuck on X, resolved on <date>") live here.
  body: string;
  created: string; // YYYY-MM-DD
  updated: string; // YYYY-MM-DD
  anchors: EvidenceAnchors;
  // The book this was observed on (library.ts content hash). Absent on every
  // observation written before it existed, and on anything not about one book.
  //
  // Observations are stored per topic and a topic is several books, so "which
  // book is this about" had only one answer: reverse-lookup the annotation ids
  // in anchors against that book's annotations file. That still works and is
  // still the fallback; this field is the same answer without the lookup, and
  // the only answer for an observation whose evidence is messages rather than
  // marks. Page numbers in the body are not an answer at all — two of the books
  // measured have the same page range about different subjects (docs/09).
  bookId?: string;
}

// The per-line view of the index file — everything the snapshot needs without
// reading the observation bodies.
export interface ObservationIndexEntry {
  id: string;
  type: ObservationType;
  summary: string;
  updated: string; // YYYY-MM-DD
}

export interface RetainInput {
  type: ObservationType;
  summary: string;
  body: string;
  anchors?: Partial<EvidenceAnchors>;
  // Stamped by the caller that mounted the tools, never asked of the model: the
  // book being read is a fact about the session, and a model asked for it fills
  // it in wrong.
  bookId?: string;
}

// A correction patch; every field optional, anchors replace when given.
export interface ObservationPatch {
  type?: ObservationType;
  summary?: string;
  body?: string;
  anchors?: Partial<EvidenceAnchors>;
  bookId?: string;
}

export interface ObservationHit {
  entry: Observation;
  score: number;
  snippet: string;
}
