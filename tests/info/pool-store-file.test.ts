// What the item pool is allowed to lose (src/info/briefing/pool-store.ts).
//
// Its day files and its poll schedule are derived: losing them costs one round
// of polling. info-pool-marks.json is not. It is the record of what has already
// been briefed, it is in the sync range (platform/sync/syncFs.ts), and it used
// to read as "nothing has ever been briefed" whenever the file would not open —
// which the next checkpoint of a run then wrote back, on both devices.
//
// The real store runs here against the in-memory AppData of
// tests/support/appdata-fake.ts, so the writer under test is the real atomic
// one.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { loadPool, savePoolMarks, savePoolPolled } from "../../src/info/briefing/pool-store";
import { POOL_VERSION, recordRun, type PoolMark } from "../../src/info/briefing/item-pool";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

const MARKS = "info-pool-marks.json";
const POLLED = "info-pool-polled.json";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

// Two items a run has already judged, one of them already delivered.
const BRIEFED: Record<string, PoolMark> = {
  "item-a": { keep: true, confidence: 0.9, screenedOn: "2026-08-24", briefedOn: "2026-08-24" },
  "item-b": { keep: false, confidence: 0.2, screenedOn: "2026-08-24" },
};

function markedFile(): string {
  return JSON.stringify({ version: POOL_VERSION, marks: BRIEFED });
}

function marksOnDisk(): Record<string, PoolMark> {
  const raw = JSON.parse(disk.files.get(MARKS) ?? "null") as {
    marks?: Record<string, PoolMark>;
  } | null;
  return raw?.marks ?? {};
}

// What a run's checkpoint does with the pool it was handed.
function checkpoint(): Parameters<typeof recordRun>[2] {
  return {
    verdicts: { "item-c": { id: "item-c", keep: true, why: "new", confidence: 0.8 } },
    briefed: ["item-c"],
  };
}

test("the marks come back the way they went in, and can be written from", async () => {
  disk.files.set(MARKS, markedFile());
  const pool = await loadPool();
  expect(pool.marks).toEqual(BRIEFED);

  await savePoolMarks(recordRun(pool, "2026-08-25", checkpoint()));
  expect(Object.keys(marksOnDisk()).sort()).toEqual(["item-a", "item-b", "item-c"]);
});

// The first run on a device: no file, and the marks it makes have to land.
test("marks a reader has never had are still written", async () => {
  const pool = await loadPool();
  expect(pool.marks).toEqual({});

  await savePoolMarks(recordRun(pool, "2026-08-25", checkpoint()));
  expect(Object.keys(marksOnDisk())).toEqual(["item-c"]);
});

// The bug: an empty read of a file that is there, followed by the write that
// makes it true.
test("a checkpoint after a failed read of the marks does not write over them", async () => {
  disk.files.set(MARKS, markedFile());
  disk.unreadable.add(MARKS);

  const pool = await loadPool();
  await savePoolMarks(recordRun(pool, "2026-08-25", checkpoint()));

  expect(disk.writes).not.toContain(MARKS);
  disk.unreadable.delete(MARKS);
  expect((await loadPool()).marks).toEqual(BRIEFED);
  // Nothing is known to be wrong with the bytes, so nothing is moved aside
  // either — there is no rescue copy to be made and no need for one.
  expect(disk.renames).toEqual([]);
});

// The refusal is the marks' alone. The poll schedule is derived, it is written
// in the same sweep, and holding it back would cost a poll for nothing.
test("the poll schedule is still written when the marks are not", async () => {
  disk.files.set(MARKS, markedFile());
  disk.unreadable.add(MARKS);

  const pool = await loadPool();
  await savePoolPolled({ ...pool, lastPolled: { "source-a": 1_000 } });

  expect(disk.files.has(POLLED)).toBe(true);
  expect(disk.writes).not.toContain(MARKS);
});

// A day file that will not open is a different thing: a poll finds those items
// again, so the pool keeps collecting rather than refusing anything.
test("a day file that would not open costs its own day and nothing else", async () => {
  disk.files.set(MARKS, markedFile());
  disk.files.set("info-pool-2026-08-24.json", JSON.stringify([{ id: "item-a" }]));
  disk.unreadable.add("info-pool-2026-08-24.json");

  const pool = await loadPool();
  expect(pool.days["2026-08-24"]).toBeUndefined();
  expect(pool.marks).toEqual(BRIEFED);
  expect(pool.marksWritable).toBe(true);
});
