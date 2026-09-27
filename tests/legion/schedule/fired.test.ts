// The fired store under concurrent ticks (src/legion/schedule/fired.ts, pitfall
// 484): a slow first read must not overwrite a newer record, and two records
// in flight must both reach the disk. Run: bun test.

import { expect, test } from "bun:test";
import { createFiredStore, type FiredIo } from "../../../src/legion/schedule/fired";

/** A disk whose first read answers with what it held when asked, but only
 * once `release()` is called; later reads answer at once. */
function slowFirstReadIo(initial: string | null = null) {
  let disk = initial;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const io: FiredIo = {
    async read() {
      const snapshot = disk;
      if (reads++ === 0) await gate;
      return snapshot;
    },
    async write(contents) {
      disk = contents;
    },
  };
  return { io, release, disk: () => (disk === null ? null : JSON.parse(disk)) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a slow first read does not overwrite a record made while it was in flight", async () => {
  const d = slowFirstReadIo();
  const store = createFiredStore(d.io);

  const first = store.read();
  const recorded = store.record("job:a", 1);
  await settle();
  d.release();
  await Promise.all([first, recorded]);
  await store.record("job:b", 2);

  expect(d.disk()).toEqual({ "job:a": 1, "job:b": 2 });
  expect(await store.read()).toEqual({ "job:a": 1, "job:b": 2 });
});

test("two records in flight at once both reach the disk", async () => {
  let disk: string | null = JSON.stringify({ old: 0 });
  const pending: Array<() => void> = [];
  const store = createFiredStore({
    async read() {
      return disk;
    },
    // Writes land in the reverse order they were issued, if they are allowed
    // to overlap.
    write(contents) {
      return new Promise<void>((resolve) => {
        pending.push(() => {
          disk = contents;
          resolve();
        });
        if (pending.length === 1) {
          setTimeout(() => {
            while (pending.length) pending.pop()!();
          }, 5);
        }
      });
    },
  });

  await Promise.all([store.record("job:a", 1), store.record("job:b", 2)]);

  expect(JSON.parse(disk!)).toEqual({ old: 0, "job:a": 1, "job:b": 2 });
  expect(await store.read()).toEqual({ old: 0, "job:a": 1, "job:b": 2 });
});

test("a disk that will not read or write still leaves the records in memory", async () => {
  const store = createFiredStore({
    read: () => Promise.reject(new Error("no disk")),
    write: () => Promise.reject(new Error("no disk")),
  });
  await store.record("job:a", 1);
  await store.record("job:b", 2);
  expect(await store.read()).toEqual({ "job:a": 1, "job:b": 2 });
});
