// Deleting an observation so that the deletion survives sync
// (src/memory/observations/store.ts, TOMBSTONE_FILE). Run: bun test.
//
// The bug these close, measured on the owner's store 2026-08-31: 106 entry files
// on disk against a 103-line index, and the three ids the index was missing —
// m-fb109f9c, m-0fe3bfb7, m-883ca3e9 — were all deliberately deleted and all
// three back from the other device, because sync propagates no file deletion.

import { expect, test } from "bun:test";
import {
  serializeObservation,
  serializeTombstone,
} from "../../src/memory/observations/files";
import { ObservationFileStore } from "../../src/memory/observations/store";
import { mergeFile } from "../../src/platform/sync/merge";
import { strategyFor } from "../../src/platform/sync/merge/contract";
import { JULY_17, JULY_20, makeFakeFs } from "./fakefs";

const TOMBSTONES = "memory-topic-1/deleted-observations.jsonl";

function makeStore(now: () => number = () => JULY_17) {
  const { fs, files } = makeFakeFs();
  return { store: new ObservationFileStore("topic-1", fs, now), files };
}

test("delete writes a tombstone naming the id and the day", async () => {
  const { store, files } = makeStore();
  const entry = await store.create({ type: "belief", summary: "drop", body: "d" });

  expect(await store.delete(entry.id)).toBe(true);
  expect(files.get(TOMBSTONES)).toBe(`{"id":"${entry.id}","at":"2026-07-17"}\n`);
});

// The whole point: the other device never heard about the deletion, so the next
// pull puts the entry file back. It must not come back with it.
test("an entry whose file reappears stays out of list and out of the index", async () => {
  const { store, files } = makeStore();
  const keep = await store.create({ type: "belief", summary: "keep", body: "k" });
  const gone = await store.create({ type: "belief", summary: "drop", body: "d" });
  await store.delete(gone.id);

  files.set(
    `memory-topic-1/${gone.id}.md`,
    serializeObservation({
      id: gone.id,
      type: "belief",
      summary: "drop",
      body: "d",
      created: "2026-07-17",
      updated: "2026-07-17",
      anchors: { annotationIds: [], messageIds: [] },
    }),
  );

  expect((await store.list()).map((e) => e.id)).toEqual([keep.id]);
  await store.rebuildIndex();
  expect((await store.readIndex()).map((e) => e.id)).toEqual([keep.id]);
  // Nothing is destroyed on the way: the file the other device pushed is still
  // there to be read by hand, it is only not an observation any more.
  expect(files.has(`memory-topic-1/${gone.id}.md`)).toBe(true);
});

test("get answers null for a tombstoned id whose file is still on disk", async () => {
  const { store, files } = makeStore();
  const gone = await store.create({ type: "belief", summary: "drop", body: "d" });
  const text = files.get(`memory-topic-1/${gone.id}.md`) as string;
  await store.delete(gone.id);
  files.set(`memory-topic-1/${gone.id}.md`, text);

  expect(await store.get(gone.id)).toBeNull();
});

// Deliberately the opposite of the records merge's "an edit outranks a delete",
// and for a reason that rule does not have to weigh: most edits here are the
// distiller's, made by a background sweep that rewrites entries on a schedule.
// If an edit resurrected a deleted observation, a sweep would silently undo
// every deletion the reader ever made.
test("an edit arriving after the delete does not bring the observation back", async () => {
  const { store, files } = makeStore();
  const gone = await store.create({ type: "belief", summary: "drop", body: "d" });
  await store.delete(gone.id);

  files.set(
    `memory-topic-1/${gone.id}.md`,
    serializeObservation({
      id: gone.id,
      type: "belief",
      summary: "the other device rewrote this",
      body: "edited elsewhere",
      created: "2026-07-17",
      updated: "2026-07-20",
      anchors: { annotationIds: [], messageIds: [] },
    }),
  );

  expect(await store.update(gone.id, { body: "again" })).toBeNull();
  expect(await store.list()).toEqual([]);
});

test("deleting an already tombstoned id succeeds and writes no second line", async () => {
  const { store, files } = makeStore();
  const gone = await store.create({ type: "belief", summary: "drop", body: "d" });
  await store.delete(gone.id);
  const after = files.get(TOMBSTONES);

  expect(await store.delete(gone.id)).toBe(true);
  expect(files.get(TOMBSTONES)).toBe(after);
  expect(await store.delete("m-00000000")).toBe(false);
});

// The migration. A store written before this file existed has entries on disk
// and absent from the index for two indistinguishable reasons — deleted here on
// purpose, or created on the other device and synced in before this one last
// rebuilt — and the owner's three arrived by the second route. So nothing is
// inferred and nothing is removed.
test("a topic with no tombstone file gets an empty one and loses nothing", async () => {
  const { store, files } = makeStore();
  files.set(
    "memory-topic-1/m-11111111.md",
    serializeObservation({
      id: "m-11111111",
      type: "belief",
      summary: "on disk but not in the index",
      body: "b",
      created: "2026-07-17",
      updated: "2026-07-17",
      anchors: { annotationIds: [], messageIds: [] },
    }),
  );
  files.set("memory-topic-1/index.md", "");
  expect(files.has(TOMBSTONES)).toBe(false);

  await store.rebuildIndex();

  expect(files.get(TOMBSTONES)).toBe("");
  expect((await store.readIndex()).map((e) => e.id)).toEqual(["m-11111111"]);
  expect(files.has("memory-topic-1/m-11111111.md")).toBe(true);
});

// --- the file as sync sees it ------------------------------------------------

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const tombstone = serializeTombstone;

// Opaque would park one device's whole tombstone list in a conflict copy nobody
// opens, and every deletion in it would be undone.
test("the tombstone file is merged as records wherever it sits", () => {
  expect(strategyFor("memory-b3a9f89c/deleted-observations.jsonl")).toBe("records");
  expect(strategyFor("deleted-observations.jsonl")).toBe("records");
});

test("two devices that each deleted a different observation keep both tombstones", () => {
  const base = bytes(`${tombstone("m-11111111", "2026-07-17")}\n`);
  const local = bytes(`${tombstone("m-11111111", "2026-07-17")}\n${tombstone("m-22222222", "2026-07-18")}\n`);
  const remote = bytes(`${tombstone("m-11111111", "2026-07-17")}\n${tombstone("m-33333333", "2026-07-19")}\n`);

  const out = mergeFile({ path: "memory-t1/deleted-observations.jsonl", base, local, remote });
  const lines = decode(out.merged).trim().split("\n");
  expect(lines).toHaveLength(3);
  expect(lines.sort()).toEqual(
    [
      tombstone("m-11111111", "2026-07-17"),
      tombstone("m-22222222", "2026-07-18"),
      tombstone("m-33333333", "2026-07-19"),
    ].sort(),
  );
  expect(out.copies).toEqual([]);
  expect(out.dropped).toEqual([]);
});

// A device that has never pulled this file has no base, and with no base the
// merge cannot tell a deletion it never had from one it removed — so it unions.
test("a device seeing the file for the first time keeps the other device's tombstones", () => {
  const local = bytes(`${tombstone("m-22222222", "2026-07-18")}\n`);
  const remote = bytes(`${tombstone("m-33333333", "2026-07-19")}\n`);

  const out = mergeFile({
    path: "memory-t1/deleted-observations.jsonl",
    base: null,
    local,
    remote,
  });
  expect(decode(out.merged).trim().split("\n").sort()).toEqual(
    [tombstone("m-22222222", "2026-07-18"), tombstone("m-33333333", "2026-07-19")].sort(),
  );
});

// Both devices merge the same three inputs with themselves as `local`, and have
// to land on the same bytes or the file uploads back and forth forever.
test("both devices merge the same pair to the same bytes", () => {
  const base = bytes(`${tombstone("m-11111111", "2026-07-17")}\n`);
  const a = bytes(`${tombstone("m-11111111", "2026-07-17")}\n${tombstone("m-22222222", "2026-07-18")}\n`);
  const b = bytes(`${tombstone("m-11111111", "2026-07-17")}\n${tombstone("m-33333333", "2026-07-19")}\n`);
  const path = "memory-t1/deleted-observations.jsonl";

  expect(decode(mergeFile({ path, base, local: a, remote: b }).merged)).toBe(
    decode(mergeFile({ path, base, local: b, remote: a }).merged),
  );
});

// Why the line is the record and not a map keyed by id: the same deletion made
// independently on both devices is the same bytes, so the union holds one line
// instead of handing two dated versions of one fact to the content tie-break.
test("the same deletion made on both devices is one line, not two", async () => {
  const one = makeStore(() => JULY_20);
  const two = makeStore(() => JULY_20);
  await one.store.create({ type: "belief", summary: "drop", body: "d" });
  await two.store.create({ type: "belief", summary: "drop", body: "d" });
  const [a] = await one.store.list();
  const [b] = await two.store.list();
  await one.store.delete(a.id);
  await two.store.delete(b.id);
  // Two stores, so two minted ids; the format is what is being compared.
  const anonymised = (files: Map<string, string>, id: string) =>
    (files.get(TOMBSTONES) as string).replace(id, "m-00000000");
  expect(anonymised(one.files, a.id)).toBe(anonymised(two.files, b.id));

  const line = bytes(`${tombstone("m-00000000", "2026-07-20")}\n`);
  const out = mergeFile({
    path: "memory-t1/deleted-observations.jsonl",
    base: null,
    local: line,
    remote: line,
  });
  expect(decode(out.merged).trim().split("\n")).toHaveLength(1);
});
