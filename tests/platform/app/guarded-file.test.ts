// The shared half of the single-file guarded stores (src/platform/app/guarded-file.ts),
// against the in-memory AppData from tests/support/guarded-appdata.ts.
// Run: scripts/t.sh tests/platform/app/guarded-file.test.ts

import { beforeEach, expect, test } from "bun:test";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import {
  appGuardedFileIo,
  quarantineBeforeWrite,
  readGuardedFile,
} from "../../../src/platform/app/guarded-file";
import { quarantineFile, readGuardedJson, writeTextAtomic } from "../../../src/platform/app/atomic-fs";

const FILE = "things.json";
const things = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every((t) => typeof t === "string") ? (raw as string[]) : null;

let io: FakeAppData;

beforeEach(() => {
  io = createFakeAppData();
});

test("a file that reads answers with its value", async () => {
  io.files.set(FILE, JSON.stringify(["a", "b"]));
  expect(await readGuardedFile(io, FILE, things)).toEqual(["a", "b"]);
});

test("no file is null and says nothing", async () => {
  expect(await readGuardedFile(io, FILE, things)).toBeNull();
  expect(io.reports).toEqual([]);
});

test("bad content is null once it is aside", async () => {
  io.files.set(FILE, JSON.stringify({ not: "a list" }));
  expect(await readGuardedFile(io, FILE, things)).toBeNull();
  expect(io.files.has(FILE)).toBe(false);
  expect(io.files.get(`${FILE}${CORRUPT_SUFFIX}`)).toBe(JSON.stringify({ not: "a list" }));
});

test("a file that is there and unread raises, so no save can follow", async () => {
  io.files.set(FILE, JSON.stringify(["a"]));
  io.readFails = true;
  await expect(readGuardedFile(io, FILE, things)).rejects.toThrow(`${FILE} could not be read`);
});

test("bad content that could not be moved aside raises too", async () => {
  io.files.set(FILE, "{");
  io.quarantineFails = true;
  await expect(readGuardedFile(io, FILE, things)).rejects.toThrow("could not be read");
  expect(io.files.get(FILE)).toBe("{");
});

test("setting the bytes aside before a write reports where they went", async () => {
  io.files.set(FILE, "[1]");
  expect(await quarantineBeforeWrite(io, FILE)).toBe(true);
  expect(io.files.get(`${FILE}${CORRUPT_SUFFIX}`)).toBe("[1]");
  expect(io.reports).toEqual([{ file: FILE, savedAs: `${FILE}${CORRUPT_SUFFIX}` }]);
});

test("a move aside that fails refuses the write and says so", async () => {
  io.files.set(FILE, "[1]");
  io.quarantineFails = true;
  expect(await quarantineBeforeWrite(io, FILE)).toBe(false);
  expect(io.files.get(FILE)).toBe("[1]");
  expect(io.reports).toEqual([{ file: FILE, savedAs: null }]);
});

test("a move aside with nothing to move refuses the write", async () => {
  expect(await quarantineBeforeWrite(io, FILE)).toBe(false);
  expect(io.reports).toEqual([{ file: FILE, savedAs: null }]);
});

test("the device io is the guarded read and the atomic write", () => {
  const real = appGuardedFileIo<string[]>();
  expect(real.read).toBe(readGuardedJson);
  expect(real.write).toBe(writeTextAtomic);
  expect(real.quarantine).toBe(quarantineFile);
});
