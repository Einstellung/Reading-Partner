// The observation tombstone file is rewritten from what was read of it
// (src/memory/observations/store.ts). A read that failed for any reason but
// the file being missing must stop the rewrite: a log read as empty and written
// back as one line is, to the records merge, the deletion of every other line
// on every device (pitfall 208). Run: bun test.

import { expect, test } from "bun:test";
import { ObservationFileStore, type ObservationFs } from "../../src/memory/observations/store";

const TOMBSTONES = "observations/deleted-observations.jsonl";

function fs(over: Partial<ObservationFs> = {}) {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const io: ObservationFs = {
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      writes.push(path);
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    },
    async listDir() {
      return [];
    },
    ...over,
  };
  return { io, files, writes };
}

test("a tombstone file that will not read stops a delete before anything is written", async () => {
  const f = fs({
    async readStrict(path) {
      if (path === TOMBSTONES) throw new Error("EIO");
      return null;
    },
  });
  f.files.set(TOMBSTONES, '{"id":"m-1","at":"2026-09-01"}\n');
  const store = new ObservationFileStore(f.io);
  await expect(store.delete("m-2")).rejects.toThrow("EIO");
  expect(f.writes).toEqual([]);
  expect(f.files.get(TOMBSTONES)).toBe('{"id":"m-1","at":"2026-09-01"}\n');
});

test("a tombstone file that will not read stops an index rebuild from writing an empty one", async () => {
  const f = fs({
    async readStrict(path) {
      if (path === TOMBSTONES) throw new Error("EIO");
      return null;
    },
  });
  const store = new ObservationFileStore(f.io);
  await expect(store.rebuildIndex()).rejects.toThrow("EIO");
  expect(f.writes).toEqual([]);
});

test("a tombstone file that is missing is an empty log, as before", async () => {
  const f = fs({
    async readStrict() {
      return null;
    },
  });
  const store = new ObservationFileStore(f.io);
  await store.rebuildIndex();
  expect(f.files.get(TOMBSTONES)).toBe("");
});
