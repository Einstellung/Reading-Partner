// Per-topic AI observations (docs/02 part 2, M8): one observation per markdown
// file with a small frontmatter, plus an index file (one line per observation)
// that is what gets loaded into context. Dates are absolute ("YYYY-MM-DD") at
// write time.

export const OBSERVATION_TYPES = [
  "reading-position",
  "stuck-point",
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
}

// A correction patch; every field optional, anchors replace when given.
export interface ObservationPatch {
  type?: ObservationType;
  summary?: string;
  body?: string;
  anchors?: Partial<EvidenceAnchors>;
}

export interface ObservationHit {
  entry: Observation;
  score: number;
  snippet: string;
}
