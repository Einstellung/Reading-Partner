// tauriSyncFs.list() against a spied @tauri-apps/plugin-fs.
//
// The scan is the one place in the app where losing every file is silent. walk()
// skips a file it cannot stat, and until this file nothing ran it: a stat that
// answered the wrong shape would have thrown per file, been skipped as "the file
// vanished", and left list() returning an empty array with no error anywhere.
// The pass would then have seen an empty device and asked Drive for everything.
//
// Run: bun test tests/platform/sync/syncFs-walk.test.ts

import { beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "@tauri-apps/plugin-fs";
import { tauriSyncFs } from "../../../src/platform/sync/syncFs";

function entry(name: string, isDirectory: boolean): fs.DirEntry {
  return { name, isFile: !isDirectory, isDirectory, isSymlink: false };
}

function info(mtime: Date | null, size: number): fs.FileInfo {
  return {
    isFile: true,
    isDirectory: false,
    isSymlink: false,
    size,
    mtime,
    atime: null,
    birthtime: null,
    readonly: false,
    fileAttributes: null,
    dev: null,
    ino: null,
    mode: null,
    nlink: null,
    uid: null,
    gid: null,
    rdev: null,
    blksize: null,
    blocks: null,
  };
}

// One in-range root file, one in-range file a directory down, one file the walk
// must not descend into, and one that disappears between readDir and stat.
const TREE: Record<string, fs.DirEntry[]> = {
  ".": [
    entry("topics.json", false),
    entry("vanished.json", false),
    entry("fulltext-abc.json", false),
    entry("memory-t1", true),
    entry("prep-abc", true),
  ],
  "memory-t1": [entry("index.json", false)],
  "prep-abc": [entry("pdf", true), entry("state.json", false)],
};

const STATS: Record<string, fs.FileInfo> = {
  "topics.json": info(new Date(1_700_000_000_123), 12),
  "memory-t1/index.json": info(new Date(1_700_000_111_000), 34),
  "prep-abc/state.json": info(null, 56),
};

beforeEach(() => {
  spyOn(fs, "readDir").mockImplementation(async (path) => TREE[String(path)] ?? []);
  spyOn(fs, "stat").mockImplementation(async (path) => {
    const found = STATS[String(path)];
    if (!found) throw new Error(`ENOENT: ${String(path)}`);
    return found;
  });
});

test("list returns every in-range file with its mtime in milliseconds", async () => {
  const files = await tauriSyncFs.list();
  expect(files).toEqual([
    { path: "topics.json", mtime: 1_700_000_000_123, size: 12 },
    { path: "memory-t1/index.json", mtime: 1_700_000_111_000, size: 34 },
    // A host that reports no modification time reads as 0, not as a skip.
    { path: "prep-abc/state.json", mtime: 0, size: 56 },
  ]);
});

test("a file that vanishes between readDir and stat is the only thing skipped", async () => {
  const files = await tauriSyncFs.list();
  expect(files.map((f) => f.path)).not.toContain("vanished.json");
  expect(files.length).toBe(3);
});

test("the walk does not descend into a directory that holds no in-range file", async () => {
  await tauriSyncFs.list();
  const asked = (fs.readDir as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
    (c) => c[0],
  );
  expect(asked).toContain("memory-t1");
  expect(asked).not.toContain("prep-abc/pdf");
});

test("stat answers null for a file it cannot read", async () => {
  expect(await tauriSyncFs.stat("topics.json")).toEqual({ mtime: 1_700_000_000_123, size: 12 });
  expect(await tauriSyncFs.stat("nothing.json")).toBeNull();
});
