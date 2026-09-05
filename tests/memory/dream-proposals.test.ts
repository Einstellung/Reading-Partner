// The rules a night's proposals are held to (src/memory/dream/proposals.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import type { DreamCandidates } from "../../src/memory/dream/candidates";
import { parseProposals, validateProposals } from "../../src/memory/dream/proposals";
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

// Three observations on three different days, and two statements: one the night
// wrote and one the reader wrote.
const candidates: DreamCandidates = {
  observations: [
    observation({ id: "m-1111111111111111", created: "2026-08-01" }),
    observation({ id: "m-2222222222222222", created: "2026-08-02" }),
    observation({ id: "m-3333333333333333", created: "2026-08-01" }),
  ],
  statements: [statement({ id: "s-1" }), statement({ id: "s-2", author: "reader" })],
};

const STATE = { action: "state", kind: "profile", text: "skips the derivations", evidence: [1, 2] };

test("a state with two observations from two days is kept", () => {
  const { accepted, dropped } = validateProposals([STATE], candidates);

  expect(dropped).toBe(0);
  expect(accepted).toEqual([
    { action: "state", kind: "profile", text: "skips the derivations", evidence: [1, 2] },
  ]);
});

test("an evidence number past the end of the list is dropped", () => {
  const { accepted, dropped } = validateProposals([{ ...STATE, evidence: [1, 9] }], candidates);

  expect(accepted).toEqual([]);
  expect(dropped).toBe(1);
});

test("an evidence number below one is dropped", () => {
  const { accepted } = validateProposals([{ ...STATE, evidence: [0, 1] }], candidates);

  expect(accepted).toEqual([]);
});

test("a statement number past the end of the list is dropped", () => {
  const { accepted } = validateProposals(
    [{ action: "support", statement: 5, evidence: [1] }],
    candidates,
  );

  expect(accepted).toEqual([]);
});

test("a state on one observation is dropped", () => {
  const { accepted } = validateProposals([{ ...STATE, evidence: [1] }], candidates);

  expect(accepted).toEqual([]);
});

test("a state on two observations from the same day is dropped", () => {
  const { accepted } = validateProposals([{ ...STATE, evidence: [1, 3] }], candidates);

  expect(accepted).toEqual([]);
});

test("a state whose evidence repeats one observation is dropped", () => {
  const { accepted } = validateProposals([{ ...STATE, evidence: [1, 1] }], candidates);

  expect(accepted).toEqual([]);
});

test("a supersede of a statement the reader wrote is dropped", () => {
  const { accepted, reasons } = validateProposals(
    [{ action: "supersede", statement: 2, text: "no longer true", evidence: [1, 2] }],
    candidates,
  );

  expect(accepted).toEqual([]);
  expect(reasons[0]).toContain("the reader wrote");
});

test("a supersede of a statement the night wrote is kept", () => {
  const { accepted } = validateProposals(
    [{ action: "supersede", statement: 1, text: "no longer true", evidence: [1, 2] }],
    candidates,
  );

  // A bare number comes out as the one-element list the write path walks.
  expect(accepted).toEqual([
    { action: "supersede", statements: [1], text: "no longer true", evidence: [1, 2] },
  ]);
});

// Two statements the night wrote, which is the shape one supersede over several
// is for: the same conclusion twice, once in each language.
const twice: DreamCandidates = {
  observations: candidates.observations,
  statements: [
    statement({ id: "s-1", text: "reads past the maths" }),
    statement({ id: "s-2", text: "看不懂的推导先跳过" }),
    statement({ id: "s-3", author: "reader" }),
  ],
};

test("a supersede may name several statements, deduplicated and in order", () => {
  const { accepted, dropped } = validateProposals(
    [{ action: "supersede", statement: [2, 1, 2], text: "one claim", evidence: [1, 2] }],
    twice,
  );

  expect(dropped).toBe(0);
  expect(accepted).toEqual([
    { action: "supersede", statements: [2, 1], text: "one claim", evidence: [1, 2] },
  ]);
});

test("one target the reader wrote drops the whole supersede", () => {
  const { accepted, reasons } = validateProposals(
    [{ action: "supersede", statement: [1, 3], text: "one claim", evidence: [1, 2] }],
    twice,
  );

  expect(accepted).toEqual([]);
  expect(reasons[0]).toContain("the reader wrote");
});

test("a supersede whose list names nothing on it is dropped", () => {
  for (const statementField of [[], [1, 9], [1, "s-2"], ["s-1"], [1.5]]) {
    const { accepted } = validateProposals(
      [{ action: "supersede", statement: statementField, text: "one claim", evidence: [1, 2] }],
      twice,
    );
    expect(accepted).toEqual([]);
  }
});

test("a supersede is held to the same two-days rule as a state", () => {
  const { accepted } = validateProposals(
    [{ action: "supersede", statement: 1, text: "no longer true", evidence: [1, 3] }],
    candidates,
  );

  expect(accepted).toEqual([]);
});

test("the second state claiming an observation the first one claimed is dropped", () => {
  const { accepted, dropped } = validateProposals(
    [STATE, { ...STATE, text: "another reading", evidence: [2, 3] }],
    candidates,
  );

  expect(accepted).toHaveLength(1);
  expect(accepted[0].action === "state" && accepted[0].text).toBe("skips the derivations");
  expect(dropped).toBe(1);
});

test("two states over disjoint observations are both kept", () => {
  const three = {
    ...candidates,
    observations: [
      ...candidates.observations,
      observation({ id: "m-4444444444444444", created: "2026-08-03" }),
    ],
  };
  const { accepted } = validateProposals(
    [STATE, { ...STATE, text: "another reading", evidence: [3, 4] }],
    three,
  );

  expect(accepted).toHaveLength(2);
});

test("empty text is dropped", () => {
  const { accepted } = validateProposals([{ ...STATE, text: "   " }], candidates);

  expect(accepted).toEqual([]);
});

test("text naming an observation id is dropped", () => {
  const { accepted, reasons } = validateProposals(
    [{ ...STATE, text: "as m-1111111111111111 shows, he skips derivations" }],
    candidates,
  );

  expect(accepted).toEqual([]);
  expect(reasons[0]).toContain("observation id");
});

test("a state of any kind but profile is dropped", () => {
  const { accepted } = validateProposals([{ ...STATE, kind: "concern" }], candidates);

  expect(accepted).toEqual([]);
});

test("an unknown action is dropped", () => {
  const { accepted } = validateProposals([{ action: "forget", evidence: [1] }], candidates);

  expect(accepted).toEqual([]);
});

test("support takes a single new observation", () => {
  const { accepted, dropped } = validateProposals(
    [{ action: "support", statement: 2, evidence: [1] }],
    candidates,
  );

  expect(dropped).toBe(0);
  expect(accepted).toEqual([{ action: "support", statement: 2, evidence: [1] }]);
});

test("one bad proposal is dropped and the rest of the batch is kept", () => {
  const { accepted, dropped } = validateProposals(
    [{ ...STATE, evidence: [99] }, { action: "support", statement: 1, evidence: [2] }],
    candidates,
  );

  expect(dropped).toBe(1);
  expect(accepted).toEqual([{ action: "support", statement: 1, evidence: [2] }]);
});

test("an answer that is not an array yields nothing", () => {
  expect(validateProposals({ action: "state" }, candidates).accepted).toEqual([]);
});

test("the array is read out of a fence and out of surrounding prose", () => {
  expect(parseProposals('```json\n[{"action":"support"}]\n```')).toEqual([
    { action: "support" },
  ]);
  expect(parseProposals('Here is what I found:\n[{"action":"support"}]\nThat is all.')).toEqual([
    { action: "support" },
  ]);
  expect(parseProposals("[]")).toEqual([]);
});

test("a reply with no array in it parses to null", () => {
  expect(parseProposals("nothing came together tonight")).toBeNull();
  expect(parseProposals("[{oops}]")).toBeNull();
  expect(parseProposals('{"action":"state"}')).toBeNull();
});
