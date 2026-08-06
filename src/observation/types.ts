// Per-topic memory (docs/02 part 2, M8): one fact per markdown file with a
// small frontmatter, plus an index file (one line per memory) that is what gets
// loaded into context. Dates are absolute ("YYYY-MM-DD") at write time.

export const MEMORY_TYPES = [
  "reading-position",
  "stuck-point",
  "understood-concept",
  "belief",
  "correction",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export function isMemoryType(v: string): v is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(v);
}

// Evidence anchors: a memory points back to its sources — annotation ids and/or
// message ids ("<threadId>:<ts>") — so it can be traced to the original marks
// and conversation turns.
export interface EvidenceAnchors {
  annotationIds: string[];
  messageIds: string[];
}

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  // One line, shown in the index and the opening snapshot.
  summary: string;
  // Full markdown body; evolutions ("was stuck on X, resolved on <date>") live here.
  body: string;
  created: string; // YYYY-MM-DD
  updated: string; // YYYY-MM-DD
  anchors: EvidenceAnchors;
}

// The per-line view of the index file — everything the snapshot needs without
// reading the memory bodies.
export interface MemoryIndexEntry {
  id: string;
  type: MemoryType;
  summary: string;
  updated: string; // YYYY-MM-DD
}

export interface RetainInput {
  type: MemoryType;
  summary: string;
  body: string;
  anchors?: Partial<EvidenceAnchors>;
}

// A correction patch; every field optional, anchors replace when given.
export interface MemoryPatch {
  type?: MemoryType;
  summary?: string;
  body?: string;
  anchors?: Partial<EvidenceAnchors>;
}

export interface MemoryHit {
  entry: MemoryEntry;
  score: number;
  snippet: string;
}
