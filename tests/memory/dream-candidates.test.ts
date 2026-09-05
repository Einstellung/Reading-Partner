// What a night is offered (src/memory/dream/candidates.ts). Run: bun test.

import { expect, test } from "bun:test";
import { selectDreamCandidates } from "../../src/memory/dream/candidates";
import type { Observation } from "../../src/memory/observations/types";
import type { Statement } from "../../src/memory/statements/types";

function observation(over: Partial<Observation> & { id: string }): Observation {
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

test("an observation a standing statement rests on is not a candidate", () => {
  const picked = selectDreamCandidates({
    observations: [observation({ id: A }), observation({ id: B })],
    statements: [statement({ id: "s-1", evidence: [A] })],
  });

  expect(picked.observations.map((o) => o.id)).toEqual([B]);
});

test("a superseded statement covers nothing, so its evidence is a candidate again", () => {
  const picked = selectDreamCandidates({
    observations: [observation({ id: A })],
    statements: [statement({ id: "s-1", evidence: [A], supersededBy: "s-2" })],
  });

  expect(picked.observations.map((o) => o.id)).toEqual([A]);
  expect(picked.statements).toEqual([]);
});

test("reading-position observations are never candidates", () => {
  const picked = selectDreamCandidates({
    observations: [observation({ id: A, type: "reading-position" }), observation({ id: B })],
    statements: [],
  });

  expect(picked.observations.map((o) => o.id)).toEqual([B]);
});

test("both lists come back sorted by id, whatever order they arrived in", () => {
  const picked = selectDreamCandidates({
    observations: [observation({ id: C }), observation({ id: A }), observation({ id: B })],
    statements: [statement({ id: "s-9" }), statement({ id: "s-2" })],
  });

  expect(picked.observations.map((o) => o.id)).toEqual([A, B, C]);
  expect(picked.statements.map((s) => s.id)).toEqual(["s-2", "s-9"]);
});

test("the same observation read out of two topics appears once", () => {
  const picked = selectDreamCandidates({
    observations: [observation({ id: A }), observation({ id: A })],
    statements: [],
  });

  expect(picked.observations).toHaveLength(1);
});

test("statements that stand are every statement without a successor", () => {
  const picked = selectDreamCandidates({
    observations: [],
    statements: [
      statement({ id: "s-1" }),
      statement({ id: "s-2", supersededBy: "s-3" }),
      statement({ id: "s-3" }),
    ],
  });

  expect(picked.statements.map((s) => s.id)).toEqual(["s-1", "s-3"]);
});
