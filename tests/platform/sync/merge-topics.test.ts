// topics.json both devices edited (src/platform/sync/merge/topics.ts, docs/59
// §11). A topic's own keys merge as fields and its book list one book at a
// time, keyed by the book id, so the desktop writing an open time and the phone
// taking a book off the same topic both stand. The contract's properties
// (symmetry, idempotence, second device converging) run over these files in
// merge.test.ts's CASES; this is the behaviour.

import { expect, test } from "bun:test";
import { mergeFile } from "../../../src/platform/sync/merge";
import type { MergeOutput } from "../../../src/platform/sync/merge/contract";

interface Row {
  path: string;
  name: string;
  addedAt: number;
  lastOpenedAt?: number;
  hash?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const row = (hash: string, extra: Partial<Row> = {}): Row => ({
  path: `/books/${hash}.epub`,
  name: `${hash}.epub`,
  addedAt: 1,
  hash,
  ...extra,
});

function file(files: Row[], name = "One", more: Record<string, unknown>[] = []): Uint8Array {
  return enc.encode(JSON.stringify({ topics: [{ id: "t1", name, createdAt: 1, files }, ...more] }, null, 2));
}

function merge(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array): MergeOutput {
  return mergeFile({ path: "topics.json", base, local, remote });
}

function topicOf(out: MergeOutput): { name: string; files: Row[] } {
  return (JSON.parse(dec.decode(out.merged)) as { topics: { name: string; files: Row[] }[] }).topics[0]!;
}

function hashes(out: MergeOutput): (string | undefined)[] {
  return topicOf(out).files.map((f) => f.hash ?? f.path);
}

test("a book added on one device and another taken off on the other both stand", () => {
  const base = file([row("h1"), row("h2")]);
  const local = file([row("h1"), row("h2"), row("h3")]);
  const remote = file([row("h1")]);
  const out = merge(base, local, remote);
  expect(hashes(out)).toEqual(["h1", "h3"]);
  expect(out.dropped).toEqual([{ id: "t1/h2", record: row("h2") }]);
  expect(out.contested).toBe(false);
  expect(dec.decode(merge(base, remote, local).merged)).toBe(dec.decode(out.merged));
});

test("an open time on one device does not bring back a book the other took off the topic", () => {
  const base = file([row("h1"), row("h2")]);
  // The desktop opened both books, the one the phone removed among them.
  const local = file([row("h1", { lastOpenedAt: 50 }), row("h2", { lastOpenedAt: 60 })]);
  const remote = file([row("h1")]);
  const out = merge(base, local, remote);
  expect(topicOf(out).files).toEqual([row("h1", { lastOpenedAt: 50 })]);
  // The open time that went with it is journalled as it stood.
  expect(out.dropped).toEqual([{ id: "t1/h2", record: row("h2", { lastOpenedAt: 60 }) }]);
});

test("the topic's own keys merge beside the book list", () => {
  const base = file([row("h1")]);
  const local = file([row("h1")], "Renamed");
  const remote = file([row("h1"), row("h2")]);
  const out = merge(base, local, remote);
  expect(topicOf(out).name).toBe("Renamed");
  expect(hashes(out)).toEqual(["h1", "h2"]);
});

test("one book both devices opened keeps one open time and journals the other", () => {
  const base = file([row("h1")]);
  const local = file([row("h1", { lastOpenedAt: 50 })]);
  const remote = file([row("h1", { lastOpenedAt: 60 })]);
  const out = merge(base, local, remote);
  const kept = topicOf(out).files[0]!.lastOpenedAt;
  expect([50, 60]).toContain(kept!);
  expect(out.dropped).toEqual([{ id: "t1/h1.lastOpenedAt", record: kept === 50 ? 60 : 50 }]);
  expect(out.contested).toBe(true);
});

test("with no base nothing is taken off: the deletion log has to hold that line", () => {
  // A first merge after sign-in, a Drive duplicate merged in, an upload another
  // device overwrote: none of them can tell a removal from an addition.
  const out = merge(null, file([row("h1")], "One", []), file([row("h1"), row("h2")], "Uno"));
  expect(hashes(out)).toEqual(["h1", "h2"]);
});

test("a book listed twice on one side is one book, and the extra row is journalled", () => {
  const twice = row("h1", { path: "content://doc/2905a", name: "document:2905a" });
  const base = file([row("h1")]);
  const local = file([row("h1"), twice]);
  const remote = file([row("h1", { lastOpenedAt: 9 })]);
  const out = merge(base, local, remote);
  expect(topicOf(out).files).toEqual([row("h1", { lastOpenedAt: 9 })]);
  expect(out.dropped).toEqual([{ id: "t1/h1", record: twice }]);
});

test("a row that gained its book id on one side and an open time on the other stays one row", () => {
  // Written before 2026-09-21, so keyed by path until the id is backfilled.
  const old = { path: "/books/a.pdf", name: "a.pdf", addedAt: 1 };
  const base = file([old]);
  const local = file([{ ...old, hash: "h1" }]);
  const remote = file([{ ...old, lastOpenedAt: 7 }]);
  const out = merge(base, local, remote);
  expect(topicOf(out).files).toEqual([{ ...old, hash: "h1" }]);
  expect(out.dropped).toEqual([{ id: "t1/path:/books/a.pdf", record: { ...old, lastOpenedAt: 7 } }]);
});

test("a topic whose book list is not a list is settled whole, as records did", () => {
  const base = file([row("h1")]);
  const local = file([row("h1")], "Renamed");
  const remote = enc.encode(JSON.stringify({ topics: [{ id: "t1", name: "One", createdAt: 1, files: "?" }] }));
  const out = merge(base, local, remote);
  expect(out.contested).toBe(true);
  expect(out.dropped.map((d) => d.id)).toEqual(["t1"]);
});

test("a topic only one side touched is taken whole, its bytes untouched", () => {
  const base = file([row("h1")], "One", [{ id: "t2", name: "Two", createdAt: 2, files: [] }]);
  const local = file([row("h1", { lastOpenedAt: 5 })], "One", [{ id: "t2", name: "Two", createdAt: 2, files: [] }]);
  const remote = file([row("h1")], "One", [{ id: "t2", name: "Deux", createdAt: 2, files: [] }]);
  const out = merge(base, local, remote);
  const topics = (JSON.parse(dec.decode(out.merged)) as { topics: { name: string; files: Row[] }[] }).topics;
  expect(topics[0]!.files).toEqual([row("h1", { lastOpenedAt: 5 })]);
  expect(topics[1]!.name).toBe("Deux");
  expect(out.contested).toBe(false);
});
