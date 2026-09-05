// The immutable write path (docs/48): what observation_update accepts once a
// relation mount is on it. Three things are being pinned here — a row number
// only ever reaches disk as the id it was printed for, a body is never
// rewritten, and nothing lands at all when the id gate refuses.

import { expect, test } from "bun:test";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { ObservationFileStore } from "../../src/memory/observations/store";
import {
  buildObservationTools,
  unresolvedIds,
  type RelationMount,
  type WriteRejection,
  type WriteRelationOutcome,
} from "../../src/memory/observations/tools";
import type { TranscriptLine } from "../../src/memory/observations/transcript";
import { JULY_17, makeFakeFs } from "./fakefs";

function lines(...anchors: string[]): TranscriptLine[] {
  return anchors.map((anchor, i) => ({
    index: i + 1,
    anchor,
    date: "2026-07-17",
    role: "user" as const,
    text: "…",
  }));
}

interface Edge {
  kind: "evidence" | "contradiction";
  statementId: string;
  observationIds: string[];
}

// A mount over a real store, with the statement edges recorded rather than
// written: the statement store has its own tests, and what matters here is
// which id the row number turned into.
function mount(
  opts: {
    observations?: string[];
    statements?: string[];
    messageLines?: TranscriptLine[];
    annotations?: string[];
    requireAnchor?: boolean;
  } = {},
) {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore("t", fs, () => JULY_17);
  const adapter = new FileObservationAdapter(store);
  const edges: Edge[] = [];
  const writes: [string, WriteRelationOutcome | undefined][] = [];
  const rejects: WriteRejection[] = [];
  const relations: RelationMount = {
    observations: opts.observations ?? [],
    statements: opts.statements ?? [],
    async addEvidence(statementId, observationIds) {
      edges.push({ kind: "evidence", statementId, observationIds: [...observationIds] });
    },
    async addContradiction(statementId, observationId) {
      edges.push({ kind: "contradiction", statementId, observationIds: [observationId] });
    },
  };
  const known = new Set(opts.annotations ?? ["ann-1", "ann-2"]);
  const anchors = new Set((opts.messageLines ?? []).map((l) => l.anchor));
  const write = buildObservationTools(adapter, {
    relations,
    ...(opts.messageLines ? { messageLines: opts.messageLines } : {}),
    ...(opts.requireAnchor ? { requireAnchor: true } : {}),
    verify: {
      annotation: (id) => known.has(id),
      message: (anchor) => anchors.has(anchor),
    },
    onWrite: (action, relation) => writes.push([action, relation]),
    onReject: (reason) => rejects.push(reason),
  }).find((t) => t.name === "observation_update")!;
  return { store, write, edges, writes, rejects };
}

const CREATE = {
  action: "create",
  type: "stuck-point",
  summary: "Stuck on the key/query split",
  body: "Asked again on 2026-07-17.",
  annotationIds: ["ann-1"],
};

// --- the row numbers ---

test("a statement row number is written down as the id it was printed for", async () => {
  const { store, write, edges } = mount({ statements: ["s-aaaa", "s-bbbb", "s-cccc"] });
  await write.execute({ ...CREATE, relation: "predicted-by", statement: 2 });
  const [entry] = await store.list();
  expect(edges).toEqual([
    { kind: "evidence", statementId: "s-bbbb", observationIds: [entry.id] },
  ]);
});

test("contradicts records the new observation against that statement", async () => {
  const { store, write, edges, writes } = mount({ statements: ["s-aaaa", "s-bbbb"] });
  await write.execute({ ...CREATE, relation: "contradicts", statement: 1 });
  const [entry] = await store.list();
  expect(edges).toEqual([
    { kind: "contradiction", statementId: "s-aaaa", observationIds: [entry.id] },
  ]);
  expect(writes).toEqual([["create", "contradicts"]]);
});

test("relation new creates the observation and touches no statement", async () => {
  const { store, write, edges, writes } = mount({ statements: ["s-aaaa"] });
  await write.execute({ ...CREATE, relation: "new" });
  expect(await store.list()).toHaveLength(1);
  expect(edges).toEqual([]);
  expect(writes).toEqual([["create", "new"]]);
});

test("a create with no relation is refused", async () => {
  const { store, write } = mount({ statements: ["s-aaaa"] });
  await expect(write.execute({ ...CREATE })).rejects.toThrow("relation must be one of");
  expect(await store.list()).toHaveLength(0);
});

// With nothing on record to be predicted by, the two statement relations have
// no possible target and the prompt printed no statement rows at all.
test("without statements only new is offered, and only new is accepted", async () => {
  const { write } = mount({ statements: [] });
  const schema = write.parameters as { properties: Record<string, { description?: string }> };
  expect(schema.properties.statement).toBeUndefined();
  expect(schema.properties.relation.description).toContain('"new"');
  expect(schema.properties.relation.description).not.toContain("predicted-by");
  await expect(
    write.execute({ ...CREATE, relation: "predicted-by", statement: 1 }),
  ).rejects.toThrow("no statements to relate to");
});

test("the schema bounds both row numbers to the rows that were printed", () => {
  const { write } = mount({ statements: ["s-a", "s-b"], observations: ["m-0000000000000001"] });
  const schema = write.parameters as { properties: Record<string, unknown> };
  expect(schema.properties.statement).toMatchObject({ type: "integer", minimum: 1, maximum: 2 });
  expect(schema.properties.observation).toMatchObject({ type: "integer", minimum: 1, maximum: 1 });
});

// --- same-as: the text does not move ---

test("same-as appends evidence and leaves the body where it was", async () => {
  const { store, write } = mount({ messageLines: lines("t:10", "t:20") });
  await write.execute({ ...CREATE, relation: "new", messageIndices: [1] });
  const [entry] = await store.list();
  // The next pass prints that observation as row 1 and finds the same thing
  // happening again.
  const { write: again, writes } = remount(store, entry.id, lines("t:10", "t:20"));
  await again.execute({ action: "same-as", observation: 1, messageIndices: [2] });
  const [after] = await store.list();
  expect(after.id).toBe(entry.id);
  expect(after.body).toBe(entry.body);
  expect(after.anchors.messageIds).toEqual(["t:10", "t:20"]);
  expect(await store.list()).toHaveLength(1);
  expect(writes).toEqual([["same-as", "same-as"]]);
});

test("same-as refuses to carry a new body", async () => {
  const { store, write } = mount({ messageLines: lines("t:10") });
  await write.execute({ ...CREATE, relation: "new", messageIndices: [1] });
  const [entry] = await store.list();
  const { write: again } = remount(store, entry.id, lines("t:10"));
  await expect(
    again.execute({ action: "same-as", observation: 1, body: "rewritten", messageIndices: [1] }),
  ).rejects.toThrow("never");
  expect((await store.list())[0].body).toBe(entry.body);
});

test("same-as with no evidence is refused: it exists to add some", async () => {
  const { store, write } = mount({ messageLines: lines("t:10") });
  await write.execute({ ...CREATE, relation: "new", messageIndices: [1] });
  const [entry] = await store.list();
  const { write: again, rejects } = remount(store, entry.id, lines("t:10"));
  await expect(again.execute({ action: "same-as", observation: 1 })).rejects.toThrow(
    "second piece of evidence",
  );
  // Not a gate rejection: the call named nothing for the gate to resolve.
  expect(rejects).toEqual([]);
});

// A second mount over a store that already has an observation in it, with that
// observation printed as row 1 — the sweep coming back with new evidence for
// something it wrote last week.
function remount(store: ObservationFileStore, id: string, messageLines: TranscriptLine[]) {
  const adapter = new FileObservationAdapter(store);
  const writes: [string, WriteRelationOutcome | undefined][] = [];
  const rejects: WriteRejection[] = [];
  const anchors = new Set(messageLines.map((l) => l.anchor));
  const write = buildObservationTools(adapter, {
    messageLines,
    relations: {
      observations: [id],
      statements: [],
      async addEvidence() {},
      async addContradiction() {},
    },
    verify: {
      annotation: (a) => a === "ann-1" || a === "ann-2",
      message: (a) => anchors.has(a),
    },
    onWrite: (action, relation) => writes.push([action, relation]),
    onReject: (reason) => rejects.push(reason),
  }).find((t) => t.name === "observation_update")!;
  return { write, writes, rejects };
}

// --- the gate ---

test("gate: a row number nobody was shown is refused as bad-index", async () => {
  const { store, write, rejects } = mount({ statements: ["s-aaaa"] });
  await expect(
    write.execute({ ...CREATE, relation: "predicted-by", statement: 4 }),
  ).rejects.toThrow("not a row you were shown");
  expect(rejects).toEqual(["bad-index"]);
  expect(await store.list()).toHaveLength(0);
});

test("gate: an annotation id that resolves to nothing is refused as unresolved-anchor", async () => {
  const { store, write, rejects } = mount({ statements: [], annotations: ["ann-1"] });
  await expect(
    write.execute({ ...CREATE, relation: "new", annotationIds: ["ann-1", "ann-9"] }),
  ).rejects.toThrow("ann-9");
  expect(rejects).toEqual(["unresolved-anchor"]);
  expect(await store.list()).toHaveLength(0);
});

test("gate: an id in the body naming no observation is refused as unresolved-mention", async () => {
  const { store, write, rejects } = mount({ statements: [] });
  await expect(
    write.execute({
      ...CREATE,
      relation: "new",
      body: "Resolves the stuck point in m-1234567812345678.",
    }),
  ).rejects.toThrow("m-1234567812345678");
  expect(rejects).toEqual(["unresolved-mention"]);
  expect(await store.list()).toHaveLength(0);
});

test("an id in the body that does name an observation goes through", async () => {
  const { store, write } = mount({ statements: [] });
  await write.execute({ ...CREATE, relation: "new" });
  const [first] = await store.list();
  const { write: again } = remount(store, first.id, lines("t:10"));
  await again.execute({
    action: "create",
    type: "understood-concept",
    summary: "Worked out the key/query split",
    body: `Answers ${first.id} on 2026-07-17.`,
    relation: "new",
    annotationIds: ["ann-2"],
  });
  expect(await store.list()).toHaveLength(2);
});

// --- what the relation mount takes away ---

test("update is not a path any more where relations are mounted", async () => {
  const { store, write } = mount({ statements: [] });
  await write.execute({ ...CREATE, relation: "new" });
  const [entry] = await store.list();
  await expect(
    write.execute({ action: "update", id: entry.id, body: "rewritten" }),
  ).rejects.toThrow('"create" | "same-as" | "delete"');
  expect((await store.list())[0].body).toBe(entry.body);
  const schema = write.parameters as { properties: Record<string, { description?: string }> };
  expect(schema.properties.action.description).toBe('One of "create" | "same-as" | "delete".');
});

test("delete still works, and by id", async () => {
  const { store, write, writes } = mount({ statements: [] });
  await write.execute({ ...CREATE, relation: "new" });
  const [entry] = await store.list();
  await write.execute({ action: "delete", id: entry.id });
  expect(await store.list()).toHaveLength(0);
  expect(writes[1]).toEqual(["delete", undefined]);
});

// --- the gate on its own ---

test("unresolvedIds reports each kind apart, in the order it was given", async () => {
  const bad = await unresolvedIds(
    {
      annotationIds: ["ann-1", "ann-9"],
      messageIds: ["t:10", "t:99"],
      mentions: ["m-0000000000000001", "m-0000000000000002"],
    },
    new Set(["m-0000000000000001"]),
    {
      annotation: (id) => id === "ann-1",
      message: (a) => a === "t:10",
    },
  );
  expect(bad).toEqual({ anchors: ["ann-9", "t:99"], mentions: ["m-0000000000000002"] });
});

// A mount with no verifier is a live conversation: it has no listing to check
// an anchor against, and checking against nothing would refuse everything.
test("unresolvedIds without a verifier still gates the mentions", async () => {
  const bad = await unresolvedIds(
    { annotationIds: ["ann-9"], messageIds: ["t:99"], mentions: ["m-0000000000000002"] },
    new Set(),
  );
  expect(bad).toEqual({ anchors: [], mentions: ["m-0000000000000002"] });
});
