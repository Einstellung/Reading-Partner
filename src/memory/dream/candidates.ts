// What one night of dream is allowed to look at (docs/48, "dream").
//
// Two lists, and both are facts on disk rather than anything ranked: the
// observations no standing statement has read yet, and the statements that
// still stand. There is no window and no nightly cap — the store is in the
// hundreds and the whole of it is cheap to read, while every precedent's window
// constant was tuned for a corpus three orders of magnitude bigger (docs/49,
// "明确拒绝": copying one is how "12 lines per topic hid 74% of the records"
// happened).
//
// Pure. live.ts reads the two stores and hands the lists over.

import { coveredObservationIds } from "../statements/links";
import type { Statement } from "../statements/types";
import type { Observation } from "../observations/types";

export interface DreamInput {
  // Every observation there is, across every topic. Cross-topic on purpose: a
  // statement is about the reader, not about a book, and a per-topic pass could
  // never write one that two topics support.
  observations: readonly Observation[];
  // Every statement there is, superseded ones included — being superseded is
  // what this file reads off them.
  statements: readonly Statement[];
}

export interface DreamCandidates {
  // Observations nothing standing rests on yet, by id.
  observations: Observation[];
  // Statements that have not been superseded, by id.
  statements: Statement[];
}

// A reading position is where the reader had got to, not something to conclude
// anything from: it is rewritten as they read, and a statement resting on one
// would be a claim about a bookmark.
const IGNORED_TYPES = new Set(["reading-position"]);

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Sorted by id and deduplicated by it, because the bytes materialize.ts hashes
// have to be a function of the content alone. Topic order is a directory
// listing, and a store read in a different order two nights running would look
// like a changed input and pay for a model call that has nothing new to say.
function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.sort(byId);
}

export function selectDreamCandidates(input: DreamInput): DreamCandidates {
  const covered = coveredObservationIds(input.statements);
  const observations = input.observations.filter(
    (o) => !covered.has(o.id) && !IGNORED_TYPES.has(o.type),
  );
  return {
    observations: uniqueById(observations),
    statements: uniqueById(input.statements.filter((s) => !s.supersededBy)),
  };
}
