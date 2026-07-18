// The sync-range predicate (src/sync/syncFs.ts): which AppData files are synced.
// Run: bun test.

import { expect, test } from "bun:test";
import { inSyncRange } from "../../src/sync/syncFs";

test("core user-data files are in range", () => {
  for (const p of [
    "library.json",
    "reading-state.json",
    "settings.json",
    "topics.json",
    "annotations-abc123.json",
    "threads-abc123.json",
    "memory-topic1/m-ab12cd34.md",
    "memory-topic1/index.md",
    "memory-topic1/meta.json",
    "prep-deadbeef/state.json",
    "prep-deadbeef/attention-is-all-you-need.md",
  ]) {
    expect(inSyncRange(p)).toBe(true);
  }
});

test("caches, logs, sync internals, and book blobs are out of range", () => {
  for (const p of [
    "fulltext-abc123.json",
    "figures-abc123.json",
    "events-topic1.jsonl",
    "sync-auth.json",
    "sync-state.json",
    "credentials.json",
    "prep-deadbeef/pdf/some-paper.pdf",
    "library/abc123.pdf",
    "images/threads/t1/photo.png",
    "random.txt",
  ]) {
    expect(inSyncRange(p)).toBe(false);
  }
});
