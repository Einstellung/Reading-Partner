// Unit tests for the file-backed Memory Adapter (src/memory/adapter.ts) —
// BM25 recall over memory bodies, correct-with-null deletion. Run: bun test.

import { expect, test } from "bun:test";
import { FileMemoryAdapter } from "../../src/memory/adapter";
import { MemoryFileStore } from "../../src/memory/store";
import { JULY_17, makeFakeFs } from "./fakefs";

function makeAdapter() {
  const { fs } = makeFakeFs();
  const store = new MemoryFileStore("t", fs, () => JULY_17);
  return { adapter: new FileMemoryAdapter(store), store };
}

test("recall ranks the relevant memory first and carries the entry", async () => {
  const { adapter } = makeAdapter();
  const hit = await adapter.retain({
    type: "stuck-point",
    summary: "Confused by BM25 length normalization",
    body: "The b parameter and average document length interaction was unclear.",
  });
  await adapter.retain({
    type: "reading-position",
    summary: "Reached chapter 3 of the survey",
    body: "Reading position: page 41, chapter 3.",
  });

  const hits = await adapter.recall("BM25 length normalization");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].entry.id).toBe(hit.id);
  expect(hits[0].snippet).toContain("BM25");
});

test("recall with no match or empty store returns []", async () => {
  const { adapter } = makeAdapter();
  expect(await adapter.recall("anything")).toEqual([]);
  await adapter.retain({ type: "belief", summary: "s", body: "b" });
  expect(await adapter.recall("zzzqqq")).toEqual([]);
});

test("correct patches an entry; correct(id, null) deletes it", async () => {
  const { adapter } = makeAdapter();
  const e = await adapter.retain({ type: "belief", summary: "old take", body: "old" });

  const patched = await adapter.correct(e.id, { summary: "new take" });
  expect(patched?.summary).toBe("new take");

  expect(await adapter.correct(e.id, null)).toBeNull();
  expect(await adapter.listObservations()).toEqual([]);
});

test("rebuild restores a broken index from the files", async () => {
  const { fs, files } = makeFakeFs();
  const store = new MemoryFileStore("t", fs, () => JULY_17);
  const adapter = new FileMemoryAdapter(store);
  const e = await adapter.retain({ type: "correction", summary: "s", body: "b" });
  files.delete("memory-t/index.md");

  await adapter.rebuild();
  expect((await store.readIndex()).map((x) => x.id)).toEqual([e.id]);
});
