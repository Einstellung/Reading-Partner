// The night's input as bytes (src/memory/dream/materialize.ts). Run: bun test.

import { expect, test } from "bun:test";
import { selectDreamCandidates } from "../../src/memory/dream/candidates";
import { materializeDream } from "../../src/memory/dream/materialize";
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
    text: "reads past the maths",
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

test("an observation renders as one numbered line plus its body", () => {
  const { text } = materializeDream({
    observations: [
      observation({ id: A, type: "belief", created: "2026-08-03", summary: "one line" }),
    ],
    statements: [],
  });

  expect(text).toContain(`1. ${A} | belief | 2026-08-03 | one line`);
  expect(text).toContain("    a body");
});

test("a statement line carries its kind, its author and the span of its evidence", () => {
  const { text } = materializeDream({
    observations: [],
    statements: [statement({ id: "s-7", author: "reader" })],
  });

  expect(text).toContain("1. s-7 | profile | by reader | 2026-07-02..2026-08-01 | reads past the maths");
});

test("both lists say so when they are empty", () => {
  const { text } = materializeDream({ observations: [], statements: [] });

  expect(text.split("\n").filter((l) => l === "(none)")).toHaveLength(2);
});

test("the same input in a different order produces the same bytes and the same hash", () => {
  const one = selectDreamCandidates({
    observations: [observation({ id: A }), observation({ id: B })],
    statements: [statement({ id: "s-1" }), statement({ id: "s-2" })],
  });
  const other = selectDreamCandidates({
    observations: [observation({ id: B }), observation({ id: A })],
    statements: [statement({ id: "s-2" }), statement({ id: "s-1" })],
  });

  expect(materializeDream(one).text).toBe(materializeDream(other).text);
  expect(materializeDream(one).hash).toBe(materializeDream(other).hash);
});

test("one changed character changes the hash", () => {
  const before = materializeDream({ observations: [observation({ id: A })], statements: [] });
  const after = materializeDream({
    observations: [observation({ id: A, summary: "a summarz" })],
    statements: [],
  });

  expect(after.hash).not.toBe(before.hash);
});

test("a removed observation changes the hash the way an added one does", () => {
  const both = materializeDream({
    observations: [observation({ id: A }), observation({ id: B })],
    statements: [],
  });
  const one = materializeDream({ observations: [observation({ id: A })], statements: [] });

  expect(one.hash).not.toBe(both.hash);
});

test("a multi-line body stays indented under its entry", () => {
  const { text } = materializeDream({
    observations: [observation({ id: A, body: "first\nsecond" })],
    statements: [],
  });

  expect(text).toContain("    first\n    second");
});
