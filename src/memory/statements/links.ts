// The other direction of the two edges a statement carries. A statement names
// the observations it rests on and the ones that argue against it; going the
// other way — "what has been concluded from this observation" — meant reading
// every statement.
//
// Here rather than in observations/links.ts because the dependency only runs
// one way: statements read observations, observations know nothing about
// statements. The reverse import is what would put the two directories in a
// cycle (tests/layering.test.ts).
//
// Pure functions over the statement list the caller already holds. The list is
// one file read, so neither of these adds I/O.

import { isObservationId } from "./dates";
import type { Statement } from "./types";

// Two maps rather than one, for the reason observations/links.ts keeps its two
// apart: an observation cited as evidence and the same observation recorded as
// a contradiction are opposite facts, and a merged map could never tell them
// apart again.
export interface StatementIndex {
  evidence: ReadonlyMap<string, readonly Statement[]>;
  contradictions: ReadonlyMap<string, readonly Statement[]>;
}

function push(map: Map<string, Statement[]>, key: string, statement: Statement): void {
  const bucket = map.get(key);
  if (!bucket) {
    map.set(key, [statement]);
    return;
  }
  if (bucket[bucket.length - 1] !== statement) bucket.push(statement);
}

// Keyed by observation id alone. A message anchor in `evidence` is deliberately
// not in either map: it is a different namespace, it takes three forms for one
// turn (anchors.ts), and a caller holding a message asks with the message
// rather than with a string — which is a lookup this file would have to grow a
// second shape for, and nothing needs yet.
//
// Buckets keep the order of the list they were built from; this never sorts.
export function buildStatementIndex(statements: readonly Statement[]): StatementIndex {
  const evidence = new Map<string, Statement[]>();
  const contradictions = new Map<string, Statement[]>();
  for (const statement of statements) {
    for (const id of statement.evidence) {
      if (isObservationId(id)) push(evidence, id, statement);
    }
    for (const id of statement.contradictedBy) {
      if (isObservationId(id)) push(contradictions, id, statement);
    }
  }
  return { evidence, contradictions };
}

// The statements resting on one observation, superseded ones included: what an
// observation has ever been read as is a different question from what is held
// to be true now, and only the second one drops them (coveredObservationIds).
export function statementsFrom(index: StatementIndex, observationId: string): readonly Statement[] {
  return index.evidence.get(observationId) ?? [];
}

export function statementsContradictedBy(
  index: StatementIndex,
  observationId: string,
): readonly Statement[] {
  return index.contradictions.get(observationId) ?? [];
}

// The observations some standing statement rests on — the whole definition of
// having been read, kept as a function of the statements rather than as a flag
// on the observation. A flag would be a second copy of this fact that a
// supersede has to remember to clear, on a file that syncs, on two devices.
//
// A superseded statement covers nothing: the reading that replaced it stands on
// its own evidence, and whatever the old one cited and the new one did not is
// back in front of the reader where it belongs.
//
// Message anchors in `evidence` are not observations and are not here.
export function coveredObservationIds(statements: readonly Statement[]): Set<string> {
  const covered = new Set<string>();
  for (const statement of statements) {
    if (statement.supersededBy) continue;
    for (const id of statement.evidence) if (isObservationId(id)) covered.add(id);
  }
  return covered;
}
