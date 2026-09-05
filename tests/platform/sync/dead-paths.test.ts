// Which synced paths a deleted book owns (src/platform/sync/dead-paths.ts). The
// list is what a pass deletes on every device, so what it does not claim matters
// as much as what it does. Run: bun test.

import { expect, test } from "bun:test";
import { deadPathsFor, isDeadPath } from "../../../src/platform/sync/dead-paths";

const dead = new Set(["h1"]);

test("a book's marks, threads and prep are its own", () => {
  expect(isDeadPath("annotations-h1.json", dead)).toBe(true);
  expect(isDeadPath("threads-h1.json", dead)).toBe(true);
  expect(isDeadPath("prep-h1/state.json", dead)).toBe(true);
  expect(isDeadPath("prep-h1/attention-is-all-you-need.md", dead)).toBe(true);
  expect(isDeadPath("prep-h1/chapters/state.json", dead)).toBe(true);
  expect(isDeadPath("prep-h1/chapters/chapter-03.md", dead)).toBe(true);
});

test("another book's files are untouched", () => {
  expect(isDeadPath("annotations-h2.json", dead)).toBe(false);
  expect(isDeadPath("threads-h2.json", dead)).toBe(false);
  expect(isDeadPath("prep-h2/state.json", dead)).toBe(false);
});

// Everything below is deleted by somebody else, and a tombstone that took them
// too would delete more than the reader asked for.
test("what a book does not own", () => {
  // Record-level deletes already travel (merge/records.ts).
  expect(isDeadPath("library.json", dead)).toBe(false);
  expect(isDeadPath("reading-state.json", dead)).toBe(false);
  expect(isDeadPath("topics.json", dead)).toBe(false);
  // Observations are stored by topic and tombstoned one record at a time.
  expect(isDeadPath("memory-h1/index.md", dead)).toBe(false);
  expect(isDeadPath("memory-h1/deleted-observations.jsonl", dead)).toBe(false);
  // These carry their own ids and their stores delete them.
  expect(isDeadPath("retell-h1.json", dead)).toBe(false);
  expect(isDeadPath("outline-h1.json", dead)).toBe(false);
  expect(isDeadPath("rehearsal-h1.json", dead)).toBe(false);
  expect(isDeadPath("runs-rehearsal-h1.json", dead)).toBe(false);
  expect(isDeadPath("runs/h1/r1.json", dead)).toBe(false);
  // The tombstone itself, above all.
  expect(isDeadPath("deleted-books.jsonl", dead)).toBe(false);
});

// A retell's conversation is threads-retell-<retellId>.json and a talk's is
// threads-talk-<outlineId>.json: the same shape as a book's threads file, and
// neither is claimed unless the tombstone names that exact id.
test("a retell's or a talk's threads are not a book's", () => {
  expect(isDeadPath("threads-retell-h1.json", dead)).toBe(false);
  expect(isDeadPath("threads-talk-h1.json", dead)).toBe(false);
});

test("no deleted books means no dead paths", () => {
  expect(isDeadPath("annotations-h1.json", new Set())).toBe(false);
});

test("several deleted books are all claimed", () => {
  const many = new Set(["h1", "h2"]);
  expect(isDeadPath("annotations-h1.json", many)).toBe(true);
  expect(isDeadPath("prep-h2/state.json", many)).toBe(true);
  expect(isDeadPath("annotations-h3.json", many)).toBe(false);
});

// What the domain half deletes locally is named here rather than spelled out
// again where deleteBook lives.
test("the paths one book owns are named in one place", () => {
  const { files, dirs } = deadPathsFor("h1");
  expect(files).toEqual(["annotations-h1.json", "threads-h1.json"]);
  expect(dirs).toEqual(["prep-h1/"]);
  for (const f of files) expect(isDeadPath(f, dead)).toBe(true);
  for (const d of dirs) expect(isDeadPath(`${d}state.json`, dead)).toBe(true);
});
