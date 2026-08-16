// Unit tests for the observation file store (src/observation/record/store.ts), over the fake
// fs — write/index/update/evolution rewrite/delete/rebuild. Run: bun test.

import { expect, test } from "bun:test";
import { conflictCopyPath } from "../../src/platform/sync/merge";
import { serializeObservation } from "../../src/observation/record/files";
import { ObservationFileStore } from "../../src/observation/record/store";
import { JULY_17, JULY_20, makeFakeFs } from "./fakefs";

function makeStore(now: () => number = () => JULY_17) {
  const { fs, files } = makeFakeFs();
  return { store: new ObservationFileStore("topic-1", fs, now), files };
}

test("create writes one file per observation and an index line", async () => {
  const { store, files } = makeStore();
  const entry = await store.create({
    type: "stuck-point",
    summary: "Stuck on BM25 saturation",
    body: "Term frequency saturation via k1 didn't click.",
    anchors: { annotationIds: ["ann-9"] },
  });

  expect(entry.id).toMatch(/^m-[0-9a-f]{8}$/);
  expect(entry.created).toBe("2026-07-17");
  expect(files.has(`memory-topic-1/${entry.id}.md`)).toBe(true);

  const index = await store.readIndex();
  expect(index).toEqual([
    { id: entry.id, type: "stuck-point", summary: "Stuck on BM25 saturation", updated: "2026-07-17" },
  ]);
});

test("update rewrites in place: created kept, updated bumped, one file, one index line", async () => {
  let now = JULY_17;
  const { store, files } = makeStore(() => now);
  const entry = await store.create({
    type: "stuck-point",
    summary: "Stuck on BM25 saturation",
    body: "Didn't click.",
  });

  // The evolution rewrite: same observation, summary/body carry the resolution.
  now = JULY_20;
  const updated = await store.update(entry.id, {
    type: "understood-concept",
    summary: "Was stuck on BM25 saturation, resolved on 2026-07-20",
    body: "Was stuck on term-frequency saturation (2026-07-17); resolved on 2026-07-20 after working through k1.",
  });

  expect(updated?.created).toBe("2026-07-17");
  expect(updated?.updated).toBe("2026-07-20");
  expect(updated?.type).toBe("understood-concept");
  // Still one observation file (plus the index), not a new entry.
  expect([...files.keys()].filter((k) => /m-[0-9a-f]{8}\.md$/.test(k))).toHaveLength(1);
  const index = await store.readIndex();
  expect(index).toHaveLength(1);
  expect(index[0].summary).toContain("resolved on 2026-07-20");
});

test("update keeps unpatched fields and anchors", async () => {
  const { store } = makeStore();
  const entry = await store.create({
    type: "belief",
    summary: "s",
    body: "b",
    anchors: { annotationIds: ["a1"], messageIds: ["t:1"] },
  });
  const updated = await store.update(entry.id, { body: "b2" });
  expect(updated?.summary).toBe("s");
  expect(updated?.anchors).toEqual({ annotationIds: ["a1"], messageIds: ["t:1"] });
});

test("update/delete of an unknown id is a null/false no-op", async () => {
  const { store } = makeStore();
  expect(await store.update("m-00000000", { body: "x" })).toBeNull();
  expect(await store.delete("m-00000000")).toBe(false);
});

test("delete removes the file and its index line", async () => {
  const { store, files } = makeStore();
  const a = await store.create({ type: "belief", summary: "keep", body: "k" });
  const b = await store.create({ type: "belief", summary: "drop", body: "d" });

  expect(await store.delete(b.id)).toBe(true);
  expect(files.has(`memory-topic-1/${b.id}.md`)).toBe(false);
  expect((await store.readIndex()).map((e) => e.id)).toEqual([a.id]);
});

test("rebuildIndex regenerates the index from the entry files", async () => {
  const { store, files } = makeStore();
  const a = await store.create({ type: "reading-position", summary: "p42", body: "At page 42." });
  files.set("memory-topic-1/index.md", "corrupted\n");

  await store.rebuildIndex();
  expect((await store.readIndex()).map((e) => e.id)).toEqual([a.id]);
});

test("list skips non-entry and malformed files", async () => {
  const { store, files } = makeStore();
  const a = await store.create({ type: "belief", summary: "s", body: "b" });
  files.set("memory-topic-1/m-deadbeef.md", "not an observation");
  files.set("memory-topic-1/notes.md", "unrelated");

  expect((await store.list()).map((e) => e.id)).toEqual([a.id]);
});

test("meta round-trips and defaults to no distillation", async () => {
  const { store } = makeStore();
  expect(await store.getMeta()).toEqual({ lastDistilledAt: null, lastAnnotationDistillAt: null });
  await store.setMeta({ lastDistilledAt: 123, lastAnnotationDistillAt: 45 });
  expect(await store.getMeta()).toEqual({ lastDistilledAt: 123, lastAnnotationDistillAt: 45 });
});

// --- conflict copies sync leaves behind ---

test("conflict copies are readable, and still not observations", async () => {
  const { store, files } = makeStore();
  const entry = await store.create({
    type: "belief",
    summary: "Thinks attention is just soft lookup",
    body: "Said so twice.",
  });

  // The copy is written the way sync writes one: the losing side's whole file,
  // named from its own bytes (platform/sync/merge). Using that function here is
  // the point of the test — the store's pattern has to match what sync produces.
  const losing = serializeObservation({
    ...entry,
    summary: "Thinks attention is a soft lookup, and says the iPad version",
    body: "The version this device had.",
  });
  const bytes = new TextEncoder().encode(losing);
  const path = conflictCopyPath(`memory-topic-1/${entry.id}.md`, bytes);
  files.set(path, losing);

  const conflicts = await store.listConflicts();
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].path).toBe(path);
  expect(conflicts[0].id).toBe(entry.id);
  expect(conflicts[0].summary).toBe("Thinks attention is a soft lookup, and says the iPad version");
  expect(conflicts[0].body).toBe("The version this device had.");

  // And it stays out of everything derived: one observation, one index line.
  expect(await store.list()).toHaveLength(1);
  expect(await store.readIndex()).toHaveLength(1);
  await store.rebuildIndex();
  expect((await store.readIndexText()).split("\n").filter(Boolean)).toHaveLength(1);
  expect(files.has(path)).toBe(true);
});

test("a conflict copy that will not parse is still reported", async () => {
  const { store, files } = makeStore();
  files.set("memory-topic-1/m-1a2b3c4d.conflict-deadbeef.md", "not frontmatter at all");
  // A copy of the derived index is not a copy of anything the reader wrote.
  files.set("memory-topic-1/index.conflict-cafebabe.md", "- [belief] x (updated 2026-07-17, id m-1a2b3c4d)");

  const conflicts = await store.listConflicts();
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].id).toBe("m-1a2b3c4d");
  expect(conflicts[0].summary).toBe("");
});

test("rebuilding the index deletes the conflict copies of the index, and only those", async () => {
  const { store, files } = makeStore();
  const entry = await store.create({ type: "belief", summary: "s", body: "b" });
  const entryCopy = `memory-topic-1/${entry.id}.conflict-deadbeef.md`;
  files.set(entryCopy, serializeObservation({ ...entry, body: "the other device's version" }));
  files.set("memory-topic-1/index.conflict-cafebabe.md", "- [belief] s (updated 2026-07-17, id m-1)");
  files.set("memory-topic-1/index.conflict-0badf00d.md", "");
  // A different topic's directory is not this store's to touch.
  files.set("memory-topic-2/index.conflict-cafebabe.md", "");

  await store.rebuildIndex();

  expect(files.has("memory-topic-1/index.conflict-cafebabe.md")).toBe(false);
  expect(files.has("memory-topic-1/index.conflict-0badf00d.md")).toBe(false);
  expect(files.has("memory-topic-2/index.conflict-cafebabe.md")).toBe(true);
  expect(files.has(entryCopy)).toBe(true);
  expect(await store.listConflicts()).toHaveLength(1);
  expect(await store.readIndex()).toHaveLength(1);
});

test("a topic with no conflict copies reports none", async () => {
  const { store } = makeStore();
  await store.create({ type: "belief", summary: "s", body: "b" });
  expect(await store.listConflicts()).toEqual([]);
});
