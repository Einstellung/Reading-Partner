// Which synced paths a deleted thing owns (src/platform/sync/dead-paths.ts). The
// list is what a pass deletes on every device, so what it does not claim matters
// as much as what it does. Run: bun test.

import { expect, test } from "bun:test";
import { deadPathsFor, isDeadPath, ownedPaths } from "../../../src/platform/sync/dead-paths";
import {
  emptyDeletions,
  type Deletions,
  type TombstoneKind,
} from "../../../src/platform/app/deleted-books";

function dead(over: Partial<Record<TombstoneKind, string[]>>): Deletions {
  const d = emptyDeletions();
  for (const [kind, ids] of Object.entries(over)) {
    for (const id of ids ?? []) d[kind as TombstoneKind].add(id);
  }
  return d;
}

const book = dead({ book: ["h1"] });

test("a book's marks, threads and prep are its own", () => {
  expect(isDeadPath("annotations-h1.json", book)).toBe(true);
  expect(isDeadPath("threads-h1.json", book)).toBe(true);
  expect(isDeadPath("supplements-h1.json", book)).toBe(true);
  expect(isDeadPath("pagination-h1.json", book)).toBe(true);
  expect(isDeadPath("prep-h1/state.json", book)).toBe(true);
  expect(isDeadPath("prep-h1/attention-is-all-you-need.md", book)).toBe(true);
  expect(isDeadPath("prep-h1/chapters/state.json", book)).toBe(true);
  expect(isDeadPath("prep-h1/chapters/chapter-03.md", book)).toBe(true);
});

test("another book's files are untouched", () => {
  expect(isDeadPath("annotations-h2.json", book)).toBe(false);
  expect(isDeadPath("threads-h2.json", book)).toBe(false);
  expect(isDeadPath("prep-h2/state.json", book)).toBe(false);
});

// Everything below is deleted by somebody else, and a book's line that took
// them too would delete more than the reader asked for.
test("what a book does not own", () => {
  // Record-level deletes already travel (merge/records.ts).
  expect(isDeadPath("library.json", book)).toBe(false);
  expect(isDeadPath("reading-state.json", book)).toBe(false);
  expect(isDeadPath("topics.json", book)).toBe(false);
  // Observations are stored by topic and tombstoned one record at a time.
  expect(isDeadPath("memory-h1/index.md", book)).toBe(false);
  expect(isDeadPath("memory-h1/deleted-observations.jsonl", book)).toBe(false);
  // These carry their own ids and are logged under them.
  expect(isDeadPath("retell-h1.json", book)).toBe(false);
  expect(isDeadPath("outline-h1.json", book)).toBe(false);
  expect(isDeadPath("rehearsal-h1.json", book)).toBe(false);
  expect(isDeadPath("runs-rehearsal-h1.json", book)).toBe(false);
  expect(isDeadPath("runs/h1/r1.json", book)).toBe(false);
  expect(isDeadPath("threads-retell-h1.json", book)).toBe(false);
  expect(isDeadPath("threads-talk-h1.json", book)).toBe(false);
  // The log itself, above all.
  expect(isDeadPath("deleted-books.jsonl", book)).toBe(false);
});

test("a retell owns its record and its conversation, and nothing of the talk's", () => {
  const d = dead({ retell: ["r1"] });
  expect(isDeadPath("retell-r1.json", d)).toBe(true);
  expect(isDeadPath("threads-retell-r1.json", d)).toBe(true);
  expect(isDeadPath("retell-r2.json", d)).toBe(false);
  expect(isDeadPath("outline-r1.json", d)).toBe(false);
  expect(isDeadPath("threads-talk-r1.json", d)).toBe(false);
  expect(isDeadPath("annotations-r1.json", d)).toBe(false);
  expect(deadPathsFor("retell", "r1")).toEqual({
    files: ["threads-retell-r1.json", "retell-r1.json"],
    dirs: [],
  });
});

test("an outline owns its record and the talk's conversation", () => {
  const d = dead({ outline: ["o1"] });
  expect(isDeadPath("outline-o1.json", d)).toBe(true);
  expect(isDeadPath("threads-talk-o1.json", d)).toBe(true);
  expect(isDeadPath("rehearsal-o1.json", d)).toBe(false);
  expect(isDeadPath("retell-o1.json", d)).toBe(false);
});

test("a rehearsal owns its record, its index and every transcript under runs/", () => {
  const d = dead({ rehearsal: ["x1"] });
  expect(isDeadPath("rehearsal-x1.json", d)).toBe(true);
  expect(isDeadPath("runs-rehearsal-x1.json", d)).toBe(true);
  expect(isDeadPath("runs/x1/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json", d)).toBe(true);
  expect(isDeadPath("runs/x2/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json", d)).toBe(false);
  // Never in range, and never deleted by a pass.
  expect(isDeadPath("runs-rehearsal-x1.json.bad", d)).toBe(false);
  expect(deadPathsFor("rehearsal", "x1")).toEqual({
    files: ["rehearsal-x1.json", "runs-rehearsal-x1.json"],
    dirs: ["runs/x1/"],
  });
});

test("a topic owns no file", () => {
  const d = dead({ topic: ["t1"] });
  expect(isDeadPath("events-t1.jsonl", d)).toBe(false);
  expect(isDeadPath("topics.json", d)).toBe(false);
  expect(deadPathsFor("topic", "t1")).toEqual({ files: [], dirs: [] });
});

test("nothing deleted means no dead paths", () => {
  expect(isDeadPath("annotations-h1.json", emptyDeletions())).toBe(false);
});

test("several deleted things are all claimed", () => {
  const many = dead({ book: ["h1", "h2"], retell: ["r1"] });
  expect(isDeadPath("annotations-h1.json", many)).toBe(true);
  expect(isDeadPath("prep-h2/state.json", many)).toBe(true);
  expect(isDeadPath("retell-r1.json", many)).toBe(true);
  expect(isDeadPath("annotations-h3.json", many)).toBe(false);
});

// What the domain half deletes locally is named here rather than spelled out
// again where deleteBook lives.
test("the paths one book owns are named in one place", () => {
  const { files, dirs } = deadPathsFor("book", "h1");
  expect(files).toEqual([
    "annotations-h1.json",
    "supplements-h1.json",
    "threads-h1.json",
    "pagination-h1.json",
  ]);
  expect(dirs).toEqual(["prep-h1/"]);
  for (const f of files) expect(isDeadPath(f, book)).toBe(true);
  for (const d of dirs) expect(isDeadPath(`${d}state.json`, book)).toBe(true);
});

test("the local half is the blob, the caches and the covers", () => {
  const { files, dirs } = ownedPaths("book", "h1", (r) => r.sync !== "data");
  expect(files).toEqual([
    "library/h1.pdf",
    "library/h1.epub",
    "fulltext-h1.json",
    "figures-h1.json",
    "covers/h1.failed.json",
    "covers/h1.jpg",
    "covers/h1.json",
  ]);
  expect(dirs).toEqual(["prep-h1/"]);
});
