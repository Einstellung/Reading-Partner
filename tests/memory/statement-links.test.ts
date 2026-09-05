// The reverse edges from an observation to the statements built on it
// (src/memory/statements/links.ts), and the definition of an observation having
// been read. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildStatementIndex,
  coveredObservationIds,
  statementsContradictedBy,
  statementsFrom,
} from "../../src/memory/statements/links";
import type { Statement } from "../../src/memory/statements/types";

function statement(over: Partial<Statement> & { id: string }): Statement {
  return {
    kind: "profile",
    text: "about the reader",
    author: "dream",
    evidence: [],
    contradictedBy: [],
    established: "2026-07-02",
    lastSupported: "2026-08-01",
    ...over,
  };
}

const A = "m-1111111111111111";
const B = "m-2222222222222222";
const C = "m-3333333333333333";

test("an observation finds every statement resting on it, in list order", () => {
  const one = statement({ id: "s-1", evidence: [A, B] });
  const two = statement({ id: "s-2", evidence: [A] });
  const index = buildStatementIndex([one, two]);

  expect(statementsFrom(index, A)).toEqual([one, two]);
  expect(statementsFrom(index, B)).toEqual([one]);
  expect(statementsFrom(index, C)).toEqual([]);
});

test("evidence and contradiction are two maps, and the same observation can be in both", () => {
  const one = statement({ id: "s-1", evidence: [A] });
  const two = statement({ id: "s-2", evidence: [B], contradictedBy: [A] });
  const index = buildStatementIndex([one, two]);

  expect(statementsFrom(index, A)).toEqual([one]);
  expect(statementsContradictedBy(index, A)).toEqual([two]);
  expect(statementsContradictedBy(index, B)).toEqual([]);
});

// A message anchor is a turn of a conversation, not an observation, and asking
// for one by string would be a lookup in the wrong namespace.
test("message anchors in the evidence are in neither map", () => {
  const one = statement({ id: "s-1", evidence: [A, "t-0123456789abcdef@thread-1:1750000000000"] });
  const index = buildStatementIndex([one]);

  expect(statementsFrom(index, A)).toEqual([one]);
  expect(statementsFrom(index, "t-0123456789abcdef@thread-1:1750000000000")).toEqual([]);
  expect([...index.evidence.keys()]).toEqual([A]);
});

test("an observation is covered when a standing statement rests on it", () => {
  const covered = coveredObservationIds([
    statement({ id: "s-1", evidence: [A, B] }),
    // Contradicting an observation is not resting on it.
    statement({ id: "s-2", evidence: [B], contradictedBy: [C] }),
  ]);
  expect([...covered].sort()).toEqual([A, B]);
});

// A superseded statement is kept on disk as the reading it was, but it stops
// speaking for its evidence the moment it is replaced. Whatever the old one
// cited and the new one did not is back in front of the reader.
test("a superseded statement covers nothing", () => {
  const old = statement({ id: "s-1", evidence: [A, B], supersededBy: "s-2" });
  const next = statement({ id: "s-2", evidence: [B, C] });

  expect([...coveredObservationIds([old, next])].sort()).toEqual([B, C]);
  // The edge is still there — what an observation has ever been read as is a
  // different question from what stands now.
  expect(statementsFrom(buildStatementIndex([old, next]), A)).toEqual([old]);
  expect(coveredObservationIds([old]).size).toBe(0);
});

test("a message anchor is not an observation to be covered", () => {
  const covered = coveredObservationIds([
    statement({ id: "s-1", evidence: ["thread-1:1750000000000", A] }),
  ]);
  expect([...covered]).toEqual([A]);
});
