// The two records the memory tests are written in terms of: one observation and
// one statement, filled in far enough to be valid and overridden field by field
// at the call site.
//
// Pure data — no module-level state, so a file that takes one of these is not
// affected by which other file ran first.
//
// The defaults are the ones the dream tests were written against. A file that
// needs a different shape of record (an observation anchored to a book, a
// statement with another author's wording) says so where it differs rather than
// keeping a second copy of the whole literal.

import type { Observation } from "../../src/memory/observations/types";
import type { Statement } from "../../src/memory/statements/types";

export function observation(over: Partial<Observation> & { id: string }): Observation {
  return {
    type: "stuck-point",
    summary: "a summary",
    body: "a body",
    created: "2026-08-01",
    updated: "2026-08-01",
    anchors: { annotationIds: [], messageIds: [] },
    ...over,
  };
}

export function statement(over: Partial<Statement> & { id: string }): Statement {
  return {
    kind: "profile",
    text: "reads past the maths",
    author: "dream",
    evidence: [],
    contradictedBy: [],
    established: "2026-07-02",
    lastSupported: "2026-08-01",
    ...over,
  };
}
