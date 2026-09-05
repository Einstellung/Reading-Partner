// One night, against a fake model and a fake store (src/memory/dream/run.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import { materializeDream } from "../../src/memory/dream/materialize";
import { selectDreamCandidates } from "../../src/memory/dream/candidates";
import {
  DREAM_SYSTEM_PROMPT,
  runDream,
  type DreamCallModel,
  type DreamStore,
} from "../../src/memory/dream/run";
import type { Observation } from "../../src/memory/observations/types";
import type { CreateStatementInput, Statement } from "../../src/memory/statements/types";

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

const observations = [
  observation({ id: A, created: "2026-08-01" }),
  observation({ id: B, created: "2026-08-02" }),
];

interface Written {
  created: CreateStatementInput[];
  supported: { id: string; evidence: readonly string[] }[];
  superseded: { id: string; input: CreateStatementInput }[];
  marked: { id: string; byId: string }[];
}

function fakeStore(over: Partial<DreamStore> = {}): DreamStore & { written: Written } {
  const written: Written = { created: [], supported: [], superseded: [], marked: [] };
  return {
    written,
    async createStatement(input) {
      written.created.push(input);
      return statement({ id: "s-new", ...input, contradictedBy: [] });
    },
    async addEvidence(id, evidence) {
      written.supported.push({ id, evidence });
      return statement({ id });
    },
    async supersede(oldId, input) {
      written.superseded.push({ id: oldId, input });
      return statement({ id: "s-new", ...input, contradictedBy: [] });
    },
    async markSuperseded(id, byId) {
      written.marked.push({ id, byId });
      return statement({ id, supersededBy: byId });
    },
    ...over,
  };
}

function answers(reply: string): DreamCallModel & { calls: number } {
  const fn: DreamCallModel & { calls: number } = Object.assign(
    async () => {
      fn.calls += 1;
      return reply;
    },
    { calls: 0 },
  );
  return fn;
}

// The rules that only the prompt can carry: neither is enforceable by a
// function, and both are what the 0.12 store came out wrong on — ten
// conclusions written twice, once in each language, by two runs of one night.
test("the prompt asks for one statement over two, and for the observations' language", () => {
  expect(DREAM_SYSTEM_PROMPT).toContain(
    "When two standing statements say the same thing, supersede both",
  );
  expect(DREAM_SYSTEM_PROMPT).toContain(
    "Write the statement in the language the observations are written in.",
  );
});

test("no candidates: no model call, and the hash still advances", async () => {
  const model = answers("[]");
  const result = await runDream(
    { observations: [], statements: [], lastInputHash: null },
    model,
    fakeStore(),
  );

  expect(result.outcome).toBe("no-change");
  expect(model.calls).toBe(0);
  expect(result.inputHash).not.toBeNull();
});

test("the same input as last night: no model call", async () => {
  const input = { observations, statements: [] };
  const hash = materializeDream(selectDreamCandidates(input)).hash;
  const model = answers("[]");

  const result = await runDream({ ...input, lastInputHash: hash }, model, fakeStore());

  expect(result.outcome).toBe("no-change");
  expect(model.calls).toBe(0);
  expect(result.inputHash).toBe(hash);
});

test("an input that changed by one observation is called for", async () => {
  const hash = materializeDream(selectDreamCandidates({ observations: [], statements: [] })).hash;
  const model = answers("[]");

  const result = await runDream({ observations, statements: [], lastInputHash: hash }, model, fakeStore());

  expect(model.calls).toBe(1);
  expect(result.outcome).toBe("merged");
});

test("a model that throws is a failed night, and the hash does not advance", async () => {
  const result = await runDream(
    { observations, statements: [], lastInputHash: "stale" },
    async () => {
      throw new Error("no provider configured");
    },
    fakeStore(),
  );

  expect(result.outcome).toBe("failed");
  expect(result.inputHash).toBeNull();
});

test("a reply with no JSON array in it is a failed night", async () => {
  const result = await runDream(
    { observations, statements: [], lastInputHash: null },
    answers("I could not find anything tonight."),
    fakeStore(),
  );

  expect(result.outcome).toBe("failed");
  expect(result.inputHash).toBeNull();
});

test("a state is written with the observation ids its numbers stand for", async () => {
  const store = fakeStore();
  const result = await runDream(
    { observations, statements: [], lastInputHash: null },
    answers(
      '[{"action":"state","kind":"profile","text":"skips the derivations","evidence":[1,2]}]',
    ),
    store,
  );

  expect(result).toMatchObject({ outcome: "merged", candidates: 2, written: 1, dropped: 0 });
  expect(store.written.created).toEqual([
    { kind: "profile", text: "skips the derivations", author: "dream", evidence: [A, B] },
  ]);
});

test("support and supersede reach the statement their number stands for", async () => {
  const store = fakeStore();
  const statements = [statement({ id: "s-1" }), statement({ id: "s-2" })];
  await runDream(
    { observations, statements, lastInputHash: null },
    answers(
      '[{"action":"support","statement":1,"evidence":[2]},' +
        '{"action":"supersede","statement":2,"text":"no longer true","evidence":[1,2]}]',
    ),
    store,
  );

  expect(store.written.supported).toEqual([{ id: "s-1", evidence: [B] }]);
  expect(store.written.superseded).toEqual([
    {
      id: "s-2",
      input: { kind: "profile", text: "no longer true", author: "dream", evidence: [A, B] },
    },
  ]);
});

test("one supersede over two statements mints one replacement and points both at it", async () => {
  const store = fakeStore();
  const statements = [statement({ id: "s-1" }), statement({ id: "s-2" })];
  const result = await runDream(
    { observations, statements, lastInputHash: null },
    answers('[{"action":"supersede","statement":[1,2],"text":"one claim","evidence":[1,2]}]'),
    store,
  );

  // The first target mints it; the second is pointed at what came back.
  expect(store.written.superseded).toEqual([
    {
      id: "s-1",
      input: { kind: "profile", text: "one claim", author: "dream", evidence: [A, B] },
    },
  ]);
  expect(store.written.marked).toEqual([{ id: "s-2", byId: "s-new" }]);
  expect(result).toMatchObject({ outcome: "merged", written: 2, dropped: 0 });
});

test("a replacement the store refused leaves the other targets alone", async () => {
  const store = fakeStore({ supersede: async () => null });
  const statements = [statement({ id: "s-1" }), statement({ id: "s-2" })];
  const result = await runDream(
    { observations, statements, lastInputHash: null },
    answers('[{"action":"supersede","statement":[1,2],"text":"one claim","evidence":[1,2]}]'),
    store,
  );

  expect(store.written.marked).toEqual([]);
  expect(result).toMatchObject({ outcome: "merged", written: 0, dropped: 1 });
});

test("a second target the store would not mark costs that target, not the replacement", async () => {
  const store = fakeStore({ markSuperseded: async () => null });
  const statements = [statement({ id: "s-1" }), statement({ id: "s-2" })];
  const result = await runDream(
    { observations, statements, lastInputHash: null },
    answers('[{"action":"supersede","statement":[1,2],"text":"one claim","evidence":[1,2]}]'),
    store,
  );

  expect(store.written.superseded).toHaveLength(1);
  expect(result).toMatchObject({ outcome: "merged", written: 1, dropped: 1 });
});

test("an empty array is a merged night that wrote nothing", async () => {
  const result = await runDream(
    { observations, statements: [], lastInputHash: null },
    answers("[]"),
    fakeStore(),
  );

  expect(result).toMatchObject({ outcome: "merged", written: 0, dropped: 0 });
  expect(result.inputHash).not.toBeNull();
});

test("a proposal the rules threw away is counted, and the rest of the batch is written", async () => {
  const store = fakeStore();
  const result = await runDream(
    { observations, statements: [statement({ id: "s-1" })], lastInputHash: null },
    answers(
      '[{"action":"state","kind":"profile","text":"one day only","evidence":[1]},' +
        '{"action":"support","statement":1,"evidence":[1]}]',
    ),
    store,
  );

  expect(result).toMatchObject({ outcome: "merged", written: 1, dropped: 1 });
  expect(store.written.created).toEqual([]);
});

test("a write the store refuses costs one proposal, not the night", async () => {
  const store = fakeStore({
    createStatement: async () => {
      throw new Error("statement evidence names no observation");
    },
  });
  const result = await runDream(
    { observations, statements: [statement({ id: "s-1" })], lastInputHash: null },
    answers(
      '[{"action":"state","kind":"profile","text":"skips the derivations","evidence":[1,2]},' +
        '{"action":"support","statement":1,"evidence":[2]}]',
    ),
    store,
  );

  expect(result).toMatchObject({ outcome: "merged", written: 1, dropped: 1 });
  expect(result.inputHash).not.toBeNull();
});

test("a support of a statement that has since gone away is counted as dropped", async () => {
  const store = fakeStore({ addEvidence: async () => null });
  const result = await runDream(
    { observations, statements: [statement({ id: "s-1" })], lastInputHash: null },
    answers('[{"action":"support","statement":1,"evidence":[1]}]'),
    store,
  );

  expect(result).toMatchObject({ outcome: "merged", written: 0, dropped: 1 });
});
