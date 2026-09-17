// The disk the box, the runs, the bells and the ledger all sit on
// (src/platform/app/record-dir.ts). The stores themselves are tested against a
// Map, so this is the only place the real AppData wiring is pinned: the paths
// the four of them write and the ways a read comes back empty instead of
// throwing.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  appRecordDirIo,
  recordFileName,
  recordIdOf,
} from "../../../src/platform/app/record-dir";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

const io = () => appRecordDirIo("legion/runs");

test("a record is written under the directory, atomically, and read back by name", async () => {
  await io().write("r-1.json", "{}");
  expect(disk.files.get("legion/runs/r-1.json")).toBe("{}");
  expect(await io().read("r-1.json")).toBe("{}");
});

// The contents of a listing are not pinned here: the fake's readDir is flat and
// answers whole paths whatever directory it is asked for (docs/pitfall/344), so
// what it says about a directory means nothing. A directory that is not there
// still has to read as empty rather than throw, and that it does say.
test("a directory that is not there lists as empty", async () => {
  expect(await io().list()).toEqual([]);
});

test("a read that cannot be answered is null rather than a throw", async () => {
  expect(await io().read("missing.json")).toBeNull();
  disk.files.set("legion/runs/broken.json", "{}");
  disk.unreadable.add("legion/runs/broken.json");
  expect(await io().read("broken.json")).toBeNull();
});

test("a remove takes the file and says nothing about one that was not there", async () => {
  await io().write("r-1.json", "{}");
  await io().remove("r-1.json");
  expect(disk.files.has("legion/runs/r-1.json")).toBe(false);
  await io().remove("r-1.json");
});

test("an id is a file name and only a file name", () => {
  const shape = /^r-[0-9a-f]{32}$/;
  const id = `r-${"0".repeat(32)}`;
  expect(recordFileName(id)).toBe(`${id}.json`);
  expect(recordIdOf(`${id}.json`, shape)).toBe(id);
  expect(recordIdOf(`${id}.json.bad`, shape)).toBeNull();
  expect(recordIdOf("nonsense.json", shape)).toBeNull();
});
